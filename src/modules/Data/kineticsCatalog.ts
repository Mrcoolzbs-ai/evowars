/**
 * Stage 4.5.4 (ревизия 4.5.4.3) — типизированный каталог кинетических записей JPL/KIDA
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
 *   необходимые для будущей per-record сверки) и состав видов (физический факт;
 *   идентичности перенесены из KIDA-экспорта и потенциально проверяемы по
 *   независимой литературе — задокументированной независимой проверки в проекте
 *   нет, уточнение 4.5.4.3).
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
 * Ревизия 4.5.4.3 (2026-11-03, provenance- и библиографическая корректировка):
 * - Библиография JPL приведена к официальной записи: порядок авторов —
 *   J.B. Burkholder, R.L. Caravan, R.E. Huie, V.L. Orkin, C.J. Percival,
 *   R. Sander, S.P. Sander, D.M. Wilmouth (Evaluation No. 20 = JPL Publication
 *   25-1, 2025, DOI 10.48577/jpl.KFQ0TZ); реквизиты, не подтверждённые
 *   официальной записью (страницы, номера таблиц), не добавляются.
 * - Формулировки «независимо проверяемый по литературе JPL/IUPAC» уточнены:
 *   идентичности видов перенесены из KIDA-экспорта и потенциально могут быть
 *   проверены по независимой литературе, но такая проверка в проекте НЕ
 *   задокументирована (per-record первичные ссылки отсутствуют).
 * - Наличие опубликованного PDF JPL НЕ означает извлечения, проверки и импорта
 *   per-record параметров: импорт по-прежнему НЕ выполнен, статусы записей
 *   не меняются (все константы unknown, fail-closed не ослаблен).
 * - Контракты 4.5.1–4.5.3 (включая Radau IIA), NASA CEA и golden baseline
 *   не менялись; история Git НЕ переписывалась (риск Git-истории зафиксирован
 *   в DATA_PROVENANCE.md §2.28).
 * Ревизия Stage 4.5.4.4.1 (2026-11-04, KIDA provenance consistency correction):
 * - Библиография базы и цитата конкретного экспорта разделены (по итогам
 *   независимого аудита ревизии 4.5.4.4): KIDA_DATABASE_SOURCE.citation —
 *   Wakelam et al. 2012, ApJS 199, 21 ТОЛЬКО как общее библиографическое
 *   описание базы KIDA; публикация НЕ подтверждена как рекомендуемая цитата
 *   tb-экспорта 2015 года и НЕ заявляется первичным источником его реакций.
 * - KIDA_TB_EXPORT_SOURCE.citation — явный UNRESOLVED: рекомендуемая
 *   библиографическая ссылка для конкретного tb-экспорта не установлена;
 *   требуется подтверждение KIDA (см. DATA_PROVENANCE.md §2.28). Описание
 *   формата файла (readme) перенесено в note и НЕ смешивается с
 *   библиографией научного источника.
 * - Кинетические данные НЕ добавлялись: каталог — те же 5 записей, все
 *   константы status='unknown' (no_kinetic_data), fail-closed НЕ ослаблен;
 *   контракты 4.5.1–4.5.3 (включая Radau IIA), NASA CEA, golden baseline
 *   не менялись; история Git НЕ переписывалась.
 * Ревизия Stage 4.5.4.5 (2026-11-08, per-record аудит доступа JPL Evaluation
 * No. 20): результат аудита доступа к табличным значениям публикации
 * (JPL Publication 25-1, 2025, DOI 10.48577/jpl.KFQ0TZ) зафиксирован в
 * JPL_EVALUATION_20_ACCESS_AUDIT (5 записей, 9 наблюдений доступа): табличные
 * per-record значения НЕ доступны проверяемым автоматизированным способом
 * (официальная страница рендерится клиентским JavaScript; DOI ведёт в JPL
 * Dataverse, блокирующий автоматизированный доступ; NTRS и зеркала выпуск не
 * содержат) — параметры НЕ верифицированы и НЕ импортированы: все 5 записей
 * остаются status='unknown', вычислитель 4.5.2 обязан отказывать
 * (no_kinetic_data); fail-closed НЕ ослаблен; контракты 4.5.1–4.5.3 (включая
 * Radau IIA), NASA CEA и golden baseline не менялись; блокирующий вопрос JPL
 * актуализирован со ссылкой на аудит.
 * Корректировка доказательной базы Stage 4.5.4 (2026-11-08, после ревизии
 * 4.5.4.5; актуализация аудита 4.5.4.5 и наблюдения (а) аудита 4.5.4.1;
 * БЕЗ импорта параметров):
 * - Полная математическая форма уширения KIDA подтверждена официальной
 *   справкой и документирована по трём официальным изображениям
 *   (bundles/labkida/images/formula/3body-1.png, 3body-2bis.png,
 *   3body-3.png; визуальное чтение; автоматизированное чтение изображений
 *   в рабочей среде недоступно): k = k∞·Pr/(1+Pr)·F;
 *   F = Fc^(1/(1+((log10(Pr)+c)/(N−d·(log10(Pr)+c)))²)) с
 *   c = −0.4−0.67·log10(Fc), N = 0.75−1.27·log10(Fc), d = 0.14;
 *   Fc(T) = (1−a)·exp(−T/b)+a·exp(−T/c)+exp(−d/T) (a безразмерно, b/c/d
 *   в K). Коллизия обозначений источника зафиксирована: c — центрирующий
 *   параметр c(Fc) в F и одновременно температурный параметр в Fc(T);
 *   d — фиксированная константа 0.14 в F и одновременно температурный
 *   параметр в exp(−d/T); при расширении контракта поля НЕ смешивать.
 *   Полная форма по-прежнему НЕ представима константными
 *   centeringFactorFc/broadeningN контракта 4.5.2 — расширение контракта
 *   остаётся ПРЕДЛОЖЕНИЕМ (дорожная карта), модель НЕ реализована.
 * - JPL Evaluation No. 20: установлены и проверены (2026-11-08) прямые
 *   PDF-ссылки: science.jpl.nasa.gov/documents/1503/
 *   NASA_Data_Evaluation_20.pdf (официальная страница проекта) и
 *   csl.noaa.gov/groups/csl5/datasets/NASAJPLDataEvaluation20.pdf (страница
 *   NOAA CSL Data Sets). Оба маршрута отвечают автоматизированным запросам;
 *   извлечённые текстовые слои идентичны (32 793 символа, посимвольное
 *   совпадение); уточнение provenance (вторая корректировка 2026-11-08):
 *   слой покрывает титул (с copyright-нотисом), аннотацию, посвящение,
 *   основное оглавление, полный текст введения (I.1–I.9, включая I.5
 *   Data Formats с цитатой о Table 2.1 и пункт 1.7.2 «Termolecular
 *   Reactions (Section 2) — No change») и детальное оглавление раздела 1,
 *   обрываясь в начале подраздела 1.1 Introduction раздела 1 (страница
 *   1-3) — таблицы коэффициентов (включая Table 2.1 Rate Coefficients
 *   for Association Reactions, упомянутую в I.5 Data Formats самого
 *   издания) вне автоматически извлекаемого фрагмента; байтовая идентичность и
 *   SHA-256 файлов НЕ установлены (в рабочей среде доступен только
 *   извлечённый текстовый слой). Copyright-нотис издания процитирован:
 *   «Copyright 2025, California Institute of Technology. U.S. Government
 *   sponsorship acknowledged.»; раздел 1.7.2 издания фиксирует
 *   «Termolecular Reactions (Section 2) — No change» относительно
 *   Evaluation No. 19. Per-record табличные значения НЕ извлечены, НЕ
 *   верифицированы, НЕ импортированы: все записи остаются
 *   status='unknown' (no_kinetic_data); наличие ссылок НЕ является
 *   доказательством извлечения коэффициентов и НЕ является разрешением
 *   на воспроизведение данных.
 * Per-record provenance (2026-11-08, третья корректировка доказательной базы;
 *   БЕЗ импорта параметров): для пяти записей каталога зафиксирована
 *   качественная классификация источников. Прямое N₂-экспериментальное
 *   свидетельство: №89 — Schieferstein, Kohse-Höinghaus, Stuhl (1983),
 *   NIST 1983SCH/KOH361, M=N₂, 200–370 K, third-order; №106 — Hsu,
 *   Durant, Kaufman (1987), NIST 1987HSU/DUR1895, M=N₂, 298 K (одна
 *   точка, экстраполяция T не допускается). Независимые, температурно
 *   раздельные источники №72: Zellner, Erler, Field (1977), NIST
 *   1977ZEL/ERL939 — эксперимент, M=N₂ при 300 K (He 230–300 K на N₂
 *   не распространяется); Goodings, Hayhurst (1988), NIST 1988GOO/HAY745
 *   — эксперимент, 1600–2200 K (неопределённость в NIST-записи не
 *   указана); Sellevåg, Georgievskii, Miller (2008) — теоретическая
 *   модель (master equation), N₂ low/high параметры 300–3000 K,
 *   Fcent(N₂)=0.73 (заявление публикации, в каталог НЕ переносится),
 *   авторы сообщают о несогласии с комнатно-температурными измерениями
 *   H + OH (+M); эксперимент и теория НЕ смешиваются. Evaluated N₂-обзор
 *   №1: Cohen, Westberg (1983), NIST 1983COH/WES531, 77–2000 K,
 *   uncertainty factor 3.16 — обзорная оценка, НЕ прямое измерение;
 *   Getzinger, Blair (1969) — прямое шокотрубное измерение с N₂,
 *   1259–1912 K, 1.1–3.7 atm, по абстракту N₂ ≈ в 1.5 раза выше Ar —
 *   отношение третьих тел, а не абсолютный N₂-коэффициент. Для №70
 *   N₂-специфической экспериментальной рекомендации НЕ установлено
 *   (Tsang, Hampson 1986, §5.4 O + H + M — грубые оценки при общем M,
 *   uncertainty factor 10; AIAA 2004-0463 Table 1 — модельная запись,
 *   библиографическая идентификация в этой сессии НЕ подтверждена) —
 *   запись остаётся unresolved. Строки JPL Table 2.1 B1 (H + O₂ → HO₂)
 *   и C1 (O + NO → NO₂) — рекомендации ДЛЯ ВОЗДУХА (по §2.1
 *   низкодавленческие параметры скорректированы для воздуха как третьего
 *   тела), унаследованные Evaluation No. 20 из раздела 2 Evaluation
 *   No. 19 (§1.7.2 «No change»); примечание C1 связывает low-pressure
 *   limit и температурный показатель с измерениями Schieferstein et al.
 *   и переанализом Whytock, high-pressure limit и m — с Hippler et al.
 *   (1999, DOI 10.1039/A806520I, high-pressure диапазон 200–400 K);
 *   примечание B1 отмечает среди использованных работ измерения при
 *   концентрациях N₂ ниже установленного предела. Доступ к 19-5 проверен
 *   по зеркалу science.jpl.nasa.gov/documents/1487/
 *   NASA-JPL_Evaluation_19-5.pdf (основной маршрут jpldataeval блокирует;
 *   зеркало ResearchGate даёт идентичный слой): слой 32 793 символа —
 *   титул, оглавление, введение I.1–I.9, обрыв в середине библиографии
 *   введения (страница xiv); §2.1, Table 2.1 (страница 2-5) и примечания
 *   B1/C1 автоматизированным извлечением НЕ читались — идентичность
 *   строк и атрибуция примечаний по ранее выполненному per-record
 *   исследованию, в этой сессии по таблице НЕ перепроверялись;
 *   собственный пункт 1.7.2 издания 19-5 (в слое, дословно) описывает
 *   обновления Table 2 в выпуске 19 (CA-механизм перенесён в Table 2.2).
 *   Числовые кинетические параметры в каталог НЕ переносились; все
 *   записи остаются status='unknown'.
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
  citation:
    'Wakelam, V. et al. 2012, ApJS 199, 21 — общее библиографическое описание базы KIDA; НЕ подтверждена как рекомендуемая цитата конкретного tb-экспорта 2015 года (см. DATA_PROVENANCE.md §2.28)',
  license:
    'unverified: KIDA Legal Notices — элементы сайта защищены законом об интеллектуальной собственности, несанкционированное воспроизведение и распространение запрещены; лицензия на скачиваемые наборы данных не публикуется',
  retrievedAt: '2026-11-03',
  note: 'справка по трёхтелесным реакциям (kida.astrochem-tools.org/help): формулы k(T), F и Fc(T) опубликованы изображениями официальной справки (bundles/labkida/images/formula/3body-1.png, 3body-2bis.png, 3body-3.png); полная форма документирована по визуальному чтению изображений — см. KINETIC_CATALOG_BLOCKING_QUESTIONS и DATA_PROVENANCE.md §2.28; текстом справки подтверждены c = −0.4 − 0.67·log10(Fc), N = 0.75 − 1.27·log10(Fc), d = 0.14, Pr = k0·[M]/k∞, Fc(T) из параметров a/b/c/d (a безразмерно, b/c/d в K) и политика Fc = 0.64 (Sander et al. 2006) при отсутствии параметров Troe — общая математика официальной справки, отделённая от числовых данных конкретных реакций; автоматизированное чтение изображений в рабочей среде недоступно; раздел units заявляет для termolecular cm6 s-1 и одновременно одинаковые единицы k0 и k∞ — противоречие зафиксировано в KINETIC_CATALOG_BLOCKING_QUESTIONS'
};

export const KIDA_TB_EXPORT_SOURCE: KineticsDataSourceDescriptor = {
  sourceName: 'KIDA three-body network export (kida_reac_tb_2015-03-19_1.csv)',
  sourceId: 'kida-tb-2015-03-19',
  url: 'https://raw.githubusercontent.com/SophiaAtmo/PATMO/d78ec8e2bcabc2c4071e71f12a9f817873ebd5dd/data/kida/kida_reac_tb_2015-03-19_1.csv',
  citation:
    'UNRESOLVED: рекомендуемая библиографическая ссылка для конкретного tb-экспорта не установлена. Требуется подтверждение KIDA. Wakelam, V. et al. 2012, ApJS 199, 21 — общее библиографическое описание базы KIDA, НЕ подтверждённая цитата этого экспорта. См. DATA_PROVENANCE.md §2.28',
  license:
    'unverified: KIDA Legal Notices запрещают несанкционированное воспроизведение и распространение элементов сайта; лицензия на скачиваемые наборы данных не публикуется; копия SophiaAtmo/PATMO@d78ec8e2bcabc2c4071e71f12a9f817873ebd5dd не содержит файла LICENSE — дословные строки экспорта НЕ воспроизводятся в этом репозитории',
  retrievedAt: '2026-11-03',
  note: '30 058 байт, сеть 94 вида / 112 реакций (по шапке readme), 36 колонок; формат колонок описан в readme экспорта kida_readme_tb_2015-03-19_1.txt (provenance-поле описания формата файла, НЕ библиография научного источника; ревизия 4.5.4.4.1); копия PATMO содержит помеченные правки «#MODIFIED»: у двух реакций оставлена одна строка с максимальным диапазоном температуры (значения не воспроизводятся), одна реакция исключена из сети комментарием как неоднозначная; экспорт не содержит per-record ссылок на первоисточники; идентичности каталога получены из этой копии, числовые параметры и метаданные курирования удалены в ревизиях 4.5.4.1/4.5.4.2'
};

export const JPL_EVALUATION_SOURCE: KineticsDataSourceDescriptor = {
  sourceName:
    'NASA JPL Chemical Kinetics and Photochemical Data for Use in Atmospheric Studies, Evaluation No. 20',
  sourceId: 'jpl-evaluation-20',
  url: 'https://science.jpl.nasa.gov/projects/data-evaluation/',
  citation:
    'J.B. Burkholder, R.L. Caravan, R.E. Huie, V.L. Orkin, C.J. Percival, R. Sander, S.P. Sander, D.M. Wilmouth. "Chemical Kinetics and Photochemical Data for Use in Atmospheric Studies, Evaluation No. 20," JPL Publication 25-1, Pasadena, 2025, DOI 10.48577/jpl.KFQ0TZ',
  license:
    'официальный нотис издания (по извлечённому тексту, 2026-11-08): «Copyright 2025, California Institute of Technology. U.S. Government sponsorship acknowledged.»; право на воспроизведение извлечённых данных НЕ подтверждено и НЕ заявляется; условия использования проверить',
  retrievedAt: '2026-11-03',
  note: 'публикация существует и публично предлагается (официальная страница проекта science.jpl.nasa.gov/projects/data-evaluation/); корректировка аудита доступа (2026-11-08, см. JPL_EVALUATION_20_ACCESS_AUDIT): установлены и проверены прямые PDF-ссылки — science.jpl.nasa.gov/documents/1503/NASA_Data_Evaluation_20.pdf (рабочий путь /documents/1503/, а не проверявшийся ранее паттерн /documents/1487/ выпуска 19-5) и csl.noaa.gov/groups/csl5/datasets/NASAJPLDataEvaluation20.pdf (страница NOAA CSL Data Sets, а не только библиографическая ссылка); оба маршрута отвечают автоматизированным запросам, извлечённые текстовые слои идентичны (32 793 символа); уточнение provenance 2026-11-08: слой покрывает титул (с copyright-нотисом), аннотацию, оглавление, полный текст введения (I.1–I.9, включая раздел I.5 Data Formats с цитатой о Table 2.1 и пункт 1.7.2 «Termolecular Reactions (Section 2) — No change» относительно Evaluation No. 19) и детальное оглавление раздела 1, обрываясь в начале подраздела 1.1 Introduction раздела 1 (страница 1-3) — таблицы коэффициентов (включая Table 2.1 Rate Coefficients for Association Reactions, упомянутую в I.5 Data Formats самого издания) вне автоматически извлекаемого фрагмента; наследование раздела 2 (per-record provenance 2026-11-08): §1.7.2 «No change» означает, что фактический источник таблиц раздела 2 Evaluation No. 20 — Evaluation No. 19 (Pub 19-5); доступ к зеркалу 19-5 проверен (science.jpl.nasa.gov/documents/1487/NASA-JPL_Evaluation_19-5.pdf), его извлечённый слой также покрывает только вводную часть (обрыв в середине библиографии введения, страница xiv) — таблицы 19-5 автоматизированным извлечением НЕ читались; строки B1 (H + O₂ → HO₂) и C1 (O + NO → NO₂) Table 2.1 — рекомендации для воздуха (по §2.1), не N₂-only; байтовая идентичность и SHA-256 файлов НЕ установлены; per-record данные НЕ импортированы, неподтверждённые коэффициенты не добавляются, статус записей не меняется на known/estimated; наличие публичных ссылок НЕ является доказательством извлечения коэффициентов и НЕ является разрешением на воспроизведение данных; импорт требует ручного извлечения таблиц или разрешённого API'
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
        'k(T) не рассчитано: (1) полная форма уширения KIDA (смещение центра c(Fc), член d = 0.14, T-зависимый Fc(T)) НЕ представима точно в контракте 4.5.2 и требует расширения (не реализовано); (2) размерности k0/k∞ противоречивы в справке KIDA (обе cm6.molecule-2.s-1 при Pr = k0·[M]/k∞) — единицы НЕ интерпретированы; (3) JPL Evaluation No. 20 не импортирован (корректировка аудита доступа 2026-11-08: прямые PDF-ссылки установлены и отвечают автоматизированным запросам, но таблицы коэффициентов вне автоматически извлекаемого фрагмента — per-record значения не извлечены и не верифицированы; см. JPL_EVALUATION_20_ACCESS_AUDIT); (4) лицензия KIDA unverified — дословные числовые параметры и метаданные курирования удалены из репозитория; вычислитель обязан отказывать (no_kinetic_data)',
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
  'Форма уширения KIDA: справка KIDA (kida.astrochem-tools.org/help, обращение 2026-11-08) публикует общие формулы k(T), F, Fc(T) изображениями (bundles/labkida/images/formula/3body-1.png, 3body-2bis.png, 3body-3.png) и текстом — c = −0.4 − 0.67·log10(Fc), N = 0.75 − 1.27·log10(Fc), d = 0.14, Pr = k0·[M]/k∞ и политика Fc = 0.64 (Sander et al. 2006) при отсутствии параметров Troe. Корректировка 2026-11-08 (визуальное чтение трёх официальных изображений; автоматизированное чтение изображений в рабочей среде недоступно): полная форма зафиксирована — k = k∞·Pr/(1+Pr)·F; F = Fc^(1/(1+((log10(Pr)+c)/(N−d·(log10(Pr)+c)))²)) с c = −0.4 − 0.67·log10(Fc), N = 0.75 − 1.27·log10(Fc), d = 0.14; Fc(T) = (1−a)·exp(−T/b) + a·exp(−T/c) + exp(−d/T) (a безразмерно; b, c, d в K; T в K); транскрипция согласуется с текстовыми фрагментами самой справки и с канонической Troe-формой литературы. Зафиксирована коллизия обозначений источника: c — центрирующий параметр c(Fc) в F и одновременно температурный параметр в Fc(T); d — фиксированная константа 0.14 в F и одновременно температурный параметр в exp(−d/T); при расширении контракта поля НЕ смешивать. Полная форма (сдвиг центра на c(Fc), член d = 0.14, T-зависимый Fc(T) из параметров a/b/c/d) НЕ представима точно в контракте 4.5.2 (нынешний контракт реализует упрощённое уширение: симметричная форма с константными centeringFactorFc ∈ (0,1] и broadeningN > 0); полная форма KIDA требует расширения контракта (модель уширения как discriminated union с обратной совместимостью 4.5.1–4.5.3; предложение в дорожной карте, НЕ реализовано; модель НЕ реализована). Per-record Fc-параметры отдельных записей экспорта НЕ воспроизводятся в репозитории (лицензия unverified, ревизия 4.5.4.2); зафиксировано только, что у части записей буквальное чтение их Fc-параметров противоречит политике KIDA «Fc = 0.64», а трактовка сентинелов формата «не задано» неоднозначна — интерпретация должна быть подтверждена командой KIDA; точная структура индивидуальных Fc-параметров каждой записи остаётся предметом per-record проверки. Реализация parseKIDA3b в PATMO@d78ec8e2 отклоняется от канонической Troe-формы литературы (произведение вместо суммы в Fc(T), y без скобок, Pr = k0/k∞ без [M]) и не может служить нормой (вторичный источник)',
  'Размерности k0/k∞: официальная справка KIDA утверждает одинаковые единицы k0 и k∞ (цитата: «Both rate constants have the following unit: cm6.molecules-2.s-1», т.е. cm6.molecule-2.s-1 для обеих), но Pr = k0·[M]/k∞ безразмерен только при [k0]/[k∞] = единица концентрации (k∞ — cm3.molecule-1.s-1 по конвенции JPL/IUPAC); readme экспорта единицы не специфицирует; копия PATMO@d78ec8e2 вычисляет Pr = k0/k∞ без [M]. Противоречие источника — блокер: единицы исходных параметров оставлены неинтерпретированными, параметры НЕ промоутируются',
  'JPL Evaluation No. 20 (JPL Publication 25-1, 2025, DOI 10.48577/jpl.KFQ0TZ; авторы по официальной записи: Burkholder, Caravan, Huie, Orkin, Percival, R. Sander, S.P. Sander, Wilmouth): публикация существует и публично предлагается (страница проекта science.jpl.nasa.gov/projects/data-evaluation/); корректировка аудита доступа (2026-11-08, см. JPL_EVALUATION_20_ACCESS_AUDIT): установлены и проверены прямые PDF-ссылки — science.jpl.nasa.gov/documents/1503/NASA_Data_Evaluation_20.pdf (рабочий путь /documents/1503/; прежнее наблюдение о паттерне прямых ссылок прошлых выпусков, возвращавшем 404 для 25-1, скорректировано) и csl.noaa.gov/groups/csl5/datasets/NASAJPLDataEvaluation20.pdf (страница NOAA CSL Data Sets; прежнее наблюдение «NOAA CSL — только цитата» скорректировано: страница публикует прямую PDF-ссылку); оба маршрута отвечают автоматизированным запросам, извлечённые текстовые слои идентичны (32 793 символа, посимвольно; байтовая идентичность и SHA-256 НЕ установлены), однако извлечение покрывает только вводную часть издания (титул с copyright-нотисом, аннотация, оглавление, введение I.1–I.9, детальное оглавление раздела 1) и обрывается в начале подраздела 1.1 Introduction раздела 1 (страница 1-3) — таблицы коэффициентов (включая Table 2.1 Rate Coefficients for Association Reactions, упомянутую в разделе I.5 Data Formats самого издания) вне автоматически извлекаемого фрагмента; в том же слое процитированы copyright-нотис («Copyright 2025, California Institute of Technology. U.S. Government sponsorship acknowledged.»; в слое дословно с переносом строки после «Copyright») и пункт 1.7.2 «Termolecular Reactions (Section 2) — No change» относительно Evaluation No. 19; прочие маршруты аудита 4.5.4.5 без изменений (страница рендерится клиентским JavaScript; DOI ведёт в запись JPL Dataverse (регистрация 2026-07-28), хост блокирует автоматизированный доступ; NTRS и зеркала выпуск не содержат). Per-record табличные значения НЕ извлечены, НЕ верифицированы, НЕ импортированы, записи JPL не импортированы, неподтверждённые коэффициенты не добавляются; наличие прямых ссылок НЕ является доказательством извлечения коэффициентов и НЕ является разрешением на воспроизведение данных; требуется ручное извлечение таблиц или разрешённый API (per-record ссылки на первоисточники, формы энергии, опорная температура 298→300 K, диапазоны T, температурные неопределённости)',
  'Лицензия KIDA: Legal Notices (kida.astrochem-tools.org/legal) — элементы сайта защищены законом об интеллектуальной собственности, несанкционированное воспроизведение, распространение и использование запрещены; лицензия на скачиваемые наборы данных не публикуется; копия SophiaAtmo/PATMO@d78ec8e2 не содержит файла LICENSE. Право на распространение содержимого экспорта НЕ подтверждено: в ревизиях 4.5.4.1/4.5.4.2 из репозитория удалены все per-record числовые параметры (коэффициенты k0/k∞, Fc-параметры, T-диапазоны, неопределённости), исходные строки CSV и метаданные курирования (networkMultiplicity, recommendation); оставлены только номера реакций KIDA (идентификаторы записей источника), состав видов (физический факт; идентичности перенесены из KIDA-экспорта и потенциально проверяемы по независимой литературе — независимая проверка в проекте НЕ задокументирована, уточнение 4.5.4.3), библиография и общие метаданные источника — оставшиеся поля НЕ объявляются автоматически лицензионно очищенными и могут быть дополнительно исключены; промоушен параметров требует ответа кураторов KIDA (контакт: kida-obsu-bordeaux.fr) и установленной цитаты экспорта: рекомендуемая библиографическая ссылка для tb-экспорта не установлена — UNRESOLVED (Wakelam et al. 2012, ApJS 199, 21 — общее библиографическое описание базы KIDA, НЕ подтверждено как рекомендуемая цитата этого экспорта; см. ревизию 4.5.4.4.1 и DATA_PROVENANCE.md §2.28)'
];

export interface JplEvaluation20AccessAuditRecord {
  readonly kidaReactionNumber: number;
  readonly kidaTbRecordId: string;
  readonly reaction: string;
  readonly coverage: 'not_established';
  readonly parametersVerified: false;
  readonly statusAfterAudit: 'unknown';
  readonly note: string;
}

export interface JplEvaluation20AccessAudit {
  readonly auditedAt: string;
  readonly evaluationCitation: string;
  readonly doi: string;
  readonly accessFindings: readonly string[];
  readonly records: readonly JplEvaluation20AccessAuditRecord[];
  readonly conclusion: string;
}

// Stage 4.5.4 (ревизия 4.5.4.5, 08.11.2026): per-record аудит ДОСТУПА к табличным
// значениям JPL Evaluation No. 20 — проверяемый автоматизированный доступ не
// установлен; параметры НЕ верифицированы и НЕ импортированы (все записи
// остаются status='unknown', no_kinetic_data); значения полей аудита —
// зафиксированные наблюдения доступа, НЕ импортированные данные публикации.
// Корректировка доказательной базы того же дня (2026-11-08): прямые PDF-ссылки
// установлены и отвечают автоматизированным запросам (извлечённые текстовые
// слои идентичны), однако таблицы коэффициентов вне автоматически извлекаемого
// фрагмента — вывод аудита о недоступности per-record значений сохраняется;
// наблюдения ниже актуализированы, история наблюдений — DATA_PROVENANCE.md §2.28.
// Уточнение provenance (2026-11-08, вторая корректировка): зафиксированы
// фактические границы извлечённого слоя — титул (с copyright-нотисом),
// аннотация, оглавление, введение I.1–I.9 (включая I.5 Data Formats и
// пункт 1.7.2) и детальное оглавление раздела 1; обрыв — в начале
// подраздела 1.1 Introduction раздела 1 (страница 1-3).
const JPL20_PER_RECORD_PROVENANCE_NOTES: Readonly<Record<number, string>> = {
  1: 'H + H + N₂ → H₂ + N₂: (a) Cohen, Westberg (1983), J. Phys. Chem. Ref. Data 12, NIST-запись 1983COH/WES531 — evaluated review (обзорная оценка, НЕ прямое измерение), N₂-специфические данные, 77–2000 K, uncertainty factor 3.16; (b) Getzinger, Blair (1969), Combustion and Flame, DOI 10.1016/0010-2180(69)90005-4 — прямое шокотрубное измерение с N₂, 1259–1912 K, 1.1–3.7 atm; по абстракту N₂-значения ≈ в 1.5 раза выше ранее опубликованных для Ar — отношение третьих тел, а не абсолютный N₂-коэффициент; соответствующей строки JPL Table 2.1 не установлено',
  70: 'H + O + N₂ → OH + N₂: (a) Tsang, Hampson (1986), J. Phys. Chem. Ref. Data 15, 1087–1279, DOI 10.1063/1.555759, §5.4 O + H + M — обзор: определённых измерений не сообщается, приведены грубые оценки, uncertainty factor 10; рекомендация по общему M, НЕ N₂-специфическая; (b) AIAA 2004-0463, Table 1 (O + H + M) — модельная кинетическая запись механизма (N₂ как базовый collider — правило модели), НЕ самостоятельный эксперимент; библиографическая идентификация публикации в этой сессии НЕ подтверждена; N₂-специфического экспериментального источника НЕ установлено — запись остаётся unresolved',
  72: 'OH + H + N₂ → H₂O + N₂: (a) Zellner, Erler, Field (1977), DOI 10.1016/S0082-0784(77)80386-X, NIST-запись 1977ZEL/ERL939 — прямое экспериментальное измерение (discharge flow, резонансная флуоресценция): M = N₂ при 300 K (по абстракту: M = He в 230–300 K; M = Ar, N₂, CO₂ при 300 K); T-зависимость измерений He на N₂ НЕ распространяется; (b) Goodings, Hayhurst (1988), J. Chem. Soc. Faraday Trans. 2 84, 745–762, DOI 10.1039/F29888400745, NIST-запись 1988GOO/HAY745 — прямые измерения в топливно-бедных пламёнах H₂ + O₂ + N₂, 1600–2200 K; неопределённость в NIST-записи не указана; (c) Sellevåg, Georgievskii, Miller (2008), J. Phys. Chem. A 112, 5085–5095, DOI 10.1021/jp711800z — теоретическая модель (master equation), N₂ low/high параметры в 300–3000 K, Fcent(N₂) = 0.73 (заявлено публикацией, в каталог НЕ переносится); авторы сообщают о несогласии с измерениями H + OH (+M) при комнатной температуре; источники температурно раздельны, эксперимент и теория НЕ смешиваются',
  89: 'O + NO + N₂ → NO₂ + N₂: (a) Schieferstein, Kohse-Höinghaus, Stuhl (1983), Ber. Bunsenges. Phys. Chem. 87, 361–366, DOI 10.1002/bbpc.19830870419, NIST-запись 1983SCH/KOH361 — прямые измерения с M = N₂, 200–370 K, third-order (cm⁶ molecule⁻² s⁻¹); в NIST-записи указаны неопределённости предэкспоненты и энергетического параметра; (b) строка C1 JPL Table 2.1 (Evaluation No. 19; унаследована в No. 20 по §1.7.2 «No change»): примечание C1 связывает low-pressure limit и температурный показатель с измерениями Schieferstein et al. и переанализом Whytock, high-pressure limit и m — с Hippler, Siefke, Stark, Troe (1999), DOI 10.1039/A806520I (рекомбинация O + NO, high-pressure диапазон 200–400 K); итоговая строка — рекомендация ДЛЯ ВОЗДУХА (по §2.1), НЕ N₂-only; Table 2.1/§2.1 автоматизированным извлечением НЕ читались — атрибуция по ранее выполненному per-record исследованию',
  106: 'H + O₂ + N₂ → HO₂ + N₂: (a) Hsu, Durant, Kaufman (1987), J. Phys. Chem. 91, 1895–1899, DOI 10.1021/j100291a043, NIST-запись 1987HSU/DUR1895 — прямое измерение при 298 K для M = N₂ (заголовок публикации: «Rate constants for H + O2 + M at 298 K for M = He, N2, and H2O»); в NIST-записи указан измерительный диапазон давления; температурный диапазон НЕ расширяется за пределы опубликованной точки 298 K; (b) строка B1 JPL Table 2.1 (Evaluation No. 19; унаследована в No. 20 по §1.7.2 «No change»): примечание B1 — итоговая рекомендация ДЛЯ ВОЗДУХА (по §2.1), при построении рассматривались, среди прочего, исследования при концентрациях N₂ ниже установленного предела; НЕ индивидуальная N₂-кривая; Table 2.1/§2.1 автоматизированным извлечением НЕ читались — атрибуция по ранее выполненному per-record исследованию'
};

export const JPL_EVALUATION_20_ACCESS_AUDIT: JplEvaluation20AccessAudit = {
  auditedAt: '2026-11-08',
  evaluationCitation: JPL_EVALUATION_SOURCE.citation,
  doi: '10.48577/jpl.KFQ0TZ',
  accessFindings: [
    'корректировка 2026-11-08: установлены и проверены прямые PDF-ссылки — science.jpl.nasa.gov/documents/1503/NASA_Data_Evaluation_20.pdf (официальная страница проекта публикует путь /documents/1503/; прежнее наблюдение о паттерне прямых ссылок прошлых выпусков (/documents/1487/ для 19-5), возвращавшем 404 для 25-1, скорректировано) и csl.noaa.gov/groups/csl5/datasets/NASAJPLDataEvaluation20.pdf (страница NOAA CSL Data Sets; прежнее наблюдение «только библиографическая ссылка» скорректировано: страница публикует прямую PDF-ссылку)',
    'оба маршрута отвечают автоматизированным запросам; извлечённые текстовые слои идентичны (32 793 символа, посимвольное совпадение); фактические границы слоя (уточнение provenance, вторая корректировка): титульные страницы с copyright-нотисом, аннотация, посвящение, основное оглавление, полный текст введения (I.1–I.9) и детальное оглавление раздела 1; байтовая идентичность файлов и SHA-256 НЕ установлены — в рабочей среде доступен только извлечённый текстовый слой, байтовое тождество двух серверных копий НЕ заявляется',
    'обрыв текстового слоя — в начале подраздела 1.1 Introduction раздела 1 (маркер страницы 1-3), на первом предложении; таблицы коэффициентов разделов 1–7 — включая Table 2.1 Rate Coefficients for Association Reactions — вне автоматически извлекаемого фрагмента; сама Table 2.1 подтверждается только цитатой раздела I.5 Data Formats («The data in Table 2.1 (Rate Coefficients for Association Reactions) are presented in the same order as in the bimolecular reactions section»; страница x по оглавлению издания), содержимое таблицы НЕ извлечено',
    'титульный лист извлечён: JPL Publication 25-1, Evaluation Number 20, NASA Panel for Data Evaluation (Burkholder — NOAA CSL; Caravan — Argonne National Laboratory; Huie и Orkin — NIST; Percival и S.P. Sander — JPL/Caltech; R. Sander — Max-Planck Institute for Chemistry; Wilmouth — Harvard), Pasadena, California, 2025; copyright-нотис издания процитирован по извлечённому тексту (титульный блок, непосредственно перед маркером страницы «iii» с аннотацией; в слое дословно с переносом строки после «Copyright»): «Copyright 2025, California Institute of Technology. U.S. Government sponsorship acknowledged.»',
    'в том же извлечённом слое (пункт 1.7.2 раздела I.7 Noteworthy Changes/Updates, страница x по оглавлению издания) дословно присутствует: «1.7.2 Termolecular Reactions (Section 2) — No change» относительно предыдущего выпуска (Evaluation No. 19); перекрёстно подтверждено извлечением пользовательской DOCX-копии (следующее наблюдение); per-record табличные значения от этого НЕ становятся извлечёнными или верифицированными',
    'прочие маршруты аудита 4.5.4.5 без изменений: страница проекта рендерится клиентским JavaScript; DOI 10.48577/jpl.KFQ0TZ разрешается в запись JPL Dataverse (регистрация 2026-07-28), хост блокирует автоматизированные запросы; jpldataeval.jpl.nasa.gov блокирует (автоматизированно доступен только выпуск 19-5); NTRS выпуск не содержит (для сравнения: запись Evaluation No. 19 — 20210006316); ResearchGate содержит только 19-5; поиск по коду GitHub результатов не даёт',
    'копии, предоставленные в рабочую среду: первая загрузка (NASA_Data_Evaluation_20.pdf) НЕ выставлена в читаемом виде (байты в файловой системе не хранятся, автоматическое извлечение текста (OCR) не удалось); повторная загрузка 2026-11-08 (NASA_Data_Evaluation_20 (1).docx) извлечена успешно (OCR; сохранение промежуточных артефактов превысило лимит размера, извлечённый текст получен) — покрывает титул с copyright-нотисом, аннотацию, посвящение, оглавление и введение (I.1–I.9, до раздела Bibliography), по содержанию совпадает с текстовым слоем PDF; таблиц коэффициентов в извлечении НЕТ; происхождение конвертации и байтовое соответствие серверным PDF НЕ устанавливаются; обе копии НЕ использованы как источник per-record данных',
    'per-record provenance 2026-11-08 (третья корректировка): доступ к предшествующему изданию Evaluation No. 19 (Pub 19-5) проверен — зеркало science.jpl.nasa.gov/documents/1487/NASA-JPL_Evaluation_19-5.pdf отвечает автоматизированным запросам (основной маршрут jpldataeval.jpl.nasa.gov/pdf/NASA-JPL%20Evaluation%2019-5.pdf в этой сессии блокирует; зеркало ResearchGate отдаёт идентичный слой): извлечённый текстовый слой — 32 793 символа, покрывает титул, оглавление и введение I.1–I.9, обрыв в середине библиографии введения (страница xiv); §2.1, Table 2.1 (Rate Coefficients for Association Reactions; страница 2-5 по заданию) и примечания B1/C1 вне автоматически извлекаемого фрагмента — непосредственное чтение таблиц НЕ выполнялось; в слое 19-5 дословно присутствуют цитата I.5 Data Formats о Table 2.1 и собственный пункт 1.7.2 издания 19-5 (обновления Table 2; CA-механизм перенесён в Table 2.2); наследование раздела 2 Evaluation No. 20 из Evaluation No. 19 подтверждается пунктом 1.7.2 «No change» слоя 25-1; per-record источники пяти записей каталога зафиксированы качественно в records[].note (прямое N₂-измерение / evaluated review / теория / модель; числовые параметры НЕ переносились)',
    'вывод: прямой доступ к публикации существует (публичные PDF-ссылки), однако per-record табличные значения НЕ доступны автоматически — требуется ручное извлечение таблиц или разрешённый API; параметры НЕ верифицированы и НЕ импортированы; наличие ссылок не является доказательством извлечения коэффициентов и не является разрешением на воспроизведение данных'
  ],
  records: KIDA_TB_RECORD_IDENTITIES.map((identity): JplEvaluation20AccessAuditRecord => ({
    kidaReactionNumber: identity.kidaReactionNumber,
    kidaTbRecordId: kidaTbRecordId(identity.kidaReactionNumber),
    reaction: `${identity.reactants.join(' + ')} → ${identity.products.join(' + ')}`,
    coverage: 'not_established',
    parametersVerified: false,
    statusAfterAudit: 'unknown',
    note: `аудит доступа 2026-11-08 (корректировка): прямые ссылки на публикацию установлены и отвечают, но таблицы коэффициентов вне автоматически извлекаемого фрагмента — табличные значения JPL Evaluation No. 20 для реакции №${identity.kidaReactionNumber} не получены; параметры не верифицированы, запись каталога остаётся status='unknown' (no_kinetic_data); per-record provenance (2026-11-08, качественная классификация без импорта): ${JPL20_PER_RECORD_PROVENANCE_NOTES[identity.kidaReactionNumber] ?? ''}`
  })),
  conclusion: 'корректировка аудита доступа (ревизия 4.5.4.5, 2026-11-08): прямые PDF-ссылки на JPL Evaluation No. 20 установлены и отвечают автоматизированным запросам (science.jpl.nasa.gov/documents/1503/NASA_Data_Evaluation_20.pdf; csl.noaa.gov/groups/csl5/datasets/NASAJPLDataEvaluation20.pdf; извлечённые текстовые слои идентичны, 32 793 символа); уточнение provenance 2026-11-08: слой покрывает титул, аннотацию, оглавление, введение I.1–I.9 (включая I.5 Data Formats и пункт 1.7.2 «Termolecular Reactions (Section 2) — No change») и детальное оглавление раздела 1, обрываясь в начале подраздела 1.1 Introduction раздела 1 (страница 1-3), до таблиц коэффициентов: per-record табличные значения не верифицированы, импорт не выполнен, все 5 записей каталога остаются status=unknown — вычислитель 4.5.2 обязан отказывать (no_kinetic_data); per-record provenance (третья корректировка 2026-11-08): прямое N₂-экспериментальное свидетельство зафиксировано для №89 (Schieferstein et al. 1983, 200–370 K) и №106 (Hsu et al. 1987, 298 K), для №72 — независимые температурно раздельные источники (Zellner et al. 1977 — 300 K; Goodings/Hayhurst 1988 — 1600–2200 K; Sellevåg et al. 2008 — теория, 300–3000 K), для №1 — evaluated N₂-обзор (Cohen/Westberg 1983) при отличии от прямых измерений, для №70 N₂-специфический экспериментальный источник не установлен; строки JPL B1/C1 (Table 2.1) — рекомендации для воздуха, унаследованные из раздела 2 Evaluation No. 19 по §1.7.2 «No change»; таблицы 19-5 автоматизированным извлечением не читались (слой обрывается в библиографии введения); параметры по-прежнему не верифицированы и не импортированы; fail-closed сохранён, блокирующие вопросы не закрыты; наличие прямых ссылок не является доказательством извлечения коэффициентов и не является разрешением на воспроизведение данных'
};
