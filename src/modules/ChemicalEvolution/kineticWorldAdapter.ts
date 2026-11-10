// ============================================
// KINETIC WORLD ADAPTER — пользовательский кинетический
// эксперимент №89/№106 в паспорте мира
// ============================================
//
// Stage 4.5.5, интеграционный срез (2026-11-10). Этот срез НЕ
// завершает 4.5.5 и НЕ закрывает блокирующие вопросы 4.5.4:
// записи №1/№70/№72 остаются unknown (no_kinetic_data) и в механизм
// не входят; совместный сегмент №89+№106 допустим только при 300 K.
//
// Эксперимент — ОТДЕЛЬНОЕ опциональное состояние мира
// (GeneratedWorld.kineticExperiment):
// - начальные запасы задаёт пользователь ЯВНО (все семь видов в
//   моль/м²): они НЕ заимствуются из chemicalState.inventory и не
//   извлекаются из атмосферного состава (радикалов O, NO, NO2, H,
//   HO2 в атмосферном каталоге нет);
// - толщина слоя НЕ выводится из давления, гравитации, молярной
//   массы или масштаба высоты;
// - запас N₂ НЕ выводится из доли азота, воздуха, смеси или
//   давления: он задаётся явно и строго положительным;
// - физическое время — сумма dtSeconds сегментов в физических
//   секундах; gameTime/extentFraction/gameSpeedCoefficient/игровые
//   годы НЕ участвуют;
// - режим A (applyReaction/runChemicalEvolutionStep) и
//   ChemicalEvolutionState НЕ меняются: эксперимент к ним не
//   подключён, стехиометрический и кинетический инвентари не
//   смешиваются.
//
// Контракт атомарности: состояние мира обновляется только после
// ПОЛНОГО успешного завершения траектории. При любой ошибке
// выбрасывается существующая KineticMechanismError; исходный мир
// не мутируется, частично обновлённый эксперимент не возвращается.
// Результаты эксперимента НЕ выдаются за рассчитанную эволюцию
// атмосферы планеты: перенос, диффузия, конвекция и пополнение
// вещества не моделируются.
//
// Срез кинетической трассируемости (2026-11-10, схема состояния
// 1.1.0): каждый новый успешно выполненный сегмент получает audit —
// снимок ФАКТИЧЕСКОГО результата вычислителя (AppliedReactionSummary
// каждого применённого результата: константа, единица, диапазон,
// provenance, компонентный provenance, fall-off-диагностика; модель
// концентраций и фактическая концентрация N₂ того же результата).
// Снимок берётся напрямую из результата runKineticCompartmentTrajectory:
// значения НЕ пересчитываются (evaluateRateConstant повторно НЕ
// вызывается) и НЕ реконструируются по каталогу после расчёта.
// Сегменты старой схемы 1.0.0 помечаются миграцией сохранений
// 1.5 → 1.6 как unavailable_legacy: исторический снимок не
// записывался, численные значения задним числом НЕ выдумываются.
//
// Корректирующий пакет целостности снимков (2026-11-10): контракт
// снимков СТРОГИЙ. unavailable_legacy допускает РОВНО два ключа —
// kind и reason: любое постороннее поле (численные результаты,
// provenance или неизвестное содержимое) запрещено и
// диагностируется, а не отбрасывается и не нормализуется.
// Единица константы recorded-снимка сверяется с механизмом:
// для №89/№106 при модели концентраций molecule_cm3 фактическая
// единица обязана быть cm3_per_molecule_per_s (общий реестр единиц
// не сужается, вычислитель не меняется). fall-off-диагностика
// согласована внутренне: приведённое давление конечное строго
// положительное, логарифм равен фактической операции вычислителя
// Math.log10(reducedPressure) — сверка сохранённых чисел с самими
// собой, повторный кинетический расчёт НЕ выполняется.

import type {
  GeneratedWorld,
  KineticExperimentInventoryMolM2,
  KineticExperimentRunRecord,
  KineticExperimentSegmentAudit,
  KineticExperimentState
} from '../../types';
import type { DataProvenance } from '../Core/scientificValue';
import { RATE_CONSTANT_UNITS } from '../Core/kinetics';
import { KineticMechanismError } from './kineticMechanism';
import { runKineticCompartmentTrajectory } from './kineticTrajectory';
import type {
  KineticCompartmentTrajectorySegmentInput,
  KineticCompartmentTrajectorySegmentResult
} from './kineticTrajectory';

/** Версия схемы состояния эксперимента (KineticExperimentState.schemaVersion). */
export const KINETIC_EXPERIMENT_SCHEMA_VERSION = '1.1.0';

/**
 * Прежняя версия схемы состояния эксперимента: сегменты истории без
 * снимков аудита. Миграция сохранений 1.5 → 1.6 помечает такие
 * сегменты unavailable_legacy и поднимает схему до 1.1.0.
 */
export const KINETIC_EXPERIMENT_LEGACY_SCHEMA_VERSION = '1.0.0';

/**
 * Явная причина отсутствия исторического снимка у сегментов,
 * созданных до введения снимков аудита. Численные значения
 * задним числом не восстанавливаются и не выдумываются.
 */
export const KINETIC_EXPERIMENT_LEGACY_AUDIT_REASON =
  'сегмент выполнен до введения снимков аудита (схема состояния 1.0.0): фактические параметры расчёта в момент выполнения не записывались; численные значения задним числом не восстанавливаются и не выдумываются';

/** Виды ограниченного механизма (в каноническом порядке каталога). */
export const KINETIC_EXPERIMENT_SPECIES = ['O', 'NO', 'NO2', 'H', 'O2', 'HO2', 'N2'] as const;

/** Идентификаторы реакций механизма №89/№106 (другие запрещены). */
const MECHANISM_REACTION_IDS = ['kida-tb-2015-03-19-89', 'kida-tb-2015-03-19-106'] as const;

/**
 * Единственная фактическая единица эффективной константы механизма
 * №89/№106 при модели концентраций molecule_cm3: обе записи —
 * fall-off второго порядка, эффективная единица равна единице k∞.
 * Это СТРОГОЕ соответствие фактического снимка механизму:
 * зарегистрированная, но физически несовместимая единица (например
 * m3_per_mol_per_s или per_s) не принимается. Общий реестр единиц
 * RATE_CONSTANT_UNITS не сужается, вычислитель не меняется.
 */
const MECHANISM_RATE_CONSTANT_UNIT = 'cm3_per_molecule_per_s';

/**
 * Явные начальные запасы при первичной настройке. Все семь полей
 * задаются пользователем: ОТСУТСТВУЮЩЕЕ поле — отсутствие значения,
 * а не ноль (ошибка настройки, а не молчаливый ноль). Явный ноль
 * допустим для реакционных видов; N₂ — конечный строго
 * положительный.
 */
export interface KineticExperimentInventoryInput {
  readonly O?: number;
  readonly NO?: number;
  readonly NO2?: number;
  readonly H?: number;
  readonly O2?: number;
  readonly HO2?: number;
  readonly N2?: number;
}

