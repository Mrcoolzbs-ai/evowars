// ============================================
// KINETIC COMPARTMENT — физически явный реакционный слой
// (столбовый инвентарь ↔ концентрационный механизм)
// ============================================
//
// Stage 4.5.5, второй реализационный срез (2026-11-10). Этот срез
// НЕ завершает 4.5.5 и НЕ закрывает блокирующие вопросы 4.5.4:
// записи №1/№70/№72 остаются unknown (no_kinetic_data), JPL Table 2.1
// не извлечена, полная KIDA Troe-форма не реализована.
//
// Назначение модуля — отдельный STATELESS-адаптер между:
// - ЯВНЫМ столбовым инвентарём отдельных веществ, моль/м²;
// - ЯВНО заданной толщиной однородного реакционного слоя, м;
// - концентрационным механизмом первого среза 4.5.5
//   (runConcentrationKineticStep, molecule/cm³, записи №89/№106).
//
// Физические предпосылки слоя (явные, НЕ скрытые допущения):
// - слой однороден и хорошо перемешан: концентрация каждого вещества
//   постоянна по толщине, вертикальных градиентов нет;
// - слой изотермический: температура постоянна на всём шаге;
// - толщина слоя — постоянная ЯВНО переданная геометрическая величина;
// - перенос, диффузия, конвекция, осаждение и внешнее пополнение
//   веществ НЕ моделируются.
//
// Толщина слоя НЕ выводится из поверхностного давления, гравитации,
// средней молярной массы, масштаба высоты или каких-либо иных
// параметров мира: неявные атмосферные приближения запрещены.
// Запас N₂ передаётся явно и преобразуется в концентрацию третьего
// тела; N₂ НЕ выводится из доли азота, воздуха, смеси или давления.
//
// Преобразования единиц (N_A — точная константа определения СИ 2019,
// AVOGADRO_NUMBER_PER_MOL из Core/kinetics, без приближений):
//   [X] molecule/cm³ = C_X моль/м² · N_A / (L м · 10⁶)
//   C_X моль/м²     = [X] molecule/cm³ · L м · 10⁶ / N_A
//
// Адаптер НЕ подключён к GeneratedWorld/ChemicalEvolutionState/
// runChemicalEvolutionStep, не читает и не пишет состояние мира.
// Вычислитель k(T), каталог и решатель Radau IIA НЕ дублируются:
// шаг делегируется существующему runConcentrationKineticStep.
// Отказы используют существующую семантику KineticMechanismError
// (вторая иерархия ошибок НЕ вводится); при любом отказе частично
// обновлённый инвентарь НЕ возвращается. solveEquilibrium НЕ
// вызывается; режим A, extentFraction, gameSpeedCoefficient и
// заглушка runKineticStep — без изменений.

import { AVOGADRO_NUMBER_PER_MOL } from '../Core/kinetics';
import {
  KineticMechanismError,
  MECHANISM_REACTIONS,
  MECHANISM_SPECIES,
  MECHANISM_THIRD_BODY,
  runConcentrationKineticStep
} from './kineticMechanism';
import type { ConcentrationKineticStepResult, MechanismReactionDef } from './kineticMechanism';

// ============================================
// 1. ВХОДНОЙ КОНТРАКТ СЛОЯ
// ============================================

/**
 * Вход stateless-шага реакционного слоя. Ключи столбовых запасов —
 * канонические внутренние обозначения видов механизма
 * ('O', 'NO', 'NO2', 'H', 'O2', 'HO2', 'N2').
 * Для каждой выбранной реакции все её изменяемые виды обязаны
 * присутствовать в columnInventoriesMolM2: отсутствующий ключ —
 * ошибка входа, а не молчаливый ноль; явный ноль реакционного вида
 * допустим. Запас N₂ ('N2') обязателен, конечен и строго положителен.
 */
