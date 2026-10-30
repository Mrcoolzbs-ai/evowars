// ============================================
// THERMAL STATE - Температурная иерархия ядра (Stage 4.2.2)
// ============================================
//
// ШЕСТЬ температурных понятий — РАЗНЫЕ физические величины
// (docs/science/PHYSICS_ARCHITECTURE.md §5.1):
//
//   1. effectiveTemperature        — эффективная температура
//      ИСТОЧНИКА излучения (звезда), а не получателя;
//   2. equilibriumTemperature      — равновесная температура серого
//      тела T_eq из радиационного потока; зависит от входов и
//      допущений и НЕ является температурой поверхности;
//   3. surfaceTemperature          — температура физической
//      поверхности тела; до радиационно-конвективной модели
//      (RCM) остаётся unknown либо явно оценочной;
//   4. atmosphericTemperatureProfile — вертикальный профиль
//      температур по слоям атмосферы; один слой из пресета —
//      НЕ профиль, а явно неполная оценка;
//   5. reservoirTemperature        — температура КОНКРЕТНОГО
//      резервуара (атмосфера, океан, лёд, кора, мантия, ядро);
//   6. localReactionTemperature    — температура ЛОКАЛЬНОЙ области
//      протекания процесса (резервуар или слой атмосферы),
//      читаемая resolver'ом без запрещённых подстановок.
//
// Правила честности (Stage 4.2.2):
// - температуры считаются ТОЛЬКО в кельвинах 'K' из реестра ядра;
//   аффинные шкалы (°C, °F) сознательно не поддерживаются;
// - термодинамические температуры в рассматриваемых состояниях
//   неотрицательны: отрицательное значение отклоняется;
// - происхождение (provenance) сохраняется при каждом
//   преобразовании и не теряется при валидации;
// - отсутствие поля ≠ ноль: оно означает «подсистема не
//   инициализирована» или «температура не заявлена»;
// - температура неизвестна, оценочна или неприменима — статус
//   ScientificValue фиксируется ЯВНО, число не подставляется;
// - локальная температура процесса НЕ берётся с потолка:
//   температура соседнего резервуара, T_eq или температура
//   поверхности не подставляются как локальная температура;
// - этот модуль — КОНТРАКТ и валидация, а не климатический
//   решатель: RCM, парниковый эффект и гидростатический профиль
//   НЕ реализованы и за реализованные не выдаются.

import type { Dimension, PhysicalQuantity } from './physicalQuantity';
import { dimension, dimensionOf, sameDimension } from './physicalQuantity';
import type { DataProvenance, ScientificValue } from './scientificValue';
import { unknownValue, validateScientificValueShape } from './scientificValue';
import type { CoreWorldState } from './worldState';

// ============================================
// 1. КОНСТАНТЫ И ВАЛИДАЦИЯ ТЕМПЕРАТУР
// ============================================

/** Единственная единица температурной иерархии ядра: кельвин. */
export const TEMPERATURE_UNIT = 'K';

/** Размерность термодинамической температуры (SI: K). */
export const THERMODYNAMIC_TEMPERATURE_DIMENSION: Dimension = dimension(0, 0, 0, 1);

/**
 * Валидация научного значения как температуры (Stage 4.2.2).
 *
 * Проверяет ФОРМУ и физическую пригодность, не «чинит» ничего:
 * - известная единица 'K' и размерность термодинамической
 *   температуры для known/estimated;
 * - конечное НЕОТРИЦАТЕЛЬНОЕ числовое значение (0 K — предел
 *   третьего начала, отрицательные абсолютные температуры в
 *   рассматриваемых состояниях невозможны);
 * - estimated обязан нести метод оценки (shape-контракт);
 * - unknown / not_applicable / not_implemented НЕ должны нести
 *   числового содержания (quantity) — статус и число противоречат
 *   друг другу;
 * - invalid — только диагностика: единица/значение сохранены для
 *   разбора, но как корректная температура не используются.
 *
 * Возвращает список проблем (пустой = значение пригодно как
 * температура своего статуса).
 */