/** Явная первичная настройка эксперимента (только для первого запуска). */
export interface KineticExperimentSetupInput {
  /** Постоянная толщина однородного реакционного слоя, м (конечная, > 0; НЕ выводится из параметров мира). */
  readonly layerThicknessM: number;
  /** Явные начальные запасы всех семи видов, моль/м². */
  readonly initialInventoriesMolM2: KineticExperimentInventoryInput;
}

/**
 * Вход runWorldKineticTrajectory: расписание сегментов (контракт
 * существующего runKineticCompartmentTrajectory) и, только для
 * ПЕРВОГО запуска, явная настройка. При продолжении уже
 * настроенного эксперимента setup не принимается: для смены
 * начальных условий нужен явный сброс (resetWorldKineticExperiment)
 * и новая настройка.
 */
export interface WorldKineticTrajectoryInput {
  readonly segments: readonly KineticCompartmentTrajectorySegmentInput[];
  readonly setup?: KineticExperimentSetupInput;
}

// ============================================
// 1. ВАЛИДАЦИЯ СОСТОЯНИЯ ЭКСПЕРИМЕНТА
// ============================================

/**
 * Проблемы формы инвентаря эксперимента (семь явных видов).
 * Проверяются: присутствие всех семи ключей, конечность,
 * неотрицательность, строгая положительность N₂, отсутствие
 * unknown-ключей.
 */
function inventoryProblems(inventory: unknown, label: string): string[] {
  if (typeof inventory !== 'object' || inventory === null || Array.isArray(inventory)) {
    return [label + ': ожидается объект инвентаря с явными запасами семи видов, моль/м²'];
  }
  const record = inventory as Record<string, unknown>;
  const problems: string[] = [];
  for (const species of KINETIC_EXPERIMENT_SPECIES) {
    const value = record[species];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      problems.push(label + '.' + species + ': ожидается конечное число (моль/м²)');
      continue;
    }
    if (value < 0) {
      problems.push(label + '.' + species + ': отрицательный запас запрещён');
    }
    if (species === 'N2' && value <= 0) {
      problems.push(label + '.N2: запас N₂ обязан быть конечным и строго положительным (третье тело механизма)');
    }
  }
  const unknownKeys = Object.keys(record).filter(
    (key) => !(KINETIC_EXPERIMENT_SPECIES as readonly string[]).includes(key)
  );
  if (unknownKeys.length > 0) {
    problems.push(label + ': неизвестные ключи ' + unknownKeys.join(', ') + ' (механизм ограничен видами O, NO, NO2, H, O2, HO2, N2)');
  }
  return problems;
}

/**
 * Проверка формы состояния эксперимента (для состояний, пришедших
 * из сохранений/импорта, и перед продолжением эксперимента).
 * Аналогично валидации журнала реакций (4.2.3.3.1): некорректное
 * состояние НЕ «чинится» молча и не подменяется пустым — проблемы
 * возвращаются диагностикой. undefined — отсутствие эксперимента,
 * не ошибка; явный null — некорректная форма.
 *
 * Пакетное усиление целостности (этап 4.5.5): строгие инварианты
 * согласованности. Пустая история обязана иметь нулевое
 * накопленное время и нулевой счётчик запусков; индекс сегмента
 * обязан соответствовать позиции; конец каждого сегмента обязан
 * в точности совпадать с результатом той же операции накопления,
 * которая используется при построении расписания (expectedEnd =
 * expectedStart + dtSeconds, без допусков), с явным обнаружением
 * переполнения; успешный запуск обязан иметь непустой список
 * сегментов; начальный инвентарь запуска N равен конечному
 * инвентарю запуска N−1 по всем семи видам; текущий инвентарь
 * равен конечному инвентарю последнего завершённого запуска.
 * Никаких автоисправлений, нормализации и подстановок нулей.
 *
 * Срез трассируемости (схема 1.1.0): сегмент состояния 1.1.0
 * обязан иметь audit; recorded-снимок проверяется на полноту
 * фактических численных значений, корректность диапазона
 * (температура сегмента внутри фактически применённой
 * применимости), структуру provenance, точное соответствие
 * идентификаторов и числа записей аудита расписанию; дубликаты
 * и неизвестные реакции запрещены; unavailable_legacy не может
 * содержать численные результаты.
 */
/** Строковые поля DataProvenance (все опциональны). */
const AUDIT_PROVENANCE_STRING_FIELDS: readonly string[] = [
  'sourceName',
  'sourceId',
  'datasetId',
  'datasetVersion',
  'recordId',
  'reference',
  'retrievedAt',
  'method',
  'applicability',
  'limitations',
  'conditions',
  'modelVersion',
  'license',
  'note'
];

/** Поля, идентифицирующие источник (минимум один непустой обязателен). */
const AUDIT_PROVENANCE_IDENTIFICATION_FIELDS: readonly string[] = ['sourceName', 'sourceId', 'datasetId', 'reference'];

/**
 * Структурная проверка provenance снимка (по образцу provenanceIssues
 * вычислителя): объект, строковые поля при наличии — строки,
 * идентификация источника минимум одним непустым полем, rawInput —
 * объект скалярных значений. Никаких подстановок фиктивных источников.
 */
function auditProvenanceProblems(value: unknown, label: string): string[] {
  const problems: string[] = [];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return [label + ': ожидается объект provenance'];
  }
  const provenance = value as Record<string, unknown>;
  for (const field of AUDIT_PROVENANCE_STRING_FIELDS) {
    const fieldValue = provenance[field];
    if (fieldValue === undefined) {
      continue;
    }
    if (typeof fieldValue !== 'string') {
      problems.push(label + '.' + field + ': ожидается строка provenance, получено ' + typeof fieldValue);
    } else if ((AUDIT_PROVENANCE_IDENTIFICATION_FIELDS as readonly string[]).includes(field) && fieldValue.trim() === '') {
      problems.push(label + '.' + field + ': пустая строка не идентифицирует источник');
    }
  }
  const identified = (AUDIT_PROVENANCE_IDENTIFICATION_FIELDS as readonly string[]).some(
    (field) => typeof provenance[field] === 'string' && (provenance[field] as string).trim() !== ''
  );
  if (!identified) {
    problems.push(label + ': provenance не идентифицирует источник (нужен непустой sourceName, sourceId, datasetId или reference); фиктивный источник не подставляется');
  }
  const raw = provenance.rawInput;
  if (raw !== undefined) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      problems.push(label + '.rawInput: ожидается объект скалярных значений (number | string | boolean | null)');
    } else {
      for (const [key, rawValue] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof rawValue === 'number') {
          if (!Number.isFinite(rawValue)) {
            problems.push(label + '.rawInput.' + key + ': ожидается конечное число');
          }
        } else if (typeof rawValue !== 'string' && typeof rawValue !== 'boolean' && rawValue !== null) {
          problems.push(label + '.rawInput.' + key + ': недопустимый тип значения (' + typeof rawValue + ')');
        }
      }
    }
  }
  return problems;
}