export interface KineticCompartmentStepInput {
  /** Постоянная температура слоя на всём шаге, K (конечная, строго положительная). */
  readonly temperatureK: number;
  /** Продолжительность шага, физические секунды (конечная, строго положительная). */
  readonly dtSeconds: number;
  /** Явно заданная толщина однородного реакционного слоя, м (конечная, строго положительная; НЕ выводится из параметров мира). */
  readonly layerThicknessM: number;
  /** Непустой список идентификаторов разрешённых реакций (№89/№106), без дублей. */
  readonly reactionIds: readonly string[];
  /** Явные столбовые запасы участвующих веществ, моль/м². */
  readonly columnInventoriesMolM2: Readonly<Record<string, number>>;
}

// ============================================
// 2. ПРЕОБРАЗОВАНИЯ ЕДИНИЦ (ЧИСТЫЕ ФУНКЦИИ)
// ============================================

function requireFinitePositive(name: string, value: number): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new KineticMechanismError(
      'invalid_input',
      name + ' должен быть конечным строго положительным числом, получено: ' + String(value),
      { field: name, value: String(value) }
    );
  }
}

function requireFiniteNonNegative(name: string, value: number): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new KineticMechanismError(
      'invalid_input',
      name + ' должен быть конечным неотрицательным числом (явный ноль допустим), получено: ' + String(value),
      { field: name, value: String(value) }
    );
  }
}

/**
 * Столбовый запас (моль/м²) → концентрация (molecule/cm³) однородного
 * слоя толщиной layerThicknessM:
 *   [X] = C·N_A/(L·10⁶).
 * Чистая функция: толщина обязана быть конечной строго положительной;
 * запас — конечным неотрицательным числом (отрицательный столбовый
 * запас физически не интерпретируется, а не «переворачивается»).
 * Численно устойчивое вычисление (корректирующий срез 2026-11-10):
 * переполнение ПРОМЕЖУТОЧНЫХ произведений НЕ считается отказом,
 * если математически конечный итог представим в Number (проверяется
 * несколькими порядками операций; первый — исходная арифметика,
 * прежняя точность обычного диапазона сохраняется). Отказ
 * invalid_input дают только непредставимые итоги: переполнение
 * конечного результата или underflow строго положительного входа
 * в ноль. Явный ноль входа остаётся допустимым (0 → 0).
 */
export function columnInventoryMolM2ToConcentrationMoleculeCm3(
  inventoryMolM2: number,
  layerThicknessM: number
): number {
  requireFiniteNonNegative('столбовый запас, моль/м²', inventoryMolM2);
  requireFinitePositive('layerThicknessM', layerThicknessM);
  // Численно устойчивое вычисление: [X] = C·N_A/(L·10⁶) в нескольких
  // порядках операций. Первый порядок — исходная арифметика (результат
  // для обычного диапазона совпадает с прежним байт-в-байт, точность
  // всех ранее проходивших преобразований сохраняется); дополнительные
  // порядки покрывают случаи, когда ПРОМЕЖУТОЧНОЕ произведение
  // переполняется или исчезает, хотя математически конечный итог
  // представим в Number (например, C = 1e-3 при L = 1e305:
  // итог ≈ 6.02214076e-291 представим, но L·10⁶ = Infinity).
  const candidates = [
    (inventoryMolM2 * AVOGADRO_NUMBER_PER_MOL) / (layerThicknessM * 1e6),
    (inventoryMolM2 / layerThicknessM) * (AVOGADRO_NUMBER_PER_MOL / 1e6),
    (inventoryMolM2 * (AVOGADRO_NUMBER_PER_MOL / 1e6)) / layerThicknessM
  ];
  // Представимый кандидат: конечен и либо равен нулю для нулевого
  // входа (0 → 0), либо строго положителен для положительного входа.
  const isRepresentable = (candidate: number): boolean =>
    Number.isFinite(candidate) && (inventoryMolM2 === 0 ? candidate === 0 : candidate > 0);
  for (const candidate of candidates) {
    if (isRepresentable(candidate)) {
      return candidate;
    }
  }
  // Ни один порядок операций не дал представимого итога: результат
  // либо не конечен (переполнение итога), либо строго положительный
  // вход округляется в ноль (underflow итога). Молчаливый Infinity
  // и молчаливая потеря вещества НЕ допускаются.
  if (candidates.some((candidate) => !Number.isFinite(candidate))) {
    throw new KineticMechanismError(
      'invalid_input',
      'переполнение преобразования столбового запаса в концентрацию: конечный результат не представим в Number; вход ' +
        String(inventoryMolM2) + ' моль/м², толщина слоя ' + String(layerThicknessM) + ' м',
      {
        operation: 'column_to_concentration',
        inventoryMolM2: String(inventoryMolM2),
        layerThicknessM: String(layerThicknessM)
      }
    );
  }
  throw new KineticMechanismError(
    'invalid_input',
    'underflow преобразования столбового запаса в концентрацию: строго положительный вход даёт ноль; вход ' +
      String(inventoryMolM2) + ' моль/м², толщина слоя ' + String(layerThicknessM) + ' м',
    {
      operation: 'column_to_concentration',
      inventoryMolM2: String(inventoryMolM2),
      layerThicknessM: String(layerThicknessM)
    }
  );
}