export function validateThermalScientificValue(v: unknown, label = 'температура'): string[] {
  const shapeIssues = validateScientificValueShape(v);
  // Форма, непригодная даже для ScientificValue, исчерпывает ответ.
  if (shapeIssues.length > 0 && (typeof v !== 'object' || v === null)) {
    return [`${label}: ${shapeIssues.join('; ')}`];
  }
  if (typeof v !== 'object' || v === null) {
    return [`${label}: значение должно быть ScientificValue`];
  }
  const value = v as ScientificValue & { quantity?: PhysicalQuantity };

  // Статусы без числа: числовое содержание запрещено.
  if (value.status === 'unknown' || value.status === 'not_applicable' || value.status === 'not_implemented') {
    const issues = shapeIssues.map((x) => `${label}: ${x}`);
    if (value.quantity !== undefined) {
      issues.push(
        `${label}: статус «${value.status}» не должен нести числового содержания (quantity) — статус и число противоречат друг другу`
      );
    }
    return issues;
  }

  // invalid: числовые поля — только отклонённая диагностика; как
  // корректная температура значение не используется, и Дополнительных
  // термодинамических ошибок оно не порождает (форма — выше).
  if (value.status === 'invalid') {
    return shapeIssues.map((x) => `${label}: ${x}`);
  }

  // known/estimated: числовое содержание обязательно и обязано
  // быть пригодной термодинамической температурой в кельвинах.
  // Сначала — контракт формы (например, estimated без метода),
  // затем — термодинамическая пригодность.
  const issues: string[] = shapeIssues.map((x) => `${label}: ${x}`);
  if (value.quantity === undefined || value.quantity === null) {
    issues.push(`${label}: статус «${value.status}» требует числового содержания (quantity)`);
    return issues;
  }
  const q = value.quantity;
  if (q.unit !== TEMPERATURE_UNIT) {
    issues.push(
      `${label}: температура обязана быть в единице «${TEMPERATURE_UNIT}» (получена «${String(q.unit)}»); аффинные шкалы (°C, °F) не поддерживаются`
    );
    return issues;
  }
  if (!sameDimension(dimensionOf(q), THERMODYNAMIC_TEMPERATURE_DIMENSION)) {
    issues.push(
      `${label}: единица «${String(q.unit)}» имеет размерность, отличную от термодинамической температуры`
    );
    return issues;
  }
  if (typeof q.value !== 'number' || !Number.isFinite(q.value)) {
    issues.push(`${label}: числовое значение температуры должно быть конечным числом`);
    return issues;
  }
  if (q.value < 0) {
    issues.push(
      `${label}: отрицательная термодинамическая температура (${q.value} K) невозможна в рассматриваемых состояниях`
    );
  }
  return issues;
}

/**
 * Пригодно ли значение как числовая температура (Stage 4.2.2.1).
 *
 * Строгая проверка: статус known/estimated + полная пригодность по
 * validateThermalScientificValue — то есть не только единица 'K',
 * размерность, конечность и неотрицательность, но и КОРРЕКТНОСТЬ ФОРМЫ:
 * - estimated без method (безследная оценка) НЕ пригоден;
 * - known/estimated с искажённой формой (пропущенные обязательные
 *   поля статуса) НЕ используется;
 * - неизвестная единица, неверная размерность, NaN, Infinity и
 *   отрицательные значения не проходят;
 * - unknown/not_applicable/not_implemented/invalid не превращаются
 *   в число.
 */
export function hasUsableTemperature(v: ScientificValue | null | undefined): boolean {
  if (v === null || v === undefined) return false;
  if (v.status !== 'known' && v.status !== 'estimated') return false;
  return validateThermalScientificValue(v).length === 0;
}

/** Числовое значение температуры в K или null (unknown/непригодное). */
export function temperatureValueOrNull(v: ScientificValue | null | undefined): number | null {
  return hasUsableTemperature(v) ? (v as { quantity: PhysicalQuantity }).quantity.value : null;
}

// ============================================
// 2. ПРОФИЛЬ ТЕМПЕРАТУР АТМОСФЕРЫ
// ============================================