/**
 * Проверка снимка кинетической трассируемости сегмента схемы 1.1.0:
 * recorded обязан содержать все обязательные конечные численные
 * значения, корректный диапазон (включая температуру сегмента),
 * структурно корректный provenance и точное соответствие
 * идентификаторов/числа записей расписанию; дубликаты и неизвестные
 * реакции запрещены; unavailable_legacy обязан иметь явную причину
 * и не может содержать численные результаты.
 */
function segmentAuditProblems(
  audit: unknown,
  segLabel: string,
  reactionIds: unknown,
  temperatureK: unknown
): string[] {
  const problems: string[] = [];
  if (audit === undefined) {
    return [
      segLabel + '.audit: снимок кинетической трассируемости обязателен для сегмента схемы ' + KINETIC_EXPERIMENT_SCHEMA_VERSION + ': recorded (фактический результат вычислителя) или unavailable_legacy (явная причина)'
    ];
  }
  if (typeof audit !== 'object' || audit === null || Array.isArray(audit)) {
    return [segLabel + '.audit: снимок аудита должен быть объектом с явным kind (recorded | unavailable_legacy)'];
  }
  const auditRecord = audit as Record<string, unknown>;
  if (auditRecord.kind === 'unavailable_legacy') {
    if (typeof auditRecord.reason !== 'string' || auditRecord.reason.trim() === '') {
      problems.push(segLabel + '.audit.reason: ожидается непустая причина отсутствия исторического снимка');
    }
    // Строгая форма: unavailable_legacy допускает РОВНО два ключа —
    // kind и reason. Любое постороннее поле (численные результаты,
    // provenance или произвольное неизвестное содержимое) запрещено:
    // неизвестное не отбрасывается и не нормализуется, а
    // диагностируется.
    for (const key of Object.keys(auditRecord)) {
      if (key !== 'kind' && key !== 'reason') {
        problems.push(
          segLabel + '.audit.' + key + ': снимок unavailable_legacy не может содержать численные результаты или какие-либо поля кроме kind и reason: исторические значения не записывались и задним числом не восстанавливаются; постороннее содержимое не отбрасывается и не нормализуется, а диагностируется'
        );
      }
    }
    return problems;
  }
  if (auditRecord.kind !== 'recorded') {
    return [segLabel + '.audit.kind: ожидается recorded | unavailable_legacy, получено: ' + String(auditRecord.kind)];
  }
  if (auditRecord.concentrationModel !== 'molecule_cm3') {
    problems.push(segLabel + '.audit.concentrationModel: контракт механизма — molecule_cm3, получено: ' + String(auditRecord.concentrationModel));
  }
  const n2 = auditRecord.thirdBodyN2MoleculeCm3;
  if (typeof n2 !== 'number' || !Number.isFinite(n2) || n2 <= 0) {
    problems.push(segLabel + '.audit.thirdBodyN2MoleculeCm3: ожидается конечная строго положительная фактическая концентрация N₂, molecule/cm³');
  }
  const reactions = auditRecord.reactions;
  if (!Array.isArray(reactions) || reactions.length === 0) {
    problems.push(segLabel + '.audit.reactions: ожидается непустой массив аудиозаписей применённых реакций');
    return problems;
  }
  if (Array.isArray(reactionIds) && reactions.length !== reactionIds.length) {
    problems.push(segLabel + '.audit.reactions: число записей аудита (' + reactions.length + ') не совпадает с расписанием сегмента (' + reactionIds.length + ')');
  }
  reactions.forEach((entry, entryIndex) => {
    const entryLabel = segLabel + '.audit.reactions[' + entryIndex + ']';
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      problems.push(entryLabel + ': аудиозапись должна быть объектом');
      return;
    }
    const reaction = entry as Record<string, unknown>;
    if (Array.isArray(reactionIds) && reaction.reactionId !== reactionIds[entryIndex]) {
      problems.push(entryLabel + '.reactionId: не совпадает с расписанием сегмента (ожидалось: ' + String(reactionIds[entryIndex]) + ', получено: ' + String(reaction.reactionId) + ')');
    }
    if (typeof reaction.reactionId !== 'string' || !(MECHANISM_REACTION_IDS as readonly string[]).includes(reaction.reactionId)) {
      problems.push(entryLabel + '.reactionId: неизвестная реакция (механизм ограничен №89/№106)');
    }
    if (typeof reaction.label !== 'string' || reaction.label.trim() === '') {
      problems.push(entryLabel + '.label: ожидается непустая метка реакции');
    }
    if (reaction.dataStatus !== 'known' && reaction.dataStatus !== 'estimated') {
      problems.push(entryLabel + '.dataStatus: ожидается known | estimated, получено: ' + String(reaction.dataStatus));
    }
    const rateConstant = reaction.rateConstant;
    if (typeof rateConstant !== 'object' || rateConstant === null || Array.isArray(rateConstant)) {
      problems.push(entryLabel + '.rateConstant: ожидается объект {value, unit} фактической константы');
    } else {
      const rc = rateConstant as Record<string, unknown>;
      if (typeof rc.value !== 'number' || !Number.isFinite(rc.value) || rc.value <= 0) {
        problems.push(entryLabel + '.rateConstant.value: ожидается конечная положительная фактически вычисленная константа');
      }
      if (typeof rc.unit !== 'string' || !(RATE_CONSTANT_UNITS as readonly string[]).includes(rc.unit)) {
        problems.push(entryLabel + '.rateConstant.unit: единица должна быть из кинетического реестра, получено: ' + String(rc.unit));
      } else if (
        auditRecord.concentrationModel === 'molecule_cm3' &&
        typeof reaction.reactionId === 'string' &&
        (MECHANISM_REACTION_IDS as readonly string[]).includes(reaction.reactionId) &&
        rc.unit !== MECHANISM_RATE_CONSTANT_UNIT
      ) {
        // Строгая размерность: общая принадлежность реестру единиц
        // недостаточна — единица обязана соответствовать фактическому
        // механизму (№89/№106, molecule_cm3) и его эффективной
        // размерности. Реестр единиц не сужается, вычислитель не
        // вызывается: сверяется сохранённый факт, а не расчёт.
        problems.push(
          entryLabel + '.rateConstant.unit: фактическая единица константы механизма №89/№106 при модели концентраций molecule_cm3 обязана быть ' + MECHANISM_RATE_CONSTANT_UNIT + ', получено: ' + rc.unit + ' (зарегистрированная, но физически несовместимая с этим механизмом размерность не принимается)'
        );
      }
    }
    const range = reaction.appliedRangeK;
    if (typeof range !== 'object' || range === null || Array.isArray(range)) {
      problems.push(entryLabel + '.appliedRangeK: ожидается объект {min, max} фактически применённого диапазона, K');
    } else {
      const appliedRange = range as Record<string, unknown>;
      if (
        typeof appliedRange.min !== 'number' ||
        !Number.isFinite(appliedRange.min) ||
        typeof appliedRange.max !== 'number' ||
        !Number.isFinite(appliedRange.max) ||
        appliedRange.min <= 0 ||
        appliedRange.min > appliedRange.max
      ) {
        problems.push(entryLabel + '.appliedRangeK: ожидается корректный диапазон фактически применённой применимости 0 < min <= max, K');
      } else if (
        typeof temperatureK === 'number' &&
        Number.isFinite(temperatureK) &&
        (temperatureK < appliedRange.min || temperatureK > appliedRange.max)
      ) {
        problems.push(entryLabel + '.appliedRangeK: температура сегмента (' + temperatureK + ' K) вне диапазона фактически применённой применимости [' + appliedRange.min + ', ' + appliedRange.max + '] K');
      }
    }
    problems.push(...auditProvenanceProblems(reaction.provenance, entryLabel + '.provenance'));
    const parameterProvenance = reaction.parameterProvenance;
    if (typeof parameterProvenance !== 'object' || parameterProvenance === null || Array.isArray(parameterProvenance)) {
      problems.push(entryLabel + '.parameterProvenance: ожидается объект компонентного provenance параметров fall-off');
    } else {
      const pp = parameterProvenance as Record<string, unknown>;
      problems.push(...auditProvenanceProblems(pp.lowPressureLimit, entryLabel + '.parameterProvenance.lowPressureLimit'));
      problems.push(...auditProvenanceProblems(pp.highPressureLimit, entryLabel + '.parameterProvenance.highPressureLimit'));
      problems.push(...auditProvenanceProblems(pp.broadening, entryLabel + '.parameterProvenance.broadening'));
    }
    const fallOff = reaction.fallOff;
    if (typeof fallOff !== 'object' || fallOff === null || Array.isArray(fallOff)) {
      problems.push(entryLabel + '.fallOff: ожидается фактическая диагностика fall-off вычисления');
    } else {
      const fo = fallOff as Record<string, unknown>;
      for (const field of ['lowPressureLimit', 'highPressureLimit'] as const) {
        if (typeof fo[field] !== 'number' || !Number.isFinite(fo[field]) || (fo[field] as number) <= 0) {
          problems.push(entryLabel + '.fallOff.' + field + ': ожидается конечный положительный предел fall-off');
        }
      }
      // Приведённое давление: конечное строго положительное (нулевое
      // или отрицательное Pr — неинтерпретируемая диагностика, а не
      // «маленькое давление»).
      if (typeof fo.reducedPressure !== 'number' || !Number.isFinite(fo.reducedPressure) || fo.reducedPressure <= 0) {
        problems.push(entryLabel + '.fallOff.reducedPressure: ожидается конечное строго положительное приведённое давление fall-off');
      }
      if (typeof fo.log10ReducedPressure !== 'number' || !Number.isFinite(fo.log10ReducedPressure)) {
        problems.push(entryLabel + '.fallOff.log10ReducedPressure: ожидается конечное число диагностики fall-off');
      }
      // Внутренняя согласованность уже сохранённых фактических чисел:
      // логарифм обязан совпадать с фактической операцией вычислителя
      // Math.log10(reducedPressure). Это сверка снимка с самим собой,
      // а НЕ повторный кинетический расчёт: параметры из каталога не
      // загружаются, evaluateRateConstant не вызывается.
      if (
        typeof fo.reducedPressure === 'number' && Number.isFinite(fo.reducedPressure) && fo.reducedPressure > 0 &&
        typeof fo.log10ReducedPressure === 'number' && Number.isFinite(fo.log10ReducedPressure) &&
        fo.log10ReducedPressure !== Math.log10(fo.reducedPressure)
      ) {
        problems.push(
          entryLabel + '.fallOff.log10ReducedPressure: логарифм не согласован с приведённым давлением: Math.log10(' + fo.reducedPressure + ') = ' + Math.log10(fo.reducedPressure) + ', получено: ' + fo.log10ReducedPressure + ' (сверяется фактическая операция вычислителя, повторный расчёт не выполняется)'
        );
      }
      if (
        typeof fo.broadeningFactor !== 'number' ||
        !Number.isFinite(fo.broadeningFactor) ||
        fo.broadeningFactor <= 0 ||
        fo.broadeningFactor > 1
      ) {
        problems.push(entryLabel + '.fallOff.broadeningFactor: ожидается конечный фактор уширения в (0, 1]');
      }
    }
  });
  if (auditRecord.integration !== undefined) {
    if (typeof auditRecord.integration !== 'object' || auditRecord.integration === null || Array.isArray(auditRecord.integration)) {
      problems.push(segLabel + '.audit.integration: ожидается объект диагностики интегратора из фактического результата');
    } else {
      const integration = auditRecord.integration as Record<string, unknown>;
      if (typeof integration.method !== 'string' || integration.method.trim() === '') {
        problems.push(segLabel + '.audit.integration.method: ожидается непустой идентификатор метода из фактического результата');
      }
      for (const field of ['minorNegativeCount', 'invariantChecks'] as const) {
        if (typeof integration[field] !== 'number' || !Number.isInteger(integration[field]) || (integration[field] as number) < 0) {
          problems.push(segLabel + '.audit.integration.' + field + ': ожидается неотрицательное целое из фактического результата');
        }
      }
    }
  }
  return problems;
}