/**
 * Концентрация (molecule/cm³) → столбовый запас (моль/м²) однородного
 * слоя толщиной layerThicknessM:
 *   C = [X]·L·10⁶/N_A.
 * Чистая функция, обратная к columnInventoryMolM2ToConcentrationMoleculeCm3.
 * Численно устойчивое вычисление (корректирующий срез 2026-11-10):
 * переполнение ПРОМЕЖУТОЧНЫХ произведений НЕ считается отказом,
 * если математически конечный итог представим в Number (проверяется
 * несколькими порядками операций; первый — исходная арифметика,
 * прежняя точность обычного диапазона сохраняется). Отказ
 * invalid_input дают только непредставимые итоги: переполнение
 * конечного результата или underflow строго положительного входа
 * в ноль. Явный ноль входа остаётся допустимым (0 → 0).
 */
export function concentrationMoleculeCm3ToColumnInventoryMolM2(
  concentrationMoleculeCm3: number,
  layerThicknessM: number
): number {
  requireFiniteNonNegative('концентрация, molecule/cm³', concentrationMoleculeCm3);
  requireFinitePositive('layerThicknessM', layerThicknessM);
  // Численно устойчивое вычисление: C = [X]·L·10⁶/N_A в нескольких
  // порядках операций (первый — исходная арифметика: результат для
  // обычного диапазона совпадает с прежним байт-в-байт). Промежуточное
  // переполнение произведения НЕ считается отказом, если итог
  // представим в Number (например, [X] = 1e300 при L = 1e10:
  // итог ≈ 1.660539067e292 представим, но [X]·L·10⁶ = Infinity
  // в исходном порядке операций).
  const candidates = [
    (concentrationMoleculeCm3 * layerThicknessM * 1e6) / AVOGADRO_NUMBER_PER_MOL,
    (concentrationMoleculeCm3 / AVOGADRO_NUMBER_PER_MOL) * (layerThicknessM * 1e6),
    (concentrationMoleculeCm3 * (1e6 / AVOGADRO_NUMBER_PER_MOL)) * layerThicknessM
  ];
  // Представимый кандидат: конечен и либо равен нулю для нулевого
  // входа (0 → 0), либо строго положителен для положительного входа.
  const isRepresentable = (candidate: number): boolean =>
    Number.isFinite(candidate) &&
    (concentrationMoleculeCm3 === 0 ? candidate === 0 : candidate > 0);
  for (const candidate of candidates) {
    if (isRepresentable(candidate)) {
      return candidate;
    }
  }
  // Ни один порядок операций не дал представимого итога: переполнение
  // итога или underflow строго положительного входа в ноль.
  if (candidates.some((candidate) => !Number.isFinite(candidate))) {
    throw new KineticMechanismError(
      'invalid_input',
      'переполнение преобразования концентрации в столбовый запас: конечный результат не представим в Number; вход ' +
        String(concentrationMoleculeCm3) + ' molecule/cm³, толщина слоя ' + String(layerThicknessM) + ' м',
      {
        operation: 'concentration_to_column',
        concentrationMoleculeCm3: String(concentrationMoleculeCm3),
        layerThicknessM: String(layerThicknessM)
      }
    );
  }
  throw new KineticMechanismError(
    'invalid_input',
    'underflow преобразования концентрации в столбовый запас: строго положительный вход даёт ноль; вход ' +
      String(concentrationMoleculeCm3) + ' molecule/cm³, толщина слоя ' + String(layerThicknessM) + ' м',
    {
      operation: 'concentration_to_column',
      concentrationMoleculeCm3: String(concentrationMoleculeCm3),
      layerThicknessM: String(layerThicknessM)
    }
  );
}

