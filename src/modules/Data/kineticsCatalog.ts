/**
 * Stage 4.5.4 (ревизия 4.5.4.2) — типизированный каталог кинетических записей JPL/KIDA
 * для вычислителя k(T) (Core/kinetics, 4.5.1/4.5.2) и будущего интегрирования ODE (4.5.5).
 *
 * Ревизия 4.5.4.2 (2026-11-03, завершение корректирующей ревизии после независимого
 * аудита лицензионной очистки):
 * - Тест лицензионной безопасности больше НЕ воспроизводит дословные числовые
 *   фрагменты экспорта KIDA — проверяются структура и разрешённые поля данных.
 * - Per-record числовые параметры (коэффициенты k0/k∞, Fc-параметры записей,
 *   T-диапазоны, сентинелы формата, неопределённости) удалены также из
 *   документации и блокирующих вопросов; общие математические формулы KIDA
 *   сохранены с точными ссылками на официальную справку
 *   (kida.astrochem-tools.org/help) — они отделены от числовых данных
 *   конкретных реакций.
 * - Метаданные курирования networkMultiplicity/recommendation ВРЕМЕННО ИСКЛЮЧЕНЫ
 *   из публичного каталога: право на воспроизведение содержимого экспорта не
 *   подтверждено (KIDA Legal Notices; копия PATMO@d78ec8e2 без LICENSE); решение
 *   задокументировано и НЕ объявляет поля автоматически «лицензионно очищенными».
 *   Оставлены только номера реакций KIDA (идентификаторы записей источника,
 *   необходимые для будущей per-record сверки) и состав видов (физический факт,
 *   независимо проверяемый по литературе JPL/IUPAC).
 * - Статус JPL Evaluation No. 20 уточнён: публикация существует и публично
 *   предлагается (страница проекта публикует ссылку на PDF ~20 МБ,
 *   DOI 10.48577/jpl.KFQ0TZ); использованный автоматизированный способ
 *   извлечения не смог обработать PDF установленного размера — per-record
 *   импорт НЕ выполнен; записи JPL не импортированы.
 * - Единицы k0/k∞ НЕ интерпретированы: справка KIDA противоречива
 *   (обе константы «cm6.molecules-2.s-1» при безразмерном Pr = k0·[M]/k∞) — блокер.
 * - Все константы status='unknown' — вычислитель 4.5.2 обязан отказывать
 *   (no_kinetic_data). Fail-closed поведение НЕ ослаблено; контракты 4.5.1–4.5.3
 *   (включая решатель Radau IIA 4.5.3) не менялись.
 * Блокирующие вопросы: KINETIC_CATALOG_BLOCKING_QUESTIONS (4 шт.).
 */
import type { KineticReactionRecord } from '../Core/kinetics';
import { validateKineticReactionRecord } from '../Core/kinetics';

export interface KineticsDataSourceDescriptor {
  readonly sourceName: string;
  readonly sourceId: string;
  readonly url: string;
  readonly citation: string;
  readonly license: string;
  readonly retrievedAt: string;
  readonly note?: string;
}

export const KIDA_DATABASE_SOURCE: KineticsDataSourceDescriptor = {
  sourceName: 'KIDA — Kinetic Database for Astrochemistry',
  sourceId: 'kida.astrochem-tools.org',
  url: 'https://kida.astrochem-tools.org/',
  citation: 'Wakelam, V. et al. 2012, ApJS 199, 21 (KIDA)',
  license:
    'unverified: KIDA Legal Notices — элементы сайта защищены законом об интеллектуальной собственности, несанкционированное воспроизведение и распространение запрещены; лицензия на скачиваемые наборы данных не публикуется',
  retrievedAt: '2026-11-03',
  note: 'справка по трёхтелесным реакциям (kida.astrochem-tools.org/help): общие формулы k(T), F и Fc(T) опубликованы изображениями; текстом подтверждены c = −0.4 − 0.67·log10(Fc), N = 0.75 − 1.27·log10(Fc), d = 0.14, Pr = k0·[M]/k∞ и политика Fc = 0.64 (Sander et al. 2006) при отсутствии параметров Troe — общая математика официальной справки, отделённая от числовых данных конкретных реакций; раздел units заявляет для termolecular cm6 s-1 и одновременно одинаковые единицы k0 и k∞ — противоречие зафиксировано в KINETIC_CATALOG_BLOCKING_QUESTIONS'
};