export function kineticExperimentStateProblems(state: unknown): string[] {
  if (state === undefined) {
    return [];
  }
  if (state === null) {
    return ['состояние равно null: отсутствие эксперимента выражается отсутствием поля, а не null (некорректная форма)'];
  }
  if (typeof state !== 'object' || Array.isArray(state)) {
    const description = Array.isArray(state) ? 'массив' : 'значение типа ' + typeof state;
    return ['состояние должно быть объектом KineticExperimentState (или отсутствовать), получено: ' + description];
  }
  const record = state as Record<string, unknown>;
  const problems: string[] = [];
  if (typeof record.schemaVersion !== 'string' || record.schemaVersion !== KINETIC_EXPERIMENT_SCHEMA_VERSION) {
    const got = typeof record.schemaVersion === 'string' ? record.schemaVersion : typeof record.schemaVersion;
    problems.push('schemaVersion: ожидается «' + KINETIC_EXPERIMENT_SCHEMA_VERSION + '», получено: ' + got + ' (состояние не мигрируется и не «чинится» автоматически)');
  }
  if (typeof record.layerThicknessM !== 'number' || !Number.isFinite(record.layerThicknessM) || record.layerThicknessM <= 0) {
    problems.push('layerThicknessM: ожидается конечная строго положительная толщина реакционного слоя, м');
  }
  problems.push(...inventoryProblems(record.currentInventoriesMolM2, 'currentInventoriesMolM2'));
  if (typeof record.elapsedSeconds !== 'number' || !Number.isFinite(record.elapsedSeconds) || record.elapsedSeconds < 0) {
    problems.push('elapsedSeconds: ожидается конечное неотрицательное накопленное физическое время, с');
  }
  if (typeof record.completedRuns !== 'number' || !Number.isInteger(record.completedRuns) || record.completedRuns < 0) {
    problems.push('completedRuns: ожидается неотрицательное целое число завершённых запусков');
  }
  if (!Array.isArray(record.history)) {
    problems.push('history: ожидается массив записей успешно завершённых запусков');
    return problems;
  }
  if (
    typeof record.completedRuns === 'number' &&
    Number.isInteger(record.completedRuns) &&
    record.completedRuns >= 0 &&
    record.history.length !== record.completedRuns
  ) {
    problems.push('history: длина истории (' + record.history.length + ') не совпадает с completedRuns (' + record.completedRuns + ')');
  }
  if (record.history.length === 0) {
    // Пустая история: ни одного успешного запуска не завершено,
    // поэтому накопленное физическое время обязано быть ровно нулём
    // (никаких скрытых секунд без записей запусков).
    if (typeof record.elapsedSeconds === 'number' && Number.isFinite(record.elapsedSeconds) && record.elapsedSeconds !== 0) {
      problems.push('elapsedSeconds: при пустой истории накопленное физическое время обязано быть 0, получено: ' + record.elapsedSeconds);
    }
  }
  record.history.forEach((run, index) => {
    const label = 'history[' + index + ']';
    if (typeof run !== 'object' || run === null || Array.isArray(run)) {
      problems.push(label + ': запись запуска должна быть объектом KineticExperimentRunRecord');
      return;
    }
    const runRecord = run as Record<string, unknown>;
    if (runRecord.runIndex !== index) {
      problems.push(label + '.runIndex: ожидается ' + index + ' (последовательность запусков нарушена)');
    }
    problems.push(...inventoryProblems(runRecord.startInventoriesMolM2, label + '.startInventoriesMolM2'));
    problems.push(...inventoryProblems(runRecord.endInventoriesMolM2, label + '.endInventoriesMolM2'));
    for (const field of ['startElapsedSeconds', 'endElapsedSeconds'] as const) {
      const value = runRecord[field];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        problems.push(label + '.' + field + ': ожидается конечное неотрицательное накопленное время, с');
      }
    }
    if (
      typeof runRecord.startElapsedSeconds === 'number' &&
      typeof runRecord.endElapsedSeconds === 'number' &&
      runRecord.endElapsedSeconds < runRecord.startElapsedSeconds
    ) {
      problems.push(label + ': конечное накопленное время меньше начального');
    }
    if (!Array.isArray(runRecord.segments)) {
      problems.push(label + '.segments: ожидается массив записей сегментов расписания');
    } else if (runRecord.segments.length === 0) {
      // Успешный запуск обязан содержать хотя бы один сегмент:
      // пустая запись не изображает выполненную работу.
      problems.push(label + '.segments: у записи успешного запуска не может быть пустого массива сегментов');
    } else {
      let expectedStart = 0;
      runRecord.segments.forEach((segment, segmentIndex) => {
        const segLabel = label + '.segments[' + segmentIndex + ']';
        if (typeof segment !== 'object' || segment === null || Array.isArray(segment)) {
          problems.push(segLabel + ': запись сегмента должна быть объектом');
          return;
        }
        const seg = segment as Record<string, unknown>;
        if (seg.index !== segmentIndex) {
          problems.push(segLabel + '.index: ожидался ' + segmentIndex + ' (позиция сегмента в расписании запуска)');
        }
        if (typeof seg.temperatureK !== 'number' || !Number.isFinite(seg.temperatureK) || seg.temperatureK <= 0) {
          problems.push(segLabel + '.temperatureK: ожидается конечная строго положительная температура, K');
        }
        if (typeof seg.dtSeconds !== 'number' || !Number.isFinite(seg.dtSeconds) || seg.dtSeconds <= 0) {
          problems.push(segLabel + '.dtSeconds: ожидается конечная строго положительная длительность, с');
        }
        if (
          !Array.isArray(seg.reactionIds) ||
          seg.reactionIds.length === 0 ||
          seg.reactionIds.some((id) => typeof id !== 'string' || !(MECHANISM_REACTION_IDS as readonly string[]).includes(id))
        ) {
          problems.push(segLabel + '.reactionIds: ожидается непустой список реакций №89/№106 без дублей');
        }
        if (Array.isArray(seg.reactionIds)) {
          const uniqueIds = new Set(seg.reactionIds.filter((id) => typeof id === 'string'));
          if (uniqueIds.size !== seg.reactionIds.length) {
            problems.push(segLabel + '.reactionIds: дубликаты реакций в расписании сегмента запрещены');
          }
        }
        if (typeof seg.startTimeSeconds !== 'number' || !Number.isFinite(seg.startTimeSeconds)) {
          problems.push(segLabel + '.startTimeSeconds: ожидается конечное время начала сегмента, с');
        } else if (seg.startTimeSeconds !== expectedStart) {
          problems.push(segLabel + '.startTimeSeconds: ожидалось ' + expectedStart + ' (цепочка сегментов запуска нарушена)');
        }
        // Точный временной контракт сегмента: конец обязан в точности
        // совпадать с результатом той же операции накопления, которая
        // используется при построении расписания траектории:
        // expectedEnd = expectedStart + dtSeconds (без допусков).
        if (typeof seg.dtSeconds === 'number' && Number.isFinite(seg.dtSeconds)) {
          const expectedEnd = expectedStart + seg.dtSeconds;
          if (!Number.isFinite(expectedEnd)) {
            problems.push(segLabel + ': накопление времени сегмента переполняет Number (начало ' + expectedStart + ' с + длительность ' + seg.dtSeconds + ' с)');
          } else if (typeof seg.endTimeSeconds !== 'number' || !Number.isFinite(seg.endTimeSeconds)) {
            problems.push(segLabel + '.endTimeSeconds: ожидается конечное время конца сегмента, с');
          } else if (seg.endTimeSeconds !== expectedEnd) {
            problems.push(segLabel + '.endTimeSeconds: конец сегмента обязан в точности равняться началу плюс длительности: ожидалось ' + expectedEnd + ', получено: ' + seg.endTimeSeconds);
          }
        } else if (typeof seg.endTimeSeconds !== 'number' || !Number.isFinite(seg.endTimeSeconds)) {
          problems.push(segLabel + '.endTimeSeconds: ожидается конечное время конца сегмента, с');
        }
        if (typeof seg.endTimeSeconds === 'number' && Number.isFinite(seg.endTimeSeconds)) {
          expectedStart = seg.endTimeSeconds;
        }
        // Срез трассируемости: у сегмента состояния схемы 1.1.0
        // снимок аудита обязателен и проверяется целиком. Состояниям
        // иных версий требование не навязывается: их версия уже
        // отмечена отдельной проблемой, автоисправлений нет.
        if (record.schemaVersion === KINETIC_EXPERIMENT_SCHEMA_VERSION) {
          problems.push(...segmentAuditProblems(seg.audit, segLabel, seg.reactionIds, seg.temperatureK));
        }
      });
      // Перекрёстная сверка: накопленное время запуска обязано
      // совпадать с концом его последнего сегмента (сегменты
      // нумеруются от старта запуска).
      if (runRecord.segments.length > 0) {
        const last = runRecord.segments[runRecord.segments.length - 1];
        if (typeof last === 'object' && last !== null && !Array.isArray(last)) {
          const lastEnd = (last as Record<string, unknown>).endTimeSeconds;
          const runStart = runRecord.startElapsedSeconds;
          const runEnd = runRecord.endElapsedSeconds;
          if (
            typeof lastEnd === 'number' && Number.isFinite(lastEnd) &&
            typeof runStart === 'number' && Number.isFinite(runStart) &&
            typeof runEnd === 'number' && Number.isFinite(runEnd)
          ) {
            const expectedRunEnd = runStart + lastEnd;
            if (!Number.isFinite(expectedRunEnd)) {
              problems.push(
                label + ': конечное накопленное время запуска переполняет Number (начало ' + runStart + ' с + конец последнего сегмента ' + lastEnd + ' с)'
              );
            } else if (runEnd !== expectedRunEnd) {
              problems.push(
                label + ': конечное накопленное время запуска не совпадает с концом его последнего сегмента (цепочка времени нарушена)'
              );
            }
          }
        }
      }
    }
    for (const field of ['warnings', 'assumptions'] as const) {
      const value = runRecord[field];
      if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
        problems.push(label + '.' + field + ': ожидается массив строк');
      }
    }
  });
  // Цепочка накопленного времени: запуск N начинается с конечного
  // времени запуска N−1; elapsedSeconds совпадает с концом последнего.
  if (record.history.length > 0) {
    let expectedElapsed = 0;
    record.history.forEach((run, index) => {
      if (typeof run !== 'object' || run === null || Array.isArray(run)) {
        return;
      }
      const runRecord = run as Record<string, unknown>;
      if (typeof runRecord.startElapsedSeconds === 'number' && runRecord.startElapsedSeconds !== expectedElapsed) {
        problems.push('history[' + index + '].startElapsedSeconds: ожидалось ' + expectedElapsed + ' (цепочка запусков нарушена)');
      }
      if (typeof runRecord.endElapsedSeconds === 'number' && Number.isFinite(runRecord.endElapsedSeconds)) {
        expectedElapsed = runRecord.endElapsedSeconds;
      }
    });
    if (typeof record.elapsedSeconds === 'number' && Number.isFinite(record.elapsedSeconds) && expectedElapsed !== record.elapsedSeconds) {
      problems.push('elapsedSeconds (' + record.elapsedSeconds + ') не совпадает с конечным накопленным временем последнего запуска (' + expectedElapsed + ')');
    }
  }
  // Цепочка инвентарей: начальный инвентарь запуска N равен конечному
  // инвентарю запуска N−1 по всем семи видам (точное равенство, без
  // допусков); текущий инвентарь равен конечному инвентарю последнего
  // завершённого запуска. Никаких автоисправлений: расхождения
  // возвращаются диагностикой. Состоянию с пустой историей текущий
  // инвентарь остаётся явно заданным первоначальным инвентарём.
  const history = record.history;
  const asInventory = (value: unknown): Record<string, unknown> | null => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return null;
    }
    return value as Record<string, unknown>;
  };
  history.forEach((run, index) => {
    if (index === 0 || typeof run !== 'object' || run === null || Array.isArray(run)) {
      return;
    }
    const previous = history[index - 1];
    if (typeof previous !== 'object' || previous === null || Array.isArray(previous)) {
      return;
    }
    const startInv = asInventory((run as Record<string, unknown>).startInventoriesMolM2);
    const previousEndInv = asInventory((previous as Record<string, unknown>).endInventoriesMolM2);
    if (startInv === null || previousEndInv === null) {
      return; // форма инвентарей уже диагностирована выше
    }
    for (const species of KINETIC_EXPERIMENT_SPECIES) {
      if (startInv[species] !== previousEndInv[species]) {
        problems.push(
          'history[' + index + '].startInventoriesMolM2.' + species +
          ': начальный запас не совпадает с конечным запасом предыдущего запуска (ожидалось: ' + previousEndInv[species] + ', получено: ' + startInv[species] + ')'
        );
      }
    }
  });
  if (history.length > 0) {
    const lastRun = history[history.length - 1];
    if (typeof lastRun === 'object' && lastRun !== null && !Array.isArray(lastRun)) {
      const lastEndInv = asInventory((lastRun as Record<string, unknown>).endInventoriesMolM2);
      const currentInv = asInventory(record.currentInventoriesMolM2);
      if (lastEndInv !== null && currentInv !== null) {
        for (const species of KINETIC_EXPERIMENT_SPECIES) {
          if (currentInv[species] !== lastEndInv[species]) {
            problems.push(
              'currentInventoriesMolM2.' + species +
              ': текущий запас не совпадает с конечным запасом последнего завершённого запуска (ожидалось: ' + lastEndInv[species] + ', получено: ' + currentInv[species] + ')'
            );
          }
        }
      }
    }
  }
  return problems;
}