// ============================================
// 3. РЕЗУЛЬТАТ ШАГА СЛОЯ
// ============================================

/** Сведения о N₂ — неизрасходованном третьем теле слоя. */
export interface KineticCompartmentThirdBody {
  readonly speciesId: 'N2';
  /** Столбовый запас N₂, моль/м² — передан явно, НЕ изменился. */
  readonly inventoryMolM2: number;
  /** Концентрация третьего тела, molecule/cm³ — вычислена из явного запаса и толщины слоя. */
  readonly concentrationMoleculeCm3: number;
  /** N₂ стехиометрически не расходуется: изменение за шаг равно нулю. */
  readonly consumedMolM2: 0;
  readonly note: string;
}

export interface KineticCompartmentStepResult {
  readonly status: 'applied';
  readonly temperatureK: number;
  readonly dtSeconds: number;
  readonly layerThicknessM: number;
  readonly appliedReactionIds: readonly string[];
  /**
   * Новый столбовый инвентарь, моль/м²: обновлены ТОЛЬКО изменяемые
   * виды выбранных реакций; N₂ и остальные переданные запасы
   * сохранены без изменений; вход НЕ мутируется (новый объект).
   */
  readonly updatedColumnInventoriesMolM2: Readonly<Record<string, number>>;
  /** Полный результат концентрационного механизма (первый срез 4.5.5), включая provenance и статистику Radau IIA. */
  readonly concentrationStep: ConcentrationKineticStepResult;
  readonly thirdBody: KineticCompartmentThirdBody;
  /** Предупреждения: перенесённые из механизма + ограничения применимости слоя. */
  readonly warnings: readonly string[];
  /** Явные предпосылки физической модели однородного слоя. */
  readonly assumptions: readonly string[];
  readonly notes: readonly string[];
}

// ============================================
// 4. ШАГ РЕАКЦИОННОГО СЛОЯ
// ============================================

/**
 * Один физически явный кинетический шаг реакционного слоя:
 * явные столбовые запасы (моль/м²) + явная толщина однородного слоя
 * преобразуются в концентрации molecule/cm³, шаг выполняется
 * существующим runConcentrationKineticStep (записи №89/№106),
 * изменившиеся концентрации преобразуются обратно в моль/м².
 *
 * Fail-closed: отсутствующий обязательный запас — ошибка входа, а не
 * ноль; NaN/Infinity/отрицательные запасы, нулевая/отрицательная
 * толщина — отказ; неизвестные ключи запасов — отказ; экстраполяция
 * температурных диапазонов — отказ (совместный выбор №89+№106
 * допустим только при 300 K, пересечения диапазонов; общий диапазон
 * 200–400 K НЕ заявляется).
 *
 * При любом отказе (включая отказы концентрационного механизма
 * и интегратора) частично обновлённый инвентарь НЕ возвращается:
 * пробрасывается существующая KineticMechanismError.
 */