/** Один слой профиля температур атмосферы. */
export interface AtmosphereTemperatureLayer {
  layerId: string;
  /** Диапазон высот слоя, м; отсутствие — высоты неизвестны и не выдумываются. */
  altitudeRangeM?: { min: number; max: number | null };
  temperature: ScientificValue;
  note?: string;
}

/** Статус знания о вертикальном распределении температур. */
export type AtmosphericTemperatureProfileStatus =
  | 'unknown' // профиль не известен
  | 'single_layer_estimate' // одна оценка (например, из пресета) — НЕ вертикальный профиль
  | 'partial_profile' // известны отдельные слои
  | 'complete_profile'; // профиль заявлен полным (гидростатика/RCM — будущие этапы)

export const ATMOSPHERIC_TEMPERATURE_PROFILE_STATUSES: readonly AtmosphericTemperatureProfileStatus[] = [
  'unknown',
  'single_layer_estimate',
  'partial_profile',
  'complete_profile'
];

/** Профиль температур атмосферы тела. */
export interface AtmosphericTemperatureProfile {
  status: AtmosphericTemperatureProfileStatus;
  layers: AtmosphereTemperatureLayer[];
  provenance?: DataProvenance;
  /** Явные ограничения интерпретации (обязательны для single_layer_estimate). */
  limitations?: string;
  note?: string;
}

/**
 * Валидация профиля температур атмосферы.
 *
 * - unknown → слоёв быть НЕ должно (неизвестность не изображается
 *   данными);
 * - single_layer_estimate → ровно ОДИН слой и ЯВНЫЙ limitations:
 *   одна оценка — не вертикальный профиль, и это фиксируется;
 * - partial_profile / complete_profile → не менее одного слоя;
 *   complete_profile на этом этапе не создаётся адаптерами
 *   (гидростатика/RCM не реализованы), но контракт допускает
 *   появление данных из будущих решателей;
 * - идентификаторы слоёв непусты и уникальны;
 * - температура каждого слоя проходит термодинамическую валидацию;
 * - altitudeRangeM, если задан, — конечные неотрицательные числа
 *   с min ≤ max (max может быть null: верхняя граница неизвестна).
 */
export function validateAtmosphericTemperatureProfile(p: unknown, label = 'профиль температур атмосферы'): string[] {
  const errors: string[] = [];
  if (typeof p !== 'object' || p === null || Array.isArray(p)) {
    return [`${label}: профиль должен быть объектом`];
  }
  const profile = p as Record<string, unknown>;
  const status = profile.status;
  if (typeof status !== 'string' || !(ATMOSPHERIC_TEMPERATURE_PROFILE_STATUSES as readonly string[]).includes(status)) {
    return [
      `${label}: статус профиля должен быть одним из: ${ATMOSPHERIC_TEMPERATURE_PROFILE_STATUSES.join(' | ')} (получено «${String(status)}»)`
    ];
  }
  if (!Array.isArray(profile.layers)) {
    return [`${label}: layers обязан быть массивом слоёв`];
  }
  const layers = profile.layers as unknown[];

  if (status === 'unknown' && layers.length > 0) {
    errors.push(`${label}: статус unknown не допускает слоёв — неизвестность не изображается данными`);
  }
  if (status === 'single_layer_estimate') {
    if (layers.length !== 1) {
      errors.push(
        `${label}: single_layer_estimate требует ровно один слой (получено ${layers.length}) — несколько слоёв уже претензия на профиль`
      );
    }
    if (typeof profile.limitations !== 'string' || (profile.limitations as string).trim() === '') {
      errors.push(
        `${label}: single_layer_estimate обязана нести ЯВНЫЙ limitations — одиночная оценка НЕ является расчётным вертикальным профилем`
      );
    }
  }
  if ((status === 'partial_profile' || status === 'complete_profile') && layers.length === 0) {
    errors.push(`${label}: статус «${status}» требует не менее одного слоя`);
  }

  const seenLayerIds = new Set<string>();
  for (const [index, layer] of layers.entries()) {
    if (typeof layer !== 'object' || layer === null || Array.isArray(layer)) {
      errors.push(`${label}: слой #${index} должен быть объектом`);
      continue;
    }
    const rec = layer as Record<string, unknown>;
    if (typeof rec.layerId !== 'string' || rec.layerId.trim() === '') {
      errors.push(`${label}: слой #${index} — layerId должен быть непустой строкой`);
    } else if (seenLayerIds.has(rec.layerId)) {
      errors.push(`${label}: дублирующийся layerId «${rec.layerId}»`);
    } else {
      seenLayerIds.add(rec.layerId);
    }
    const tempErrors = validateThermalScientificValue(rec.temperature, `${label}: слой «${String(rec.layerId)}», температура`);
    errors.push(...tempErrors);
    if (rec.altitudeRangeM !== undefined) {
      const range = rec.altitudeRangeM;
      if (typeof range !== 'object' || range === null) {
        errors.push(`${label}: слой «${String(rec.layerId)}», altitudeRangeM должен быть объектом {min, max}`);
      } else {
        const r = range as Record<string, unknown>;
        if (typeof r.min !== 'number' || !Number.isFinite(r.min) || r.min < 0) {
          errors.push(`${label}: слой «${String(rec.layerId)}», altitudeRangeM.min должен быть конечным неотрицательным числом`);
        }
        if (r.max !== null && (typeof r.max !== 'number' || !Number.isFinite(r.max) || (r.max as number) < 0)) {
          errors.push(`${label}: слой «${String(rec.layerId)}», altitudeRangeM.max должен быть null или конечным неотрицательным числом`);
        } else if (typeof r.min === 'number' && typeof r.max === 'number' && (r.max as number) < (r.min as number)) {
          errors.push(`${label}: слой «${String(rec.layerId)}», altitudeRangeM: max < min`);
        }
      }
    }
  }
  return errors;
}