export const KIDA_TB_EXPORT_SOURCE: KineticsDataSourceDescriptor = {
  sourceName: 'KIDA three-body network export (kida_reac_tb_2015-03-19_1.csv)',
  sourceId: 'kida-tb-2015-03-19',
  url: 'https://raw.githubusercontent.com/SophiaAtmo/PATMO/d78ec8e2bcabc2c4071e71f12a9f817873ebd5dd/data/kida/kida_reac_tb_2015-03-19_1.csv',
  citation:
    'Wakelam, V. et al. 2012, ApJS 199, 21 (KIDA); формат колонок — kida_readme_tb_2015-03-19_1.txt',
  license:
    'unverified: KIDA Legal Notices запрещают несанкционированное воспроизведение и распространение элементов сайта; лицензия на скачиваемые наборы данных не публикуется; копия SophiaAtmo/PATMO@d78ec8e2bcabc2c4071e71f12a9f817873ebd5dd не содержит файла LICENSE — дословные строки экспорта НЕ воспроизводятся в этом репозитории',
  retrievedAt: '2026-11-03',
  note: '30 058 байт, сеть 94 вида / 112 реакций (по шапке readme), 36 колонок; копия PATMO содержит помеченные правки «#MODIFIED»: у двух реакций оставлена одна строка с максимальным диапазоном температуры (значения не воспроизводятся), одна реакция исключена из сети комментарием как неоднозначная; экспорт не содержит per-record ссылок на первоисточники; идентичности каталога получены из этой копии, числовые параметры и метаданные курирования удалены в ревизиях 4.5.4.1/4.5.4.2'
};

export const JPL_EVALUATION_SOURCE: KineticsDataSourceDescriptor = {
  sourceName:
    'NASA JPL Chemical Kinetics and Photochemical Data for Use in Atmospheric Studies, Evaluation No. 20',
  sourceId: 'jpl-evaluation-20',
  url: 'https://science.jpl.nasa.gov/projects/data-evaluation/',
  citation:
    'Burkholder, J. B., Caravan, R. L., Huie, R. E., Orkin, V. L., Percival, C. J., Sander, S. P., Sander, R., Wilmouth, D. M. "Chemical Kinetics and Photochemical Data for Use in Atmospheric Studies, Evaluation No. 20," JPL Publication 25-1, Pasadena, 2025, DOI 10.48577/jpl.KFQ0TZ',
  license: 'government work; условия использования проверить',
  retrievedAt: '2026-11-03',
  note: 'публикация существует и публично предлагается: официальная страница проекта (science.jpl.nasa.gov/projects/data-evaluation/) публикует ссылку на JPL Publication 25-1 (PDF ~20 МБ, DOI 10.48577/jpl.KFQ0TZ); использованный автоматизированный способ извлечения НЕ смог обработать PDF установленного размера — per-record данные НЕ импортированы в 4.5.4/4.5.4.1/4.5.4.2, неподтверждённые коэффициенты не добавляются, статус записей не меняется на known/estimated; per-record импорт требует проверяемого доступа (ручное извлечение таблиц или разрешённый API)'
};

export interface KidaTbRecordIdentity {
  readonly kidaReactionNumber: number;
  readonly reactants: readonly string[];
  readonly products: readonly string[];
}

export const KIDA_TB_RECORD_IDENTITIES: readonly KidaTbRecordIdentity[] = [
  { kidaReactionNumber: 1, reactants: ['H', 'H', 'N2'], products: ['H2', 'N2'] },
  { kidaReactionNumber: 70, reactants: ['O', 'H', 'N2'], products: ['OH', 'N2'] },
  { kidaReactionNumber: 72, reactants: ['OH', 'H', 'N2'], products: ['H2O', 'N2'] },
  { kidaReactionNumber: 89, reactants: ['O', 'NO', 'N2'], products: ['NO2', 'N2'] },
  { kidaReactionNumber: 106, reactants: ['H', 'O2', 'N2'], products: ['O2H', 'N2'] }
];

const KIDA_TB_RECORD_ID_PREFIX = 'kida-tb-2015-03-19-';

export function kidaTbRecordId(kidaReactionNumber: number): string {
  return `${KIDA_TB_RECORD_ID_PREFIX}${kidaReactionNumber}`;
}

function kidaTbReactionString(identity: KidaTbRecordIdentity): string {
  return `${identity.reactants.join(' + ')} → ${identity.products.join(' + ')}`;
}