export function runKineticCompartmentStep(
  input: KineticCompartmentStepInput
): KineticCompartmentStepResult {
  // 1. Форма входа и скалярные величины.
  if (input === null || typeof input !== 'object') {
    throw new KineticMechanismError(
      'invalid_input',
      'вход шага должен быть объектом KineticCompartmentStepInput'
    );
  }
  requireFinitePositive('temperatureK', input.temperatureK);
  requireFinitePositive('dtSeconds', input.dtSeconds);
  requireFinitePositive('layerThicknessM', input.layerThicknessM);
  if (!Array.isArray(input.reactionIds) || input.reactionIds.length === 0) {
    throw new KineticMechanismError(
      'invalid_input',
      'reactionIds обязан быть непустым списком идентификаторов реакций'
    );
  }
  for (const id of input.reactionIds) {
    if (typeof id !== 'string' || id.trim() === '') {
      throw new KineticMechanismError(
        'invalid_input',
        'reactionIds содержит не-строчный или пустой идентификатор'
      );
    }
  }

  // 2. Разрешение выбранных реакций в определения механизма.
  const selected: MechanismReactionDef[] = [];
  let hasUnresolvedId = false;
  for (const id of input.reactionIds) {
    const def = MECHANISM_REACTIONS.find((r) => r.reactionId === id);
    if (def) {
      selected.push(def);
    } else {
      hasUnresolvedId = true;
    }
  }
  if (hasUnresolvedId) {
    // Идентификатор вне ограниченного механизма: отказ делегируется
    // концентрационному механизму — единая семантика ошибок без
    // дублирования правил (no_kinetic_data для записей каталога вне
    // механизма, invalid_input для неизвестных идентификаторов и
    // дублей). runConcentrationKineticStep проверяет reactionIds ДО
    // концентраций, поэтому минимальный объект концентраций
    // достаточен для контролируемого отказа.
    runConcentrationKineticStep({
      temperatureK: input.temperatureK,
      dtSeconds: input.dtSeconds,
      reactionIds: input.reactionIds,
      concentrations: { [MECHANISM_THIRD_BODY]: 1 }
    });
    // Недостижимо для текущего механизма; защитный отказ.
    throw new KineticMechanismError(
      'invalid_input',
      'reactionIds содержит идентификатор вне ограниченного механизма'
    );
  }

  // 3. Столбовые запасы: все ключи явные, конечные, допустимые.
  const raw = input.columnInventoriesMolM2;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new KineticMechanismError(
      'invalid_input',
      'columnInventoriesMolM2 должен быть объектом «вид → запас, моль/м²»'
    );
  }
  const knownSpecies = new Set<string>(MECHANISM_SPECIES.map((s) => s.id));
  for (const [key, value] of Object.entries(raw)) {
    if (!knownSpecies.has(key)) {
      throw new KineticMechanismError(
        'invalid_input',
        'неизвестный вид в столбовых запасах: ' + key + ' (разрешены только ' + [...knownSpecies].join(', ') + ')',
        { species: key }
      );
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new KineticMechanismError(
        'invalid_input',
        'столбовый запас вида ' + key + ' должен быть конечным неотрицательным числом моль/м² (явный ноль допустим), получено: ' + String(value),
        { species: key, value: String(value) }
      );
    }
  }
  // N₂ — третье тело: запас обязателен, явен и строго положителен.
  if (!Object.prototype.hasOwnProperty.call(raw, MECHANISM_THIRD_BODY)) {
    throw new KineticMechanismError(
      'invalid_input',
      'столбовый запас третьего тела N₂ (ключ "N2") обязателен: отсутствующее поле — ошибка входа, а не молчаливый ноль; запас N₂ НЕ выводится из доли азота, воздуха, смеси или давления',
      { species: 'N2' }
    );
  }
  const n2Inventory = raw[MECHANISM_THIRD_BODY] as number;
  if (!(n2Inventory > 0)) {
    throw new KineticMechanismError(
      'invalid_input',
      'столбовый запас N₂ обязан быть конечным и строго положительным (третье тело), получено: ' + String(n2Inventory),
      { species: 'N2', value: String(n2Inventory) }
    );
  }
  // Обязательные виды выбранных реакций — явно (отсутствующий ключ —
  // ошибка входа, а не ноль).
  const requiredSpecies: string[] = [];
  for (const def of selected) {
    for (const species of def.species) {
      if (!requiredSpecies.includes(species)) {
        requiredSpecies.push(species);
      }
    }
  }
  for (const species of requiredSpecies) {
    if (!Object.prototype.hasOwnProperty.call(raw, species)) {
      throw new KineticMechanismError(
        'invalid_input',
        'реакция выбранных идентификаторов: отсутствует столбовый запас вида "' + species + '" — отсутствующее поле есть ошибка входа, а не молчаливый ноль (явный ноль допустим)',
        { species }
      );
    }
  }

  // 4. Преобразование явных запасов в концентрации molecule/cm³.
  const concentrations: Record<string, number> = {};
  for (const [species, inventory] of Object.entries(raw)) {
    concentrations[species] = columnInventoryMolM2ToConcentrationMoleculeCm3(
      inventory,
      input.layerThicknessM
    );
  }

  // 5. Шаг концентрационного механизма (без дублирования k(T), RHS,
  // якобиана и интегратора); отказы пробрасываются как есть.
  const concentrationStep = runConcentrationKineticStep({
    temperatureK: input.temperatureK,
    dtSeconds: input.dtSeconds,
    reactionIds: [...input.reactionIds],
    concentrations
  });

  // 6. Обратное преобразование ТОЛЬКО изменившихся видов.
  const updated: Record<string, number> = {};
  for (const [species, inventory] of Object.entries(raw)) {
    updated[species] = inventory;
  }
  for (const species of concentrationStep.speciesOrder) {
    const value = concentrationStep.concentrations[species];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new KineticMechanismError(
        'invalid_input',
        'концентрационный механизм вернул недопустимую концентрацию вида ' + species + ': столбовый запас НЕ обновляется',
        { species }
      );
    }
    updated[species] = concentrationMoleculeCm3ToColumnInventoryMolM2(
      value,
      input.layerThicknessM
    );
  }

  // 7. Результат: предпосылки и ограничения фиксируются явно.
  return {
    status: 'applied',
    temperatureK: input.temperatureK,
    dtSeconds: input.dtSeconds,
    layerThicknessM: input.layerThicknessM,
    appliedReactionIds: [...input.reactionIds],
    updatedColumnInventoriesMolM2: updated,
    concentrationStep,
    thirdBody: {
      speciesId: 'N2',
      inventoryMolM2: n2Inventory,
      concentrationMoleculeCm3: concentrations[MECHANISM_THIRD_BODY],
      consumedMolM2: 0,
      note: 'N₂ — третье тело (bath gas): столбовый запас передан явно, задаёт концентрацию третьего тела, стехиометрически не расходуется и в результате не изменяется'
    },
    warnings: [
      ...concentrationStep.warnings,
      'толщина реакционного слоя (' + input.layerThicknessM + ' м) передана ЯВНО и НЕ выводится из поверхностного давления, гравитации, средней молярной массы или масштаба высоты: результат линейно зависит от выбранной толщины',
      'концентрация N₂ вычислена из ЯВНО переданного столбового запаса N₂ и толщины слоя: N₂ НЕ выводится из доли азота, воздуха, смеси или давления'
    ],
    assumptions: [
      'слой однороден и хорошо перемешан: концентрация каждого вещества постоянна по толщине слоя, вертикальные градиенты концентраций отсутствуют',
      'слой изотермический: температура постоянна на всём шаге',
      'толщина слоя постоянна и задана явно (геометрическая величина, не выводимая из параметров мира)',
      'перенос, диффузия, конвекция, осаждение и внешнее пополнение веществ НЕ моделируются',
      'химический состав изменяется только выбранными реакциями механизма №89/№106 внутри слоя'
    ],
    notes: [
      'stateless API реакционного слоя: к GeneratedWorld/ChemicalEvolutionState/runChemicalEvolutionStep НЕ подключён; состояние мира не читается и не пишется; этап 4.5.5 этим срезом НЕ завершён',
      'преобразование единиц: [X] molecule/cm³ = C·N_A/(L·10⁶), C моль/м² = [X]·L·10⁶/N_A; N_A = 6.02214076×10²³ 1/моль — точная константа определения СИ 2019 (AVOGADRO_NUMBER_PER_MOL из Core/kinetics), приближённое значение НЕ используется',
      'обновлены ТОЛЬКО изменяемые виды выбранных реакций; N₂ и остальные переданные запасы сохранены без изменений',
      'записи №1/№70/№72 остаются unknown (no_kinetic_data) и в механизм не входят; совместный выбор №89+№106 допустим только при 300 K (пересечение диапазонов применимости, общий диапазон 200–400 K НЕ заявляется)',
      'при отказе концентрационного механизма частично обновлённый инвентарь НЕ возвращается: пробрасывается существующая KineticMechanismError'
    ]
  };
}