// ============================================
// 2. ПЕРВИЧНАЯ НАСТРОЙКА
// ============================================

/**
 * Разбор явной первичной настройки. Возвращает готовый инвентарь
 * (все семь видов) и/или список проблем: пустое поле — отсутствие
 * значения, а не ноль; реакционные нули допустимы; N₂ — конечный
 * строго положительный; неизвестные ключи запрещены.
 */
function parseSetup(setup: KineticExperimentSetupInput): { inventories: KineticExperimentInventoryMolM2 | null; problems: string[] } {
  const problems: string[] = [];
  if (typeof setup !== 'object' || setup === null || Array.isArray(setup)) {
    return { inventories: null, problems: ['настройка должна быть объектом KineticExperimentSetupInput'] };
  }
  if (typeof setup.layerThicknessM !== 'number' || !Number.isFinite(setup.layerThicknessM) || setup.layerThicknessM <= 0) {
    problems.push('layerThicknessM: ожидается конечная строго положительная толщина слоя, м (она не выводится из параметров мира)');
  }
  const raw = setup.initialInventoriesMolM2;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    problems.push('initialInventoriesMolM2: ожидается объект с явными запасами всех семи видов, моль/м²');
    return { inventories: null, problems };
  }
  const record = raw as Record<string, unknown>;
  const inventories: KineticExperimentInventoryMolM2 = { O: 0, NO: 0, NO2: 0, H: 0, O2: 0, HO2: 0, N2: 0 };
  for (const species of KINETIC_EXPERIMENT_SPECIES) {
    const value = record[species];
    if (value === undefined || value === null || value === '') {
      problems.push('initialInventoriesMolM2.' + species + ': начальный запас не задан (пустое поле — отсутствие значения, а не ноль; запасы не извлекаются из атмосферного состава)');
      continue;
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      problems.push('initialInventoriesMolM2.' + species + ': ожидается конечное число, моль/м²');
      continue;
    }
    if (value < 0) {
      problems.push('initialInventoriesMolM2.' + species + ': отрицательный запас запрещён');
      continue;
    }
    if (species === 'N2' && value <= 0) {
      problems.push('initialInventoriesMolM2.N2: запас N₂ обязан быть конечным и строго положительным (третье тело механизма; не выводится из доли азота или давления)');
      continue;
    }
    inventories[species] = value;
  }
  const unknownKeys = Object.keys(record).filter(
    (key) => !(KINETIC_EXPERIMENT_SPECIES as readonly string[]).includes(key)
  );
  if (unknownKeys.length > 0) {
    problems.push('initialInventoriesMolM2: неизвестные ключи ' + unknownKeys.join(', ') + ' (механизм ограничен видами O, NO, NO2, H, O2, HO2, N2)');
  }
  return { inventories: problems.length === 0 ? inventories : null, problems };
}