function kidaTbRateConstantProvenance(identity: KidaTbRecordIdentity) {
  return {
    sourceName: KIDA_TB_EXPORT_SOURCE.sourceName,
    sourceId: KIDA_TB_EXPORT_SOURCE.sourceId,
    datasetId: 'kida_reac_tb_2015-03-19_1.csv',
    datasetVersion:
      'экспорт 2015-03-19; копия SophiaAtmo/PATMO@d78ec8e2bcabc2c4071e71f12a9f817873ebd5dd, директория data/kida/',
    recordId: `kida-tb-2015-03-19:reaction=${identity.kidaReactionNumber}`,
    reference: KIDA_TB_EXPORT_SOURCE.citation,
    retrievedAt: KIDA_TB_EXPORT_SOURCE.retrievedAt,
    limitations:
      'дословные числовые параметры, Fc-параметры, исходные строки CSV и метаданные курирования (networkMultiplicity, recommendation) НЕ воспроизводятся в репозитории (лицензия unverified: KIDA Legal Notices; копия PATMO@d78ec8e2 без LICENSE); параметры не промоутированы в known — блокирующие причины в KINETIC_CATALOG_BLOCKING_QUESTIONS',
    license: KIDA_TB_EXPORT_SOURCE.license,
    rawInput: {
      kidaReactionNumber: identity.kidaReactionNumber,
      reactant1: identity.reactants[0] ?? '',
      reactant2: identity.reactants[1] ?? '',
      reactant3: identity.reactants[2] ?? '',
      product1: identity.products[0] ?? '',
      product2: identity.products[1] ?? ''
    }
  };
}

export function buildKidaTbReactionRecord(identity: KidaTbRecordIdentity): KineticReactionRecord {
  return {
    id: kidaTbRecordId(identity.kidaReactionNumber),
    kind: 'elementary',
    overallOrder: null,
    concentrationModel: 'molecule_cm3',
    rateConstant: {
      status: 'unknown',
      note:
        'k(T) не рассчитано: (1) полная форма уширения KIDA (смещение центра c(Fc), член d = 0.14, T-зависимый Fc(T)) НЕ представима точно в контракте 4.5.2 и требует расширения (не реализовано); (2) размерности k0/k∞ противоречивы в справке KIDA (обе cm6.molecule-2.s-1 при Pr = k0·[M]/k∞) — единицы НЕ интерпретированы; (3) JPL Evaluation No. 20 не импортирован (автоматизированный способ извлечения не смог обработать публично предлагаемый PDF ~20 МБ); (4) лицензия KIDA unverified — дословные числовые параметры и метаданные курирования удалены из репозитория; вычислитель обязан отказывать (no_kinetic_data)',
      provenance: kidaTbRateConstantProvenance(identity)
    },
    provenance: {
      sourceName: KIDA_TB_EXPORT_SOURCE.sourceName,
      sourceId: KIDA_TB_EXPORT_SOURCE.sourceId,
      datasetId: 'kida_reac_tb_2015-03-19_1.csv',
      datasetVersion:
        'экспорт 2015-03-19; копия SophiaAtmo/PATMO@d78ec8e2bcabc2c4071e71f12a9f817873ebd5dd, директория data/kida/',
      recordId: `kida-tb-2015-03-19:reaction=${identity.kidaReactionNumber}`,
      reference: KIDA_TB_EXPORT_SOURCE.citation,
      retrievedAt: KIDA_TB_EXPORT_SOURCE.retrievedAt,
      license: KIDA_TB_EXPORT_SOURCE.license,
      note: `реакционная идентичность записи KIDA №${identity.kidaReactionNumber} (состав видов; метаданные курирования networkMultiplicity/recommendation временно исключены в ревизии 4.5.4.2 и НЕ воспроизводятся); числовые параметры строки НЕ воспроизводятся`
    },
    reaction: kidaTbReactionString(identity),
    note:
      'имена видов — номенклатура KIDA (O2H — HO2 в нотации KIDA); поле reaction человекочитаемо и НЕ является стехиометрией сети (сопряжение со стехиометрией видов — этап 4.5.5)'
  };
}

export const KINETIC_CATALOG_DATA: readonly KineticReactionRecord[] =
  KIDA_TB_RECORD_IDENTITIES.map((identity) => buildKidaTbReactionRecord(identity));

export class KineticsCatalogError extends Error {
  constructor(message: string) {
    super(`[kineticsCatalog] ${message}`);
    this.name = 'KineticsCatalogError';
  }
}

export interface KineticsCatalog {
  listIds(): readonly string[];
  get(id: string): KineticReactionRecord | null;
  has(id: string): boolean;
  size(): number;
}

export function buildKineticsCatalog(
  records: readonly KineticReactionRecord[] = KINETIC_CATALOG_DATA
): KineticsCatalog {
  const byId = new Map<string, KineticReactionRecord>();
  const order: string[] = [];
  for (const record of records) {
    if (typeof record?.id !== 'string' || record.id.trim() === '') {
      throw new KineticsCatalogError('запись без id не может быть добавлена в каталог');
    }
    const issues = validateKineticReactionRecord(record);
    if (issues.length > 0) {
      throw new KineticsCatalogError(
        `запись «${record.id}» не проходит валидацию контракта 4.5.1: ${issues.join('; ')}`
      );
    }
    if (byId.has(record.id)) {
      throw new KineticsCatalogError(
        `дублирующийся id записи каталога: «${record.id}» (id обязан быть уникальным)`
      );
    }
    byId.set(record.id, record);
    order.push(record.id);
  }
  return {
    listIds: () => [...order],
    get: (id: string) => (byId.has(id) ? (byId.get(id) as KineticReactionRecord) : null),
    has: (id: string) => byId.has(id),
    size: () => order.length
  };
}