// ============================================
// 3. ТЕПЛОВОЕ СОСТОЯНИЕ ТЕЛА
// ============================================

/**
 * Температурное состояние тела — РАЗДЕЛЬНЫЕ величины (Stage 4.2.2).
 * Ни одно из полей не является синонимом другого и ничто не
 * копируется между ними автоматически.
 */
export interface BodyThermalState {
  /** Эффективная температура ИСТОЧНИКА излучения (звезда). Для получателя излучения — not_applicable. */
  effectiveTemperature: ScientificValue;
  /** Равновесная температура серого тела T_eq (радиационная оценка; НЕ температура поверхности). */
  equilibriumTemperature: ScientificValue;
  /** Температура физической поверхности; до RCM — unknown либо явно оценочная. */
  surfaceTemperature: ScientificValue;
  /** Вертикальное распределение температур атмосферы (если есть). */
  atmosphericTemperatureProfile: AtmosphericTemperatureProfile;
  provenance?: DataProvenance;
  note?: string;
}

/**
 * Валидация теплового состояния тела: каждая из четырёх
 * составляющих проходит свою проверку; ошибки агрегируются с
 * указанием поля.
 */
export function validateBodyThermalState(state: unknown, label = 'thermalState'): string[] {
  if (typeof state !== 'object' || state === null || Array.isArray(state)) {
    return [`${label}: тепловое состояние должно быть объектом`];
  }
  const rec = state as Record<string, unknown>;
  const errors: string[] = [];
  errors.push(...validateThermalScientificValue(rec.effectiveTemperature, `${label}: effectiveTemperature`));
  errors.push(...validateThermalScientificValue(rec.equilibriumTemperature, `${label}: equilibriumTemperature`));
  errors.push(...validateThermalScientificValue(rec.surfaceTemperature, `${label}: surfaceTemperature`));
  errors.push(...validateAtmosphericTemperatureProfile(rec.atmosphericTemperatureProfile, `${label}: atmosphericTemperatureProfile`));
  return errors;
}

// ============================================
// 4. ЛОКАЛЬНАЯ ТЕМПЕРАТУРА ПРОЦЕССА (RESOLVER)
// ============================================

/**
 * Некорректное место процесса или конфигурация диагностики.
 * Функции остаются чистыми: мир не изменяется.
 */