// ============================================
// 2b. СНИМОК КИНЕТИЧЕСКОЙ ТРАССИРУЕМОСТИ СЕГМЕНТА
// ============================================

/**
 * Поверхностная копия provenance для снимка аудита: снимок обязан
 * быть сериализуемым и не разделять изменяемые вложенные объекты
 * с каталогом или результатом вычислителя. Значения копируются
 * как есть: пересчёт и подмена запрещены.
 */
function cloneSnapshotProvenance(provenance: DataProvenance): DataProvenance {
  const clone: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(provenance)) {
    clone[key] =
      value && typeof value === 'object' && !Array.isArray(value)
        ? { ...(value as Record<string, unknown>) }
        : value;
  }
  return clone as DataProvenance;
}

/**
 * Снимок кинетической трассируемости одного сегмента. Источник —
 * ИСКЛЮЧИТЕЛЬНО фактически полученный результат сегмента
 * (segment.compartment.concentrationStep): фактические
 * AppliedReactionSummary в порядке расписания, фактическая
 * концентрация третьего тела N₂, модель концентраций и диагностика
 * интегратора того же результата. evaluateRateConstant повторно НЕ
 * вызывается, значения из каталога НЕ подставляются.
 */
function buildSegmentAuditRecord(segment: KineticCompartmentTrajectorySegmentResult): KineticExperimentSegmentAudit {
  const step = segment.compartment.concentrationStep;
  return {
    kind: 'recorded',
    concentrationModel: step.concentrationModel,
    thirdBodyN2MoleculeCm3: step.thirdBodyN2MoleculeCm3,
    reactions: step.reactions.map((applied) => ({
      reactionId: applied.reactionId,
      label: applied.label,
      dataStatus: applied.dataStatus,
      rateConstant: { value: applied.rateConstant.value, unit: applied.rateConstant.unit },
      appliedRangeK: { min: applied.appliedRangeK.min, max: applied.appliedRangeK.max },
      provenance: cloneSnapshotProvenance(applied.provenance),
      parameterProvenance: {
        lowPressureLimit: cloneSnapshotProvenance(applied.parameterProvenance.lowPressureLimit),
        highPressureLimit: cloneSnapshotProvenance(applied.parameterProvenance.highPressureLimit),
        broadening: cloneSnapshotProvenance(applied.parameterProvenance.broadening)
      },
      fallOff: {
        lowPressureLimit: applied.fallOff.lowPressureLimit,
        highPressureLimit: applied.fallOff.highPressureLimit,
        reducedPressure: applied.fallOff.reducedPressure,
        log10ReducedPressure: applied.fallOff.log10ReducedPressure,
        broadeningFactor: applied.fallOff.broadeningFactor
      }
    })),
    integration: {
      method: step.integration.method,
      minorNegativeCount: step.integration.minorNegativeCount,
      invariantChecks: step.integration.invariantChecks
    }
  };
}