export const KINETIC_CATALOG_BLOCKING_QUESTIONS: readonly string[] = [
  'Форма уширения KIDA: справка KIDA (kida.astrochem-tools.org/help) публикует общие формулы k(T), F, Fc(T) изображениями; текстом подтверждены c = −0.4 − 0.67·log10(Fc), N = 0.75 − 1.27·log10(Fc), d = 0.14, Pr = k0·[M]/k∞ и политика Fc = 0.64 (Sander et al. 2006) при отсутствии параметров Troe. Полная форма (сдвиг центра на c(Fc), член d = 0.14, T-зависимый Fc(T) из параметров a/b/c/d) НЕ представима точно в контракте 4.5.2 (симметричная форма с константными centeringFactorFc ∈ (0,1] и broadeningN > 0) — требуется решение о минимальном расширении контракта (модель уширения как discriminated union с обратной совместимостью 4.5.1–4.5.3; предложение в дорожной карте, НЕ реализовано). Per-record Fc-параметры отдельных записей экспорта НЕ воспроизводятся в репозитории (лицензия unverified, ревизия 4.5.4.2); зафиксировано только, что у части записей буквальное чтение их Fc-параметров противоречит политике KIDA «Fc = 0.64», а трактовка сентинелов формата «не задано» неоднозначна — интерпретация должна быть подтверждена командой KIDA. Реализация parseKIDA3b в PATMO@d78ec8e2 отклоняется от канонической Troe-формы литературы (произведение вместо суммы в Fc(T), y без скобок, Pr = k0/k∞ без [M]) и не может служить нормой',
  'Размерности k0/k∞: официальная справка KIDA утверждает одинаковые единицы k0 и k∞ (цитата: «Both rate constants have the following unit: cm6.molecules-2.s-1», т.е. cm6.molecule-2.s-1 для обеих), но Pr = k0·[M]/k∞ безразмерен только при [k0]/[k∞] = единица концентрации (k∞ — cm3.molecule-1.s-1 по конвенции JPL/IUPAC); readme экспорта единицы не специфицирует; копия PATMO@d78ec8e2 вычисляет Pr = k0/k∞ без [M]. Противоречие источника — блокер: единицы исходных параметров оставлены неинтерпретированными, параметры НЕ промоутируются',
  'JPL Evaluation No. 20 (JPL Publication 25-1, 2025, DOI 10.48577/jpl.KFQ0TZ; Burkholder, Caravan, Huie, Orkin, Percival, Sander, Sander, Wilmouth): публикация существует и публично предлагается (страница проекта science.jpl.nasa.gov/projects/data-evaluation/ публикует ссылку на PDF ~20 МБ); использованный автоматизированный способ извлечения НЕ смог обработать PDF установленного размера — per-record импорт не выполнен, записи JPL не импортированы, неподтверждённые коэффициенты не добавляются; требуется проверяемый доступ (ручное извлечение таблиц, per-record ссылки на первоисточники, формы энергии, опорная температура 298→300 K, диапазоны T, температурные неопределённости)',
  'Лицензия KIDA: Legal Notices (kida.astrochem-tools.org/legal) — элементы сайта защищены законом об интеллектуальной собственности, несанкционированное воспроизведение, распространение и использование запрещены; лицензия на скачиваемые наборы данных не публикуется; копия SophiaAtmo/PATMO@d78ec8e2 не содержит файла LICENSE. Право на распространение содержимого экспорта НЕ подтверждено: в ревизиях 4.5.4.1/4.5.4.2 из репозитория удалены все per-record числовые параметры (коэффициенты k0/k∞, Fc-параметры, T-диапазоны, неопределённости), исходные строки CSV и метаданные курирования (networkMultiplicity, recommendation); оставлены только номера реакций KIDA (идентификаторы записей источника), состав видов (физический факт, независимо проверяемый по литературе JPL/IUPAC), библиография и общие метаданные источника — оставшиеся поля НЕ объявляются автоматически лицензионно очищенными и могут быть дополнительно исключены; промоушен параметров требует ответа кураторов KIDA (контакт: kida-obsu-bordeaux.fr) и обязательного цитирования Wakelam et al. 2012, ApJS 199, 21'
];