export class ThermalStateError extends Error {
  readonly code: 'invalid_place' | 'invalid_threshold';
  readonly component = 'ThermalState';

  constructor(code: ThermalStateError['code'], message: string) {
    super(`[ThermalState/${code}] ${message}`);
    this.name = 'ThermalStateError';
    this.code = code;
  }
}

/** Место протекания процесса: резервуар ИЛИ слой атмосферы. */
export interface LocalReactionTemperaturePlace {
  bodyId: string;
  reservoirId?: string;
  layerId?: string;
}

/** Откуда взята локальная температура. */
export type LocalTemperatureSource = 'reservoir_temperature' | 'atmosphere_layer_temperature' | 'none';

/** Результат разрешения локальной температуры. */
export interface LocalReactionTemperatureResolution {
  temperature: ScientificValue;
  bodyId: string;
  placeKind: 'reservoir' | 'atmosphere_layer';
  placeId: string;
  source: LocalTemperatureSource;
  provenance?: DataProvenance;
  reason?: string;
}

/**
 * Определение типа места процесса. Ровно один способ задания:
 * резервуар ИЛИ слой. Нарушение — ошибка invalid_place, а не
 * молчаливый выбор «чего-нибудь».
 */
function resolvePlaceKind(place: LocalReactionTemperaturePlace): 'reservoir' | 'atmosphere_layer' {
  if (typeof place.bodyId !== 'string' || place.bodyId.trim() === '') {
    throw new ThermalStateError('invalid_place', 'место процесса обязано указывать тело (непустой bodyId)');
  }
  const hasReservoir = place.reservoirId !== undefined && place.reservoirId !== null;
  const hasLayer = place.layerId !== undefined && place.layerId !== null;
  if (hasReservoir && hasLayer) {
    throw new ThermalStateError(
      'invalid_place',
      `место процесса неоднозначно: указаны и резервуар «${String(place.reservoirId)}», и слой «${String(place.layerId)}» — выберите один`
    );
  }
  if (!hasReservoir && !hasLayer) {
    throw new ThermalStateError(
      'invalid_place',
      'место процесса не задано: укажите reservoirId или layerId — «где-нибудь на теле» не является областью'
    );
  }
  if (hasReservoir && typeof place.reservoirId !== 'string') {
    throw new ThermalStateError('invalid_place', 'reservoirId должен быть строкой');
  }
  if (hasLayer && typeof place.layerId !== 'string') {
    throw new ThermalStateError('invalid_place', 'layerId должен быть строкой');
  }
  // Stage 4.2.2.1: пустые/пробельные идентификаторы области — не область.
  // Пустая строка — это «область не указана», а не «первый попавшийся».
  if (hasReservoir && (place.reservoirId as string).trim() === '') {
    throw new ThermalStateError(
      'invalid_place',
      'reservoirId не может быть пустой или пробельной строкой — укажите реальный идентификатор резервуара'
    );
  }
  if (hasLayer && (place.layerId as string).trim() === '') {
    throw new ThermalStateError(
      'invalid_place',
      'layerId не может быть пустой или пробельной строкой — укажите реальный идентификатор слоя'
    );
  }
  return hasReservoir ? 'reservoir' : 'atmosphere_layer';
}

/** Provenance есть только у статусов, которые его несут (not_applicable и not_implemented поля не имеют). */
function provenanceOfValue(value: ScientificValue): DataProvenance | undefined {
  if (value.status === 'not_applicable' || value.status === 'not_implemented') {
    return undefined;
  }
  return value.provenance;
}

/** Оформление результата для температуры, пригодной как ответ. */
function resolutionFromValue(
  temperature: ScientificValue,
  place: { bodyId: string; placeKind: 'reservoir' | 'atmosphere_layer'; placeId: string },
  source: LocalTemperatureSource,
  reason?: string
): LocalReactionTemperatureResolution {
  return {
    temperature,
    bodyId: place.bodyId,
    placeKind: place.placeKind,
    placeId: place.placeId,
    source,
    provenance: provenanceOfValue(temperature),
    reason
  };
}