// ============================================
// 2.1. МОДЕЛЬ ПРЕДСТАВЛЕНИЯ ПОЛНОЙ ИСТОРИИ ЗАПУСКОВ (UI)
// ============================================

/** Вид снимка аудита сегмента для представления: recorded, unavailable_legacy или явное отсутствие. */
export type KineticSegmentAuditViewKind = 'recorded' | 'unavailable_legacy' | 'absent';

/** Элемент модели представления одного запуска истории эксперимента. */
export interface KineticRunHistoryEntry {
  /** Индекс запуска (позиция в history; валидатор требует runIndex === позиции). */
  readonly runIndex: number;
  /** Раскрыт ли запуск по умолчанию: последний — да, предыдущие — нет. */
  readonly defaultExpanded: boolean;
  /** Число сегментов запуска (расписание доступно целиком при раскрытии). */
  readonly segmentCount: number;
  /** Виды снимков аудита сегментов запуска в порядке сегментов. */
  readonly segmentAuditKinds: readonly KineticSegmentAuditViewKind[];
}

/**
 * Модель представления ПОЛНОЙ истории запусков эксперимента для
 * интерфейса паспорта мира (корректирующий пакет трассируемости):
 * ВСЕ запуски в хронологическом порядке, последний раскрыт по
 * умолчанию, предыдущие свёрнуты. Никаких пересчётов и
 * реконструкций: модель отражает уже сохранённые записи как есть.
 * Тестируется явно — защита от регрессии «отображается только
 * последний запуск».
 */
export function kineticRunHistoryViewModel(
  history: readonly KineticExperimentRunRecord[]
): readonly KineticRunHistoryEntry[] {
  const lastPosition = history.length - 1;
  return history.map((run, position) => ({
    runIndex: run.runIndex,
    defaultExpanded: position === lastPosition,
    segmentCount: run.segments.length,
    segmentAuditKinds: run.segments.map((segment) => (segment.audit !== undefined ? segment.audit.kind : 'absent'))
  }));
}

// ============================================
// 3. ЗАПУСК ТРАЕКТОРИИ НА МИРЕ
// ============================================

/**
 * Запуск кинетической траектории эксперимента на мире.
 *
 * Первый запуск (world.kineticExperiment отсутствует) требует
 * явную настройку: layerThicknessM и все семь начальных запасов в
 * моль/м². Последующие запуски используют сохранённые
 * currentInventoriesMolM2 и постоянную толщину слоя; новые
 * начальные запасы НЕ принимаются (нужен явный сброс).
 *
 * Возвращает НОВЫЙ мир с обновлённым kineticExperiment; исходный
 * мир не мутируется. Обновление состояния происходит только после
 * полного успешного завершения траектории: при любой ошибке
 * выбрасывается KineticMechanismError, запись истории не
 * добавляется, частично обновлённый эксперимент не возвращается.
 * Накопленное время суммируется в физических секундах, конечность
 * нового накопленного времени проверяется ДО выполнения
 * траектории. История не обрезается.
 */