/**
 * Разрешение локальной температуры процесса (Stage 4.2.2).
 *
 * Читает температуру ТОЛЬКО явно указанной области:
 * - резервуар: ищется по (bodyId, reservoirId); чужой резервуар
 *   или резервуар другого тела НЕ подставляется;
 * - слой атмосферы: ищется в thermalState.atmosphericTemperatureProfile
 *   указанного тела.
 *
 * Запрещённые подстановки НЕ выполняются ни при каких условиях:
 * - T_eq НЕ является температурой поверхности или области;
 * - глобальная surfaceTemperature НЕ подменяет локальную;
 * - температура соседнего резервуара/слоя НЕ переносится;
 * - произвольная AtmosphereState.temperature НЕ читается.
 *
 * При отсутствии или непригодности данных возвращается
 * синтезированный unknown с причиной — честное «не знаем», а не
 * правдоподобное число. Статусы unknown/not_applicable/
 * not_implemented у ЗАЯВЛЕННОЙ температуры сохраняются как есть:
 * заявленная неизвестность — тоже данные.
 *
 * Функция чистая: состояние мира не изменяется.
 */
export function resolveLocalReactionTemperature(
  state: CoreWorldState,
  place: LocalReactionTemperaturePlace
): LocalReactionTemperatureResolution {
  const placeKind = resolvePlaceKind(place);
  const bodyId = place.bodyId;
  const body = state.bodies.find((b) => b.id === bodyId) ?? null;

  if (placeKind === 'reservoir') {
    const reservoirId = place.reservoirId as string;
    // Stage 4.2.2.1: orphan-резервуар (привязан к несуществующему телу)
    // не является областью существующего мира. Резервуар имеет смысл
    // только вместе со своим телом.
    if (body === null) {
      return {
        temperature: unknownValue(
          `температура неизвестна: тело «${bodyId}» не найдено в состоянии мира — резервуар «${reservoirId}» без тела (orphan) не является областью существующего мира, подстановка чужих температур запрещена`
        ),
        bodyId,
        placeKind,
        placeId: reservoirId,
        source: 'none',
        reason: `тело «${bodyId}» не найдено — резервуар «${reservoirId}» не читается как область`
      };
    }
    const reservoir =
      state.reservoirs.find((r) => r.id === reservoirId && r.bodyId === bodyId) ?? null;
    if (reservoir === null) {
      return {
        temperature: unknownValue(
          `температура неизвестна: резервуар «${reservoirId}» не найден на теле «${bodyId}» (отсутствует, не привязан к этому телу или принадлежит другому телу) — температура соседних областей не подставляется`
        ),
        bodyId,
        placeKind,
        placeId: reservoirId,
        source: 'none',
        reason: `резервуар «${reservoirId}» не найден на теле «${bodyId}»`
      };
    }
    const reservoirTemperature = reservoir.reservoirTemperature;
    if (reservoirTemperature === undefined) {
      return {
        temperature: unknownValue(
          `температура неизвестна: резервуар «${reservoirId}» (тело «${bodyId}») не имеет заявленной температуры — fallback на T_eq, температуру поверхности или соседнего резервуара запрещён`
        ),
        bodyId,
        placeKind,
        placeId: reservoirId,
        source: 'none',
        reason: `резервуар «${reservoirId}» без температуры`
      };
    }
    if (reservoirTemperature.status === 'invalid') {
      const invalidReason = (reservoirTemperature as { reason?: string }).reason;
      return {
        temperature: unknownValue(
          `температура неизвестна: температура резервуара «${reservoirId}» отклонена валидацией (${String(invalidReason)}) — отклонённые данные не используются как корректное значение`
        ),
        bodyId,
        placeKind,
        placeId: reservoirId,
        source: 'none',
        reason: `температура резервуара «${reservoirId}» — invalid`
      };
    }
    if (hasUsableTemperature(reservoirTemperature)) {
      return resolutionFromValue(reservoirTemperature, { bodyId, placeKind, placeId: reservoirId }, 'reservoir_temperature');
    }
    if (
      reservoirTemperature.status === 'unknown' ||
      reservoirTemperature.status === 'not_applicable' ||
      reservoirTemperature.status === 'not_implemented'
    ) {
      return resolutionFromValue(
        reservoirTemperature,
        { bodyId, placeKind, placeId: reservoirId },
        'reservoir_temperature',
        `резервуар «${reservoirId}»: температура заявлена со статусом «${reservoirTemperature.status}» — как число не используется и не подменяется`
      );
    }
    return {
      temperature: unknownValue(
        `температура неизвестна: температура резервуара «${reservoirId}» непригодна как числовое значение — подстановка других величин запрещена`
      ),
      bodyId,
      placeKind,
      placeId: reservoirId,
      source: 'none',
      reason: `температура резервуара «${reservoirId}» непригодна как число`
    };
  }

  // --- слой атмосферы ---
  const layerId = place.layerId as string;
  if (body === null) {
    return {
      temperature: unknownValue(
        `температура неизвестна: тело «${bodyId}» не найдено в состоянии мира — слои его атмосферы не читаются, подстановка чужих данных запрещена`
      ),
      bodyId,
      placeKind,
      placeId: layerId,
      source: 'none',
      reason: `тело «${bodyId}» не найдено`
    };
  }
  const profile = body.thermalState?.atmosphericTemperatureProfile;
  if (profile === undefined) {
    return {
      temperature: unknownValue(
        `температура неизвестна: тело «${bodyId}» не имеет температурного состояния (thermalState) — профиль температур не инициализирован`
      ),
      bodyId,
      placeKind,
      placeId: layerId,
      source: 'none',
      reason: `тело «${bodyId}» без thermalState`
    };
  }
  // Stage 4.2.2.1: профиль, ЗАЯВЛЕННЫЙ неизвестным, не читается по слоям:
  // если весь профиль объявлен «unknown», его слои (если вдруг есть)
  // не являются заявленными данными — неизвестность не изображается
  // числами из незаявленного источника.
  if (profile.status === 'unknown') {
    return {
      temperature: unknownValue(
        `температура неизвестна: профиль температур тела «${bodyId}» заявлен со статусом «unknown» — слои не читаются как данные, температура слоя «${layerId}» не подставляется`
      ),
      bodyId,
      placeKind,
      placeId: layerId,
      source: 'none',
      reason: `профиль температур тела «${bodyId}» заявлен unknown — слои не читаются`
    };
  }
  const layer = profile.layers.find((l) => l.layerId === layerId) ?? null;
  if (layer === null) {
    return {
      temperature: unknownValue(
        `температура неизвестна: слой «${layerId}» не найден в профиле температур тела «${bodyId}» (статус профиля: «${profile.status}») — температура соседних слоёв не подставляется`
      ),
      bodyId,
      placeKind,
      placeId: layerId,
      source: 'none',
      reason: `слой «${layerId}» отсутствует в профиле тела «${bodyId}»`
    };
  }
  const layerTemperature = layer.temperature;
  if (layerTemperature.status === 'invalid') {
    const invalidReason = (layerTemperature as { reason?: string }).reason;
    return {
      temperature: unknownValue(
        `температура неизвестна: температура слоя «${layerId}» отклонена валидацией (${String(invalidReason)}) — отклонённые данные не используются`
      ),
      bodyId,
      placeKind,
      placeId: layerId,
      source: 'none',
      reason: `температура слоя «${layerId}» — invalid`
    };
  }
  if (hasUsableTemperature(layerTemperature)) {
    return resolutionFromValue(layerTemperature, { bodyId, placeKind, placeId: layerId }, 'atmosphere_layer_temperature');
  }
  if (
    layerTemperature.status === 'unknown' ||
    layerTemperature.status === 'not_applicable' ||
    layerTemperature.status === 'not_implemented'
  ) {
    return resolutionFromValue(
      layerTemperature,
      { bodyId, placeKind, placeId: layerId },
      'atmosphere_layer_temperature',
      `слой «${layerId}»: температура заявлена со статусом «${layerTemperature.status}» — как число не используется`
    );
  }
  return {
    temperature: unknownValue(
      `температура неизвестна: температура слоя «${layerId}» тела «${bodyId}» непригодна как числовое значение`
    ),
    bodyId,
    placeKind,
    placeId: layerId,
    source: 'none',
    reason: `температура слоя «${layerId}» непригодна как число`
  };
}

// ============================================
// 5. ДИАГНОСТИКА «ПРЕСЕТ vs T_eq»
// ============================================

/** Диагностическая запись о расхождении пресетной температуры и T_eq. */
export interface TemperatureDivergenceDiagnostic {
  /** Можно ли численно сравнить величины вообще. */
  comparable: boolean;
  /** |T_preset − T_eq|, K; null, если сравнение невозможно. */
  differenceK: number | null;
  verdict: 'not_comparable' | 'noted' | 'threshold_exceeded';
  /** Явно заданный порог, K; null — порог не задан. */
  thresholdK: number | null;
  message: string;
}

/**
 * Диагностика расхождения пресетной температуры атмосферы и
 * равновесной температуры T_eq (Stage 4.2.2).
 *
 * Пресетная температура и T_eq — РАЗНЫЕ величины с разным
 * происхождением; их расхождение фиксируется записью, а не
 * «исправлением» данных:
 * - порог задаётся ТОЛЬКО явной конфигурацией (конечное
 *   положительное число K); универсального порога «по умолчанию»
 *   не существует, выдумывать его запрещено;
 * - без порога (или ниже порога) — 'noted': разница известна,
 *   физическим противоречием НЕ объявляется;
 * - превышение явного порога — 'threshold_exceeded': возможная
 *   несовместимость допущений, ответственность на вызывающей
 *   стороне;
 * - непригодные входы — 'not_comparable' без выдумывания разницы;
 * - температуры НЕ изменяются ни в каком случае.
 */