export function runWorldKineticTrajectory(
  world: GeneratedWorld,
  input: WorldKineticTrajectoryInput
): GeneratedWorld {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new KineticMechanismError(
      'invalid_input',
      'вход должен быть объектом WorldKineticTrajectoryInput (segments +, при первом запуске, setup)'
    );
  }
  if (!Array.isArray(input.segments)) {
    throw new KineticMechanismError('invalid_input', 'segments: ожидается непустой массив сегментов расписания');
  }
  if (input.segments.length === 0) {
    throw new KineticMechanismError('invalid_input', 'segments: расписание не может быть пустым (добавьте хотя бы один сегмент)');
  }

  // --- Состояние эксперимента: продолжение или явная настройка ---
  const existing = world.kineticExperiment;
  let state: KineticExperimentState;
  if (existing !== undefined) {
    const stateProblems = kineticExperimentStateProblems(existing);
    if (stateProblems.length > 0) {
      throw new KineticMechanismError(
        'invalid_input',
        'состояние кинетического эксперимента мира некорректно (проверьте сохранение): ' + stateProblems.join('; ')
      );
    }
    if (input.setup !== undefined) {
      throw new KineticMechanismError(
        'invalid_input',
        'эксперимент уже настроен: новые начальные запасы и толщина слоя не принимаются; для смены начальных условий выполните явный сброс (resetWorldKineticExperiment) и настройте эксперимент заново'
      );
    }
    state = existing;
  } else {
    if (input.setup === undefined) {
      throw new KineticMechanismError(
        'invalid_input',
        'первый запуск требует явной настройки: layerThicknessM и все семь начальных запасов (O, NO, NO2, H, O2, HO2, N2) в моль/м²; запасы не извлекаются из атмосферного состава'
      );
    }
    const parsed = parseSetup(input.setup);
    if (parsed.inventories === null) {
      throw new KineticMechanismError(
        'invalid_input',
        'настройка кинетического эксперимента некорректна: ' + parsed.problems.join('; ')
      );
    }
    state = {
      schemaVersion: KINETIC_EXPERIMENT_SCHEMA_VERSION,
      layerThicknessM: input.setup.layerThicknessM,
      currentInventoriesMolM2: parsed.inventories,
      elapsedSeconds: 0,
      completedRuns: 0,
      history: []
    };
  }

  // --- Заблаговременная проверка конечности накопленного времени ---
  // Сумма dtSeconds расписания + уже накопленное время обязаны
  // оставаться конечными: переполнение отвергает ВЕСЬ запуск ещё
  // до выполнения траектории.
  let scheduledTotal = 0;
  for (let index = 0; index < input.segments.length; index++) {
    const segment = input.segments[index];
    const dt = typeof segment === 'object' && segment !== null ? segment.dtSeconds : undefined;
    if (typeof dt !== 'number' || !Number.isFinite(dt) || dt <= 0) {
      throw new KineticMechanismError(
        'invalid_input',
        'сегмент ' + index + ': dtSeconds должен быть конечным строго положительным числом (физические секунды)',
        { segmentIndex: index }
      );
    }
    const next = scheduledTotal + dt;
    if (!Number.isFinite(next)) {
      throw new KineticMechanismError(
        'invalid_input',
        'сегмент ' + index + ': сумма dtSeconds расписания переполняет Number; запуск отклонён целиком (ни один сегмент не выполнен)',
        { segmentIndex: index, elapsedSecondsBeforeSegment: scheduledTotal }
      );
    }
    scheduledTotal = next;
  }
  const newElapsed = state.elapsedSeconds + scheduledTotal;
  if (!Number.isFinite(newElapsed)) {
    throw new KineticMechanismError(
      'invalid_input',
      'накопленное физическое время эксперимента переполняет Number: запуск полностью отклонён (мир, инвентарь и история не изменены)',
      { elapsedSecondsBeforeRun: state.elapsedSeconds, scheduledTotalSeconds: scheduledTotal }
    );
  }

  // --- Выполнение траектории существующим механизмом ---
  const startInventories: KineticExperimentInventoryMolM2 = { ...state.currentInventoriesMolM2 };
  let result;
  try {
    result = runKineticCompartmentTrajectory({
      layerThicknessM: state.layerThicknessM,
      initialInventoriesMolM2: startInventories,
      segments: input.segments
    });
  } catch (error) {
    // Контролируемый отказ: существующая KineticMechanismError
    // пробрасывается как есть (с кодом и деталями механизма),
    // состояние мира не изменяется.
    if (error instanceof KineticMechanismError) {
      throw error;
    }
    throw new KineticMechanismError(
      'integration_failure',
      'кинетическая траектория не выполнена: ' + (error instanceof Error ? error.message : String(error))
    );
  }

  const finalElapsed = state.elapsedSeconds + result.totalTimeSeconds;
  if (!Number.isFinite(finalElapsed)) {
    // После предпроверки недостижимо, но контракт конечности
    // накопленного времени защищается явно: запуск отклонён целиком.
    throw new KineticMechanismError(
      'invalid_input',
      'накопленное физическое время эксперимента переполняет Number: запуск полностью отклонён (мир, инвентарь и история не изменены)'
    );
  }

  // --- Фиксация успешного результата ---
  const endInventories: KineticExperimentInventoryMolM2 = {
    O: result.finalInventoriesMolM2['O'],
    NO: result.finalInventoriesMolM2['NO'],
    NO2: result.finalInventoriesMolM2['NO2'],
    H: result.finalInventoriesMolM2['H'],
    O2: result.finalInventoriesMolM2['O2'],
    HO2: result.finalInventoriesMolM2['HO2'],
    N2: result.finalInventoriesMolM2['N2']
  };
  const runRecord: KineticExperimentRunRecord = {
    runIndex: state.completedRuns,
    startInventoriesMolM2: startInventories,
    endInventoriesMolM2: endInventories,
    startElapsedSeconds: state.elapsedSeconds,
    endElapsedSeconds: finalElapsed,
    segments: result.segments.map((segment) => ({
      index: segment.index,
      temperatureK: segment.temperatureK,
      dtSeconds: segment.dtSeconds,
      reactionIds: [...segment.reactionIds],
      startTimeSeconds: segment.startTimeSeconds,
      endTimeSeconds: segment.endTimeSeconds,
      audit: buildSegmentAuditRecord(segment)
    })),
    warnings: [...result.warnings],
    assumptions: [...result.assumptions]
  };
  const nextState: KineticExperimentState = {
    schemaVersion: state.schemaVersion,
    layerThicknessM: state.layerThicknessM,
    currentInventoriesMolM2: endInventories,
    elapsedSeconds: finalElapsed,
    completedRuns: state.completedRuns + 1,
    history: [...state.history, runRecord]
  };
  return { ...world, kineticExperiment: nextState };
}

// ============================================
// 4. ЯВНЫЙ СБРОС ЭКСПЕРИМЕНТА
// ============================================

/**
 * Явный сброс кинетического эксперимента: возвращает НОВЫЙ мир
 * без поля kineticExperiment («эксперимент не настроен»). Сброс —
 * отдельная операция пользователя: он НЕ происходит автоматически
 * при смене расписания, повторном запуске или ошибке. Исходный
 * мир не мутируется; сброс не настроенного эксперимента
 * идемпотентен.
 */
export function resetWorldKineticExperiment(world: GeneratedWorld): GeneratedWorld {
  const { kineticExperiment, ...rest } = world;
  void kineticExperiment;
  return rest;
}