export function diagnosePresetEquilibriumDivergence(
  presetTemperature: ScientificValue,
  equilibriumTemperature: ScientificValue,
  options?: { thresholdK?: number | null }
): TemperatureDivergenceDiagnostic {
  let thresholdK: number | null = null;
  if (options?.thresholdK !== undefined && options?.thresholdK !== null) {
    const threshold = options.thresholdK;
    if (typeof threshold !== 'number' || !Number.isFinite(threshold) || threshold <= 0) {
      throw new ThermalStateError(
        'invalid_threshold',
        `порог расхождения температур обязан быть конечным положительным числом кельвинов, получено ${String(threshold)} — универсального порога «по умолчанию» не существует`
      );
    }
    thresholdK = threshold;
  }
  const presetK = temperatureValueOrNull(presetTemperature);
  const equilibriumK = temperatureValueOrNull(equilibriumTemperature);
  const differentQuantitiesNote =
    'пресетная температура атмосферы и равновесная температура серого тела T_eq — РАЗНЫЕ величины с разным происхождением';
  if (presetK === null || equilibriumK === null) {
    const missing: string[] = [];
    if (presetK === null) {
      missing.push('пресетная температура непригодна как число');
    }
    if (equilibriumK === null) {
      missing.push('T_eq непригодно как число');
    }
    return {
      comparable: false,
      differenceK: null,
      verdict: 'not_comparable',
      thresholdK,
      message: `сравнение невозможно: ${missing.join('; ')}; ${differentQuantitiesNote}; расхождение не вычисляется и противоречием не объявляется`
    };
  }
  const differenceK = Math.abs(presetK - equilibriumK);
  if (thresholdK !== null && differenceK > thresholdK) {
    return {
      comparable: true,
      differenceK,
      verdict: 'threshold_exceeded',
      thresholdK,
      message: `расхождение ${differenceK.toFixed(3)} K превышает ЯВНО заданный порог ${thresholdK} K: ${differentQuantitiesNote}; расхождение может указывать на несовместимость исходных допущений — сами температуры не изменяются`
    };
  }
  return {
    comparable: true,
    differenceK,
    verdict: 'noted',
    thresholdK,
    message: `расхождение ${differenceK.toFixed(3)} K зафиксировано без объявления физического противоречия: ${differentQuantitiesNote}; порог не задан (или не превышен) — предположения допущений остаются на ответственности вызывающей стороны`
  };
}
