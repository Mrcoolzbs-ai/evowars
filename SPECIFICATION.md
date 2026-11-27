# Evolution Wars — восстановленная спецификация проекта

> **Статус документа:** реконструкция требований и фактических контрактов по исходному коду, тестам, истории изменений и инженерным документам.
>
> **Срез документа и CI:** 27 ноября 2026 года (актуализация спецификации; последние подтверждённые code snapshots — 25 ноября).  
> **Кодовый срез расширенной ветки:** `stage-3-planetary-physics`, текущий HEAD открытого PR #1 — `185ca962ad32118abf996d0a6e9bf216613fda04` (25.11.2026 18:51:21 UTC; последний commit синхронизирует документацию). После более раннего среза `56b7214` добавлены воспроизводимый аудит официальных индексов NGIMS L2/L3, точное сопоставление продуктов и замороженный результат аудита; см. §6.17.  
> **CI:** полный workflow на HEAD PR #1 `185ca962ad32118abf996d0a6e9bf216613fda04` завершился успешно: [run 45679361722](https://github.com/Mrcoolzbs-ai/evowars/actions/runs/45679361722), событие `push`, TypeScript — success; Vitest — 103 файла passed / 2 skipped, 3 368 тестов passed / 53 skipped; lint — 62 warnings, 0 errors; production build — success (неблокирующее предупреждение о JS bundle 1 060.58 kB, gzip 272.96 kB). Для `main` на commit `d5e2a4f30a363e828e8bb882a01cb1cf78b4526b` также прошёл полный [run 45705149594](https://github.com/Mrcoolzbs-ai/evowars/actions/runs/45705149594): TypeScript, 4 test files, lint (3 warnings, 0 errors) и production build — success. GitHub combined-status и PR-triggered workflow records для HEAD пусты, но это не отменяет успешный commit-triggered CI run 45679361722. Результат #1047 более не является последней CI-базой для PR HEAD. CI подтверждает программные проверки, но не научную готовность моделей или Stage 4.2.  
> **Интеграционный статус:** кодовые изменения этой ветки остаются в открытом PR [#1](https://github.com/Mrcoolzbs-ai/evowars/pull/1) в `main`; этот документ восстановлен отдельно в `main` и сам по себе не означает, что функции этапа 3 уже вошли в основную ветку.
>
> Документ различает **реализовано**, **частично реализовано** и **планируется**. Наличие типа, интерфейса или проектного документа само по себе не означает, что соответствующая физическая модель работает в пользовательском сценарии.

## 1. Назначение и границы продукта

**Evolution Wars** — браузерное приложение для детерминированной генерации планетарных миров и исследования их физических, атмосферных и химических свойств во времени.

Пользователь задаёт seed, режим генерации и, при необходимости, фиксирует отдельные категории. Приложение формирует связанный набор начальных условий: космологический контекст, возрастную эпоху, центральный объект, небесное тело, атмосферу и возможную среду возникновения жизни. Далее к этим условиям применяются физические оценки, проверки совместимости и доступные модели эволюции.

В подтверждённом интерфейсе продукт — **генератор и исследовательская песочница планетарных миров**. Полноценная многопользовательская стратегия, сетевые матчи, экономика, боевые правила, учётные записи и серверная игровая инфраструктура в репозитории не специфицированы и не должны считаться существующими функциями.

Основной принцип продукта: лучше показать неполную модель с честно обозначенными допущениями и неизвестными величинами, чем выдавать игровую эвристику за научный расчёт.

## 2. Пользовательские сценарии

1. **Создать мир.** Пользователь вводит или генерирует seed, выбирает реалистичный либо аномальный режим и задаёт необязательные фиксированные категории. При незаданной категории используется генератор.
2. **Повторить генерацию.** Один и тот же seed, версия генератора и набор настроек должны воспроизводить один и тот же результат.
3. **Сравнить варианты.** Можно запросить пакетную генерацию трёх миров на основе настроек.
4. **Изучить паспорт мира.** Интерфейс показывает состав мира, физические характеристики, атмосферу, предупреждения, научный статус и причинно-следственное объяснение выбранной конфигурации.
5. **Исследовать эволюцию.** Для поддерживаемых сценариев пользователь может выполнять химический шаг или запускать ограниченный физический кинетический эксперимент, просматривать историю шагов и аудиты.
6. **Сохранить и продолжить.** Миры и настройки сохраняются локально; пользователь может открыть сохранённый мир, удалить его или очистить историю.
7. **Экспортировать данные.** Поддерживается экспорт мира в JSON и Markdown, копирование результата и скачивание файла.

## 3. Генерация миров

### 3.1 Входные параметры

- `seed` — строка, определяющая последовательность псевдослучайных выборок;
- `mode` — `realistic` или `anomalous`;
- `fixedCategories` — необязательные идентификаторы фиксированных категорий:
  - `cosmology`;
  - `epoch`;
  - `centralObject`;
  - `celestialBody`;
  - `cradle`.

Пустая категория означает случайный выбор. Аномальная космология должна активировать аномальный режим независимо от исходного переключателя пользователя. В аномальном режиме отключаются только правила совместимости, для которых явно выставлено `exemptInAnomalousMode`; остальные проверки сохраняются.

### 3.2 Каталоги

Каталоги описывают варианты космологий, эпох, центральных объектов, небесных тел, колыбелей жизни, газов, реакций, физических и фазовых свойств. Элемент каталога имеет устойчивый `id`, человекочитаемое имя, описание/теги, веса или диапазоны выбора и сведения о достоверности/совместимости там, где это применимо.

Каталожные диапазоны и эвристики не становятся физическими измерениями только потому, что участвуют в генерации. Они маркируются как оценки или игровые допущения.

### 3.3 Порядок построения мира

Генерация причинно-следственная, а не набор независимых бросков:

1. выбор космологии и режима;
2. выбор эпохи;
3. выбор центрального объекта с учётом возраста эпохи;
4. выбор небесного тела с учётом центрального объекта;
5. построение атмосферы;
6. выборка физических характеристик тела;
7. построение системы центрального объекта и орбиты;
8. расчёт атмосферных производных и фазового скрининга;
9. качественный геологический анализ и энергетический бюджет;
10. создание начального химического инвентаря;
11. выбор/проверка локальной среды колыбели жизни;
12. проверка совместимости на сформированном мире и формирование предупреждений.

Фактический порядок и зависимости реализуются в `src/modules/Generator/generator.ts`. В частности, локальная среда колыбели жизни не должна автоматически отождествляться со всей атмосферой планеты.

### 3.4 Воспроизводимость

Используется детерминированный PRNG Mulberry32 с инициализацией из seed. Все случайные выборки одного запуска должны идти через управляемый генератор случайных чисел, а не через произвольные вызовы глобального `Math.random()`. Изменение последовательности генерации является изменением поведения и должно сопровождаться тестами/учётом версии генератора.

## 4. Модель мира и данные

В системе принципиально разделены два уровня состояния.

- **`GeneratedWorld`** — результат генерации и начальный паспорт мира. Его исходные каталожные выборки и значения не должны незаметно изменяться при физических шагах.
- **`CoreWorldState`** — опциональное каноническое состояние научного ядра, содержащее эволюционирующие тела, резервуары, потоки, реакционные записи, время и состояние планировщика. Оно ссылается на исходный мир по идентификаторам, но не дублирует его научные значения.

Физические шаги изменяют `CoreWorldState`, а не переписывают исходные входы `GeneratedWorld`. Переход от legacy-полей к типизированным научным величинам выполняется явными адаптерами с происхождением данных.

В иерархии системы отдельно учитываются:

- космологический возраст и локальное модельное время;
- гравитационный родитель тела и источники излучения;
- центральный объект, источник света и родительское тело;
- тело и его внутренние слои;
- резервуары вещества и энергетические резервуары.

Гравитационная связь не означает автоматически, что объект является единственным источником излучения. Например, свободно дрейфующее тело может иметь радиационные источники, а система с несколькими звёздами — несколько источников излучения.

## 5. Научные контракты и достоверность

### 5.1 Обязательные правила

1. **Неизвестное не равно нулю.** Отсутствие данных представляется как неизвестное значение (`null`/статус `unknown`), а не как 0.
2. **Никакой фиктивной точности.** Если результат зависит от упрощения, оно отображается как допущение, оценка или предупреждение.
3. **Происхождение величины сохраняется.** Для значений указываются метод получения, источник, формула и/или диапазон применимости, если они известны.
4. **Единицы согласованы.** Внутренние физические расчёты используют SI; привычные единицы преобразуются на границе пользовательского интерфейса.
5. **Нельзя экстраполировать молча.** За пределами опубликованного диапазона данные не применяются без явной политики и маркировки.
6. **Законы сохранения проверяются.** Элементы, заряд, материальные запасы и энергия учитываются через явные инвентари и потоки; численное расхождение не скрывается автоматической коррекцией.
7. **Температуры не взаимозаменяемы.** Эффективная температура звезды, равновесная температура тела, температура поверхности, температура атмосферного слоя, температура резервуара и температура реакции — разные величины.

### 5.2 Статусы достоверности

Научные величины используют единую семантику, включая статусы:

- `established` — установленное/справочное значение;
- `derived` — результат вычисления из других величин;
- `estimated` — оценка или выборка;
- `hypothetical` — гипотетическая модель/условие;
- `game_assumption` — игровое допущение;
- `unknown` — недостаточно данных.

Статус описывает происхождение знания, а не «качество мира» или игровой рейтинг.

## 6. Физические подсистемы

### 6.1 Единицы и константы

Модуль `Units` предоставляет SI-константы и конвертеры между SI и используемыми в интерфейсе величинами: атмосферы/Па, бары/Па, массы и радиусы Земли/кг и м, а.е./м, годы/секунды. Константы и преобразования должны иметь проверяемые определения и тесты.

### 6.2 Центральная система и орбита

Модель центральных объектов различает звёзды, компактные остатки, субзвёздные объекты, системы планет-гигантов и другие поддерживаемые классы. Орбитальная конфигурация задаёт систему отсчёта: орбита вокруг звезды, вокруг родительской планеты, свободное движение либо специальная конфигурация, определённая каталогом.

Базовые зависимости:
- поток излучения: (F=L/(4\pi a^2));
- кеплеровский период: (P=2\pi\sqrt{a^3/(GM)});
- равновесная температура: (T_{eq}=[F(1-A)f/(4\epsilon\sigma)]^{1/4}).

Значения альбедо, перераспределения тепла и эмиссивности по умолчанию являются явными допущениями. Если светимость или расстояние неизвестны, поток и (T_{eq}) остаются неизвестными. Орбитальные диапазоны, которые задаются игровыми каталогами, не объявляются динамически устойчивыми орбитами без отдельной проверки.

### 6.3 Физика тела и геология

Для тела рассчитываются/оцениваются масса, радиус, плотность и поверхностная гравитация. Используются:
- (\rho=M/(4\pi R^3/3));
- (g=GM/R^2).

Выборка из диапазонов — оценка, а вычисленная из неё гравитация — производная величина. Неправдоподобная выборка должна диагностироваться, а не маскироваться.

Геологический слой отдельно описывает остаточное, радиогенное и приливное внутреннее тепло. Качественные классы активности не равны мощности в ваттах. Численная мощность не выводится без необходимых физических параметров и источника данных. Количественная модель недр, гидростатическое строение, тепловая эволюция и уравнения состояния развиваются отдельными этапами и не считаются полными только по факту наличия прототипов модулей.

### 6.4 Атмосфера и энергетика

Атмосфера задаётся компонентами с молярными долями, давлением и температурой. Для идеальногазового приближения:
- (p_i=x_iP);
- масса столба (m=P/g);
- количество вещества столба (n=P/(gM_{mix})).

Приближение явно маркируется. В начальном атмосферном слое модели не следует подразумевать полноценный климат, радиационный перенос или многослойную вертикальную динамику. Равновесная температура (T_{eq}) не является температурой поверхности; парниковая модель должна быть отдельным расчётным контуром.

Физическая кинетика, если она включена явно, может получать послойные температуры, высотные границы и столбовые запасы. Такие данные требуют независимого происхождения и проверки неперекрытия слоёв. Пользовательские слои не следует описывать как автоматически выведенный атмосферный профиль.

### 6.5 Фазовые состояния

Базовый скрининг чистых атмосферных компонентов использует парциальное давление, давление насыщенного пара и показатель (S_i=p_i/P_{sat,i}). Для CH₄ и C₂H₆ используются опубликованные корреляции Антуана в оговорённых диапазонах; экстраполяция сопровождается предупреждением.

Значение (S_i) — индикатор скрининга, не полноценное равновесие многокомпонентной смеси. Закон Рауля допускается только как явно упрощённое приближение. В расширенной ветке PR #1 существуют явный изотермо-изобарный Peng–Robinson VLE flash и отдельные API `analyzeVleWithPengRobinson` / `analyzeAtmosphereVleWithPengRobinson`; они не активируются автоматически. Статус `two_phase_candidate` обозначает кандидата равновесия, а не доказанную глобальную устойчивость. Непрерывная сертификация TPD имеет статус NO-GO; LLE, полный фазовый flash с конденсированными фазами и полностью сертифицированная глобальная фазовая устойчивость не считаются реализованными.

### 6.6 Наблюдательный атмосферный профиль Марса

В модуле данных хранится один профиль радиозатмения Mars Global Surveyor — PDS-продукт `8028D38A.TPS` (28 января 1998 года, 29.213° N, 56.774° E, local true solar time 5.727 h). Импортированы 74 строки давления, температуры, геопотенциала, численной плотности и опубликованных неопределённостей. Вертикальная координата отсчитывается от локального радиуса на поверхности, указанного в PDS header.

Адаптер `createMgsMars8028D38AHydrostaticColumnInput()` передаёт температурные узлы в Core через `measuredNodes` с линейной интерполяцией. Нижней границей служит первая фактически опубликованная точка профиля; экстраполированное заголовочное поверхностное давление не трактуется как прямое измерение. Состав атмосферы должен поступить явно, иметь provenance, уникальные виды и нормированную сумму долей. Генератор не назначает этот профиль любому случайному миру автоматически.

**Ограничения:** P/T в PDS — retrieval-величины, полученные при предположениях гидростатики, идеального газа и состава на основе измерений Viking; это не прямые показания термометра. Профиль представляет одно событие, а не глобальную климатологию. Core использует сферическую гравитацию по массе Марса и локальному радиусу, а не поле GGM50A02 исходного retrieval. Отдельный first-order postprocessor распространяет PDS one-sigma σP нижней границы и 74 σT узла на P(z), rho(z), массовый столб Σ(z) и молярный столб Nmol(z), в том числе после adaptive subdivision. Для столбов чувствительность плотности интегрируется по высоте; Nmol=Σ/Mbar и потому имеет ту же относительную σ при фиксированной средней молярной массе одного слоя. Расчёт использует явное приближение диагональной ковариации, вложенную квадратуру и проверку согласованности с инвентарями Core. Он не распространяет uncertainty на состав или гравитацию: масса/радиус тела, гармоники GGM50A02, EOS и rate constants также остаются вне оценки. Промежуточные PDS σP не добавляются как независимые boundary conditions. Профиль не подключён автоматически к Scheduler-химии; отсутствующие радикалы и кинетические параметры не выводятся из P/T. Источник и ограничения: `docs/science/DATA_PROVENANCE.md`, раздел Stage 4.2 / MGS Mars.

### 6.7 Измерения состава SAM и ограничения радикала HO2

Отдельный набор `Data/marsAtmosphericChemistry.ts` хранит опубликованные средние SAM для Gale Crater: CO2 0.951±0.003, N2 0.0259±0.0006, 40Ar 0.0194±0.0004, O2 0.00161±0.00009 и CO 0.00058±0.00008 (Trainer et al. 2019, DOI 10.1029/2019JE006175). Пять средних суммируются до 0.99849, поэтому набор маркируется как неполный; остаток 0.00151 не идентифицируется и не нормируется. Это near-surface данные за MY31–MY34, а не вертикальный профиль.

HO2 хранится двумя раздельными записями по Alday et al. 2024 (DOI 10.1093/mnras/stae1814): ACS MIR observations дают отсутствие уверенного обнаружения и 5σ upper limits около 15 ppbv на 10 км и 100 ppbv на 40 км (200 occultations, MY36–MY37); OpenMARS содержит модельные dusty-season интервалы MY35 — 1–2 ppbv на 0–20 км и 4–5 ppbv на 40–50 км. Верхние пределы не являются положительными измеренными концентрациями; модельные оценки не считаются наблюдениями. Ни SAM, ни ACS, ни OpenMARS не объединяются с одиночной MGS-колонкой 1998 года в общий синхронный профиль и не загружаются как начальные запасы Scheduler-химии.

Контракты импортированных данных проверяют полноту SAM-суммы и сохраняют разницу между incomplete composition, observational upper limit и modelled range. Реализация и ограничения: `src/modules/Data/marsAtmosphericChemistry.ts`, `src/modules/Tests/marsAtmosphericChemistry.test.ts`, `docs/science/DATA_PROVENANCE.md` §2.31.



### 6.8 Верхняя атмосфера Марса: MAVEN IUVS/NGIMS

`Data/mavenUpperAtmosphereEvidence.ts` содержит publication reference records IUVS, L2 neutral abundance parser, L3 resampled density parser, PDS4 detached-label gate, profile builders и exact co-registration. Реальные исходные файлы L2 и L3 для MAVEN TID 14282 / orbit 391 заморожены в `src/modules/Data/mavenNgimsL2Archive/` и `src/modules/Data/mavenNgimsArchive/`; подробная byte-level provenance, версии, quality counts и ограничения приведены в `docs/science/DATA_PROVENANCE.md` §§2.32, 2.37.

**L2 csn-abund TID 14282.** Заморожен оригинальный продукт `mvn_ngi_l2_csn-abund-14282_20141211T154406_v08_r01.csv` (2,796 строк; orbit 391; focus mode csn). Raw species counts — по 699 строк Ar, CO₂, He и N₂. Raw quality flags: IU 574, IV 464, OU 228, OV 478, UR 706, неизвестный I0 346. Числовой gate исключает abundance sentinel −999 (905 строк) и нулевые abundance (327 строк); precision sentinel −999 встречается в 687 строках. После numeric gate остаётся 1,564 строк, после quality gate — 987 профиль-кандидатов. CSV reader сохраняет rawRecord, исходные заголовки, aliases, UTC tokens, record number и per-row validation. `t_utc` без Z трактуется как UTC по PDS-контракту. Quality IV/OV — verified, IU/OU — uncertain только с явным opt-in; UR и I0 не принимаются как detections. Source aliases `t_sclk_cor` и `cps_dt_bkd` нормализуются только на границе parser.

Profile builder требует explicit species, orbit, TID, focus mode, inbound/outbound direction и quality class. Реальные inbound кандидаты: He/IV — 271 точка (152.9765–392.3028 km); CO₂/IU — 134 точки sensitivity-only (152.9765–207.825 km); Ar/IV — 118 точек (152.9765–195.5565 km). N₂ не имеет допустимого профиля из-за неизвестного I0/UR. В официальном годовом L2 архиве 2014 найден один abundance product для этого TID/time (csn-abund); filename-level scan не обнаружил ни одного cso-abund продукта во всём 2014 annual archive. Это ограничение конкретного архивного года, не всей миссии.

**Exact multi-species co-registration.** `coRegisterMavenNgimsNeutralProfileSet()` выполняет exact intersection по normalized UTC timestamp + altitude для двух и более profile builders после проверки общего orbit/TID/focus/direction, distinct species и отсутствия duplicate keys. Для TID 14282 найдены 134 пары He/IV ↔ CO₂/IU; точное трёхвидовое пересечение He/IV + CO₂/IU + Ar/IV содержит 118 узлов. В каждой строке сохранены отдельные measurement objects, IV/IU flags и per-row relative 1σ precision; 16 CO₂ узлов не имеют точного Ar совпадения, 153 He узла не входят в общее тройное пересечение. Никакой интерполяции, nearest-neighbour, tolerance, averaging или quality promotion нет. Это ограниченная верхнеатмосферная выборка, не полный профиль атмосферы; результат не допускается к Scheduler initial abundance или Mars photochemical initial state.

**L2 PDS4 provenance.** Отдельный importer сверяет PDS4 root/namespace, структуру Identification_Area/File_Area_Observational/File, ожидаемые URN и filename, file_size в byte, optional MD5 и SHA-256 exact CSV bytes. Фактический CSV имеет 538,939 bytes, label заявляет 539,063 (+124); Header.object_length=124 и Table_Delimited.object_length совпадает с полным CSV. MD5 отсутствует. Поэтому обычный импорт отвергается, а явный forensic opt-in сохраняет исходные байты и помечает несоответствие, не исправляя содержимое. XML label не аутентифицируется независимо.

**L3 res-den.** Реальный PDS4 CSV содержит 208 строк и заморожен вместе с detached XML. Label file_size превышает CSV на 85 bytes; Header.object_length=85, Table_Delimited.object_length совпадает с полным payload; MD5 отсутствует. PDS4 importer валидирует root/namespace/structure, URN/filename и byte size; mismatch доступен только как forensic-only result. Поля `density_bins` сохраняются как raw bin coordinates. Линейные cm⁻³/m⁻³ не выдаются до разрешения конфликта между log-bin описанием SIS и unit annotation Table A-9. L3 не является raw L2 profile.

**L3 res-sht derived scale-height temperature.** Для того же TID/orbit заморожен продукт `mvn_ngi_l3_res-sht-14282_20141211T154406_v06_r01.csv` (4 исходных rows; 2 принятых fit rows). Ar/HI: scale height 6.765265 ± 1.794577 km, derived temperature 108.170861 ± 28.693767 K; CO₂/HI: 5.720616 ± 1.398231 km, 100.614597 ± 24.592182 K. Обе оценки относятся к exobase altitude 464.9283 km и времени 2014-12-11T17:04:37Z. N₂ не проходит fit-quality gate, He имеет NA. Температура выведена из species-specific scale-height fit между homopause и exobase; это не локальное T(z), не общий атмосферный термостат и не непрерывный профиль P(z)/T(z). Timestamp не совпадает с началом пригодных L2 abundance rows (17:06:03Z), поэтому точечная L2–SHT fusion не выполняется. Label file_size превышает CSV на 141 byte; Header.object_length=141; Table_Delimited.object_length совпадает с payload; MD5 отсутствует. PDS4 importer допускает mismatch только в forensic mode и сохраняет hash/layout provenance.

IUVS NO reference описывает девять последовательных наблюдений 6–8 апреля 2016 (MY33) и retrieval 80–128 km с шагом 8 km. Численные density значения статьи не табулированы и не оцифровываются из рисунка. IUVS [O]/[CO2] ratios на 130 km (MY32/MY33) — модельно-ограниченные значения после scaling, не прямые in-situ density.

Данные этих двух MAVEN продуктов не объединяются автоматически с MGS 1998, SAM Gale, ACS HO2 или OpenMARS в единый синхронный вертикальный профиль. Не хватает наблюдаемых O/NO/NO2/H/HO2, полного совместимого T(z)/P(z), vertical transport/diffusion и обоснованных химических граничных условий/скоростей. Ничего не загружается как Scheduler initial state. Stage 4.2 остаётся OPEN / NOT_READY.

**CI и научная готовность — разные статусы.** Для текущего PR HEAD `185ca962ad32118abf996d0a6e9bf216613fda04` commit-triggered run [45679361722](https://github.com/Mrcoolzbs-ai/evowars/actions/runs/45679361722) завершился успешно: TypeScript, Vitest (3 368 passed / 53 skipped), lint (62 warnings / 0 errors) и production build. Это подтверждает работоспособность проверяемой сборки и тестов, но не закрывает отсутствующую калибровку NGIMS, семантику L3 density bins или требования к полному синхронному атмосферному состоянию. Stage 4.2 остаётся **OPEN / NOT_READY**.


### 6.9 Source-backed photolysis reference values for Mars

The data module `Data/marsPhotochemistryEvidence.ts` preserves the nine inorganic photolysis channels listed in Taysum & Palmer (2020), Appendix Table B2 (DOI 10.1029/2020JE006491), with published frequencies J [s⁻¹] at exactly 0.50 km and 42.67 km. The table scenario is SZA=0° and Ls=251°; the source's Mars-adapted TUV look-up also depends on temperature, O3 and total atmospheric columns, Sun–Mars distance and optical/dust opacity. These are model lookup values, not observations or universal constants. Although the paper's method text says ten inorganic photolysis reactions, the accessible B2 table lists nine; the implementation imports the nine tabulated rows only.

`evaluateMarsPhotolysisAtReferenceNode()` calculates J × n(parent) and tabulated net stoichiometric rates only at those exact two nodes, using an explicit caller-supplied local reactant density and its provenance. It rejects off-grid altitudes, unknown reactions, invalid densities and missing provenance; no interpolation or extrapolation is performed. Because the source table provides no 1σ for J, rate uncertainty remains not quantified. The result is a diagnostic/model-reference calculation only and is not Scheduler-eligible. It does not form a complete photochemical network or create radical inventories.

### 6.10 Mars gas-phase reaction evidence and rate evaluation

`Data/marsGasPhaseKinetics.ts` preserves the 32 gas-phase reaction records in Taysum & Palmer (2020), Appendix Table B1 (DOI 10.1029/2020JE006491). The records carry typed stoichiometry and per-reaction rate provenance. Twenty-nine direct expressions are executable with an explicit local concentration vector; the two `k_3rd` fall-off rows c11/c17 remain unevaluated until the CO2 efficiency convention is resolved, and e1 is evaluable only at its single published temperature of 298 K. All 32 stoichiometries are atom-balanced.

Mars termolecular reactions use CO2 as the bath gas. The Table B1 efficiency multiplier (2.075 for a1, 2.5 for other direct termolecular rows) is included in the stored pre-exponential A; the caller must separately supply local CO2 number density. It is never inferred from pressure or a partial composition. The table gives no formal T validity intervals or numerical 1σ rate uncertainties; these remain unreported. This is a data/evaluation layer only, not a complete chemical network or Scheduler-connected atmospheric simulation.

### 6.11 Coupled local Mars photochemical ODE step

`ChemicalEvolution/marsPhotochemicalNetwork.ts` exposes `buildMarsPhotochemicalNetworkProblem()` and `runMarsPhotochemicalConcentrationStep()`. The adapter couples explicitly selected Taysum & Palmer (2020) Table B1 gas-phase reactions with Table B2 photolysis channels in a 16-species state (particles cm⁻³), at one explicit temperature, one exact photolysis altitude node, and one physical dt in seconds. All initial species concentrations, temperature, and their provenance are mandatory; no omitted state field is interpreted as zero.

The local termolecular bath gas is the current dynamic CO₂ concentration; the existing KIDA N₂ mechanism is not reused. The built problem has an analytical Jacobian, non-negative state indices and C/H/O linear invariants, and is solved by the existing Radau IIA backend. Unsupported fall-off reactions c11/c17, e1 except at 298 K, and all off-grid photolysis altitudes fail closed. A solver error returns no partial state.

This is a single homogeneous compartment only. It is not connected to Scheduler/GeneratedWorld, does not synthesize an initial atmosphere, and does not model vertical transport, boundary fluxes, or time-dependent radiative/meteorological forcing. The photolysis forcing remains SZA=0°, Ls=251°; no uncertainty is quantified for the imported table rates.

### 6.12 Mars inorganic photochemical mechanism reference

`Data/marsGasPhaseKinetics.ts` preserves all 32 gas-phase rows from Taysum & Palmer (2020) Table B1: 29 explicit Arrhenius expressions, two unresolved fall-off rows (c11/c17), and e1 as a single measured/reported rate point at exactly 298 K. The 29 explicit expressions include 24 bimolecular reactions and five termolecular reactions that require an explicit local CO2 bath-gas density. No conversion from pressure or column inventory to local number density is implicit. All reactions are checked for C/H/O stoichiometric balance.

`Data/marsPhotochemistryEvidence.ts` preserves the nine visible Table B2 photolysis channels at exactly 0.50 km and 42.67 km, for the stated reference scenario SZA=0° and Ls=251°. `ChemicalEvolution/marsPhotochemicalNetwork.ts` builds and integrates an explicitly selected subset in a 16-species single-compartment ODE using analytical Jacobian, C/H/O invariants, non-negativity checks and Radau IIA. It requires caller-supplied temperature, all 16 initial local number densities and provenance. The gas-phase model can use up to 30 executable rows (29 Arrhenius plus e1 at 298 K) with the nine tabulated photolysis channels; c11/c17 remain blocked. No vertical interpolation of J, time-varying radiation, vertical transport, surface coupling, column-to-volume conversion, or Scheduler/GeneratedWorld mutation is performed. This is a reference chemistry component, not a complete observation-constrained Mars atmosphere.

### 6.13 Generator MGS 1998 Mars temperature reference

The Generator can explicitly attach `mgs_mars_1998_8028d38a` only with the `mars` atmosphere preset and a planetary body. `Core/atmosphericReferenceAdapters.ts` converts the 74 MGS PDS temperature nodes into 73 contiguous finite-altitude intervals, each with a representative midpoint temperature estimated by linear interpolation between adjacent measured nodes. The profile status is `partial_profile`, its provenance keeps the two source row IDs and endpoint σT values, and no interpolation is done outside the observed range (~0.25–35.26 km). The node errors are not collapsed into layer uncertainties because their covariance is not available.

The MGS selection is a temperature-only reference attachment. It does not replace generated body mass/radius/gravity or the separate Mars preset composition/pressure; it does not invent a full pressure/composition profile, radical inventories, reaction selection or `physicalKinetics`. The existing strict `importSourcedAtmosphericTemperatureProfileForKinetics()` can convert the 73 temperature/geometry intervals into kinetic-layer seeds, but species inventories and reactions remain caller-supplied. One occultation is not global/seasonal Mars climatology.

### 6.14 Архив NGIMS: покрытие и метаданные селектора

На странице PDS NGIMS указано, что архив наблюдений на момент документированного среза охватывает данные по 15 февраля 2025 года (Ls 44.2, MY 38; миссия продолжается). В годовом каталоге за 2025 год перечислено 308 МБ abundance-продуктов. Селектор Single-Species `MAVEN_NGIMS_Single-Species_del1-43.csv` имеет размер 6,6 МБ и дату изменения 19 декабря 2025 года; это дата ревизии файла индекса, а не дата последнего наблюдения. Связанный файл `.htm` размером 62 байта не является читаемой HTML-таблицей. Содержимое CSV-индекса теперь загружено и обработано вместе с индексами L3 res-den и L3 res-sht; это каталоги выбора продуктов, а не измерительный L2 abundance CSV. Точная логика связки и ограничения описаны в §6.17. Индексный аудит не означает, что весь архив продуктов импортирован или что все перечисленные записи являются наблюдениями пригодного качества.

### 6.15 MAVEN NGIMS L1B: измерительный сигнал и пределы калибровки

Для TID 14282 / orbit 391 отдельно заморожен официальный PDS4 L1B-продукт `mvn_ngi_l1b_osnb-14282_20141211T154406_v09_r01.csv` с detached XML. Событие относится к окну 2014-12-11T15:45:25Z–17:29:43Z; строки L1B охватывают 17:03:58.937Z–17:27:14.447Z. CSV содержит 39 999 строк: 22 579 CSN и 17 420 OSNB. Оба focus mode остаются раздельными. Reader проверяет 36-колоночную схему Table A-6, сохраняет исходные поля и поддерживает строгую выборку по TID, орбите, focus mode, UTC-окну и m/z.

CSV имеет 14 600 292 байта, detached label заявляет 14 603 490 байт (+3 198); MD5 отсутствует. Исходные байты не исправляются; импорт допускается только в forensic-режиме с сохранением SHA-256 и диагностики структуры. SHA-256 сам по себе не доказывает независимую подлинность архива или label.

L1B содержит counts/CPS и инструментальные контекстные поля, а не концентрации нейтральных частиц. Reader не выводит вид вещества из m/z, не переводит CPS в число частиц/см³, не объединяет CSN и OSNB и не создаёт Scheduler initial state. m/z 16 и 30 — кандидатные сигналы, а не обнаружения O/NO. Флаги TSC/TSU относятся к коррекции времени SCLK и не эквивалентны научным quality flags IV/IU/OV/OU/UR из L2.

**Калибровка остаётся блокером.** NGIMS SIS Rev. 1.13 описывает open-source sensitivity через closed-source reference sensitivity, отношение response open/closed и energy correction factor `C_EN`. L1B signal не предоставляет полной flight-specific response/fragmentation matrix и численного `C_EN`; CPS-to-density conversion не реализован. Усреднение всего файла не считается измерением sensitivity. Stage 4.2 остаётся OPEN / NOT_READY.

### 6.16 MAVEN NGIMS: временные фазы, housekeeping и калибровочная готовность

Для TID 14282 / orbit 391 сохранён event-matched `cal-mkr` продукт: 88 строк содержат один TIDSTART, один TIDSTOP и 15 пар интервалов «Phase mass scans starting» / «Phase ended». Временная шкала остаётся в исходных SCLK seconds. Парсер не переводит SCLK в UTC, не связывает часы marker/HK с исправленным временем L1B `t_sclk_cor` и не присоединяет marker к строкам abundance. Это временная разметка протокола прибора, а не калиброванная модель экспозиции масс-каналов.

Для event `cal-hk` определение SIS трактует `MKID` как ID последнего marker, наступившего к моменту `TIME`. Поэтому сопоставление HK со стартовой фазой выполняется только при точном равенстве `HK.MKID` ID marker «Phase mass scans starting»; строки с phase-end ID сохраняются как post-phase context, прочие и пустые ID остаются неназначенными. Временное сопоставление, UTC conversion, nearest-neighbour, interpolation и carry-forward не применяются. Пустая ячейка означает отсутствие наблюдения, а не ноль. Сводка event HK строится потоковым анализом 88 639 строк; телеметрия используется как операционный контекст, а не как концентрация, sensitivity или полное начальное состояние химии.

В калибровочных reference-данных импортированы pre-flight ground sensitivities для 40Ar/84Kr из SIS Table 3 с явной областью применимости «наземная предкалибровка». Записаны SIS `C_RF` (0.71 при m/z ≤20.5 и 1.0 выше) и ограниченные справочные данные dead-time для CEM 1; коэффициенты CEM 2 остаются неизвестными. Коррекция не применяется повторно к L1B `CPS_DT`/`CPS_DT_BKGD`, уже содержащим dead-time correction. Результат Stone et al. (2018) для N₂ m/z14/m/z28 — 3.47 ± 0.42% по шести calibration-gas измерениям — сохраняется только как N₂-специфичная характеристика; factor 1.5331 для gain stabilization относится к орбитам после 748 и не применяется к orbit 391.

TID 14282 датирован 11 декабря 2014 года и относится к ранней конфигурации прибора. Публикации описывают изменение настроек после ранней миссии и загрязнение отдельных каналов; событие требует ручной проверки. Фактические sparse readbacks `QMS:MT_MU1_VCTL = -45.0 V` и `QMS:MT_MU2_VCTL = -2437.6 V` не отождествляются с опубликованным словесным описанием настроек 125/25 V: связь этих обозначений документально не установлена.

Предкалибровочные HK-продукты TID 10191 (991 617 строк; 324 столбца; 360 172 138 bytes) и TID 10194 (355 082 строк; 324 столбца; 128 894 809 bytes) проверены по PDS4 schema/record counts. `CDH:BA_PRES` и `CDH:BA_PRES_LO` — разреженные readbacks в вольтах, не давление; они встречаются примерно в 0.734% строк. Каналы `CDH:THPRES` и `FSW:THERM_PRESS` оставлены неинтерпретированными. HK строки связываются с последним предшествующим marker в raw SCLK порядке только при точном совпадении MKID; несовпадения не переназначаются соседнему событию. Поле/канал клапана резервуара не установлен.

Ключевой отсутствующий источник — внешний stable ion gauge, которым, согласно описанию процедуры, измерялось давление при наземной статической калибровке; сам набор PDS NGIMS не содержит его серию, сертификат/диапазон и синхронизацию с интервалами спектрального измерения. Также остаётся расхождение: SIS обозначает TID 10191 как Argon, а имя message-log каталога содержит `KrCalibration`; спектральные признаки больше согласуются с Ar, но конфликт хранится как ручной флаг. Без внешнего pressure reference, подтверждённой reference-gas density, valve-open interval, CEM 2 dead-time и полного response matrix нельзя вывести absolute sensitivity или `C_EN` и нельзя делать CPS-to-density conversion. Stage 4.2 остаётся OPEN / NOT_READY; импортированные MAVEN данные не подключены к Scheduler initial state.

### 6.17 Официальные индексы MAVEN NGIMS L2/L3: обнаружение и точная связь продуктов

Загружены три официальных PDS selection-index CSV: L2 Single-Species
`MAVEN_NGIMS_Single-Species_del1-43.csv` (6 906 311 bytes), L3 res-den
`Maven_NGIMS_Altitude-Resampled_del 1-40.csv` (2 236 799 bytes) и L3
res-sht `MAVEN_NGIMS_Scale-Height&Temp_del1-42.csv` (3 257 701 bytes).
Все три загрузки завершились HTTP 200. Эти файлы — индексы выбора продуктов,
а не таблицы измерений.

Аудит извлёк 59 816 индексных записей: L2 csn-abund — 16 945, L2 ion-abund —
15 632, L3 res-den — 11 090, L3 res-sht — 16 149. Это число записей в
selection indexes, не число наблюдений или валидных измерений. В индексе
L2 Single-Species нет записи cso-abund; вывод ограничен этим индексом и не
доказывает миссионное отсутствие всех соответствующих продуктов.

Ключ связи — строго `(TID, product timestamp из PDS URN)`. Кандидат принимается,
только если для каждой роли существует один distinct URN, а все три записи
имеют идентичные UTC start/stop windows. Nearest-neighbour, допуск по времени,
интерполяция и геометрическое сопоставление не используются. Первичный аудит
обнаружил 180 повторных ссылок L3 res-den, присутствовавших в двух каталогах.
Один и тот же URN с идентичными метаданными учитывается как один продукт с
двумя источниками каталога; числовые altitude и solar-longitude сравниваются
как точные decimal values. Разные URN или различающиеся метаданные приводят
к fail-closed конфликту. Итог: 17 020 distinct event keys, 10 796 полных
L2-CSN + L3-res-den + L3-res-sht triples, 180 схлопнутых повторных ссылок и
ноль неразрешённых duplicate join keys. Это связи на уровне индексов; они
не доказывают совпадение временных/высотных строк и научную пригодность.

**TID 14282 / orbit 391.** Три точные PDS identity:
- L2 CSN abundance: `urn:nasa:pds:maven_ngims:l2:mvn_ngi_l2_csn-abund-14282_20141211t154406`;
- L3 resampled density: `urn:nasa:pds:maven_ngims:l3:mvn_ngi_l3_res-den-14282_20141211t154406`;
- L3 scale-height temperature: `urn:nasa:pds:maven_ngims:l3:mvn_ngi_l3_res-sht-14282_20141211t154406`.

Индексные записи задают общее окно 2014-12-11 15:45:25–17:29:43 UTC,
altitude 152.981 km, signed solar longitude −110.209° и MY 32. При этом
closest-approach metadata расходится: L2 сообщает 16:37:34 UTC, оба L3 —
17:15:29 UTC. Эти значения сохраняются раздельно; closest approach не является
ключом связи и не усредняется.

Связанные измерительные продукты имеют дополнительные блокеры:
- **L2 csn-abund:** 538 939 CSV bytes, detached label заявляет 539 063 (+124);
  MD5 отсутствует. Из 2 796 строк 1 564 проходят numeric abundance/precision
  gate, 987 остаются profile candidates после quality classification.
  N₂ с неизвестным I0/UR не повышается до detection.
- **L3 res-den:** 23 658 CSV bytes, label заявляет 23 743 (+85), MD5 отсутствует.
  В 208 строках `density_bins` сохраняется как raw coordinate: преобразование
  в линейные cm⁻³/m⁻³ заблокировано неразрешённым противоречием между log-bin
  описанием SIS и единицами Table A-9.
- **L3 res-sht:** 702 CSV bytes, label заявляет 843 (+141), MD5 отсутствует.
  Из четырёх строк приняты два HI fit: Ar 108.170861 ± 28.693767 K и CO₂
  100.614597 ± 24.592182 K, оба на exobase altitude 464.9283 km. Это
  видоспецифичные температуры, выведенные из scale-height fits, а не
  локальные измерения T(z).

У всех трёх detached labels есть file-size mismatch и отсутствует MD5.
Исходные байты сохраняются, labels не аутентифицированы независимо, PDS4
импорт разрешён только в forensic-only режиме. Временное покрытие строк также
не совпадает: L2 — 17:06:03–17:22:54 UTC, L3 res-den — 17:04:27–17:15:31 UTC,
два принятых L3 res-sht fit имеют timestamp 17:04:37 UTC.

Замороженный результат: `src/modules/Data/mavenNgimsIndexBundleAudit/product-index-audit.json`;
воспроизводимый аудит: `scripts/science/audit-ngims-product-indexes.py`.
TypeScript-контракт `linkMavenNgimsL2L3IndexProductSet()` проверяет три роли,
точные TID/product-time и одинаковые index windows, сохраняя исходные
closest-approach metadata. Ни индексная связь, ни TypeScript link не допускаются
к Scheduler или Mars photochemical initial-state construction.

Это закрывает только задачу обнаружения и cross-link продуктов. Не решены
NGIMS sensitivity calibration, семантика L3 density bins, отсутствующие виды и
quality, общий row-level vertical coverage и отсутствие полного проверенного
T(z)/P(z)/transport/chemistry initial state. Stage 4.2 остаётся
**OPEN / NOT_READY**. Подробная byte-level provenance приведена в
`docs/science/DATA_PROVENANCE.md` §2.38.

## 7. Химия и эволюция

### 7.1 Инвентари и стехиометрия

Химический движок ведёт инвентарь веществ в резервуарах. Реакция описывается стехиометрией и проверяется на баланс каждого элемента. При выполнении шага определяется лимитирующий реагент; отрицательные количества не допускаются. Перенос вещества между резервуарами сохраняет общее количество.

В legacy-режиме A степень превращения за шаг (`extentFraction`) — игровое правило, а не физическая кинетическая константа. Параметр `gameSpeedCoefficient` не должен интерпретироваться как научно измеренная скорость реакции.

### 7.2 Термодинамика и равновесие

Научное ядро содержит каталог термодинамических данных, per-value provenance и вычислитель `thermoFunctions.ts` для двух поддерживаемых форм NASA-7: `nasa_cea` и `nasa7_classic`. Он вычисляет Cp°, H°, S° и G° только в диапазонах сегментов; выход за диапазон, повреждённые коэффициенты или отсутствие параметризации приводят к явной ошибке. Каталог NASA Glenn CEA содержит 20 газовых веществ. Вычислитель не заполняет автоматически отсутствующие справочные поля S°/ΔfG° в записях и не подменяет неизвестные величины нулями.

Вычислитель равновесия идеального газа `solveEquilibrium` минимизирует энергию Гиббса при ограничениях сохранения элементов и заряда, используя метод элементных потенциалов (RAND), редукцию зависимых строк баланса и ньютоновский решатель с линейным поиском. Проверены эталонные задачи NH₃ и водогазового сдвига при стандартном давлении 1 бар. Отдельный `solveReactiveGasEquilibriumWithPengRobinson` поддерживает ограниченную однофазную vapor-постановку по явно переданным PR/BIP-параметрам; он не меняет идеальногазовый API и не выдаёт локальный стационарный результат за доказанный глобальный минимум.

Стандартное давление и диапазоны сегментов каталога являются частью контракта. Несовместимое стандартное состояние, неполное покрытие коэффициентов бинарного взаимодействия или выход за диапазон должны приводить к диагностике/отказу, а не к молчаливой подстановке.

### 7.3 Кинетика

Контракты кинетики описывают класс реакции, закон скорости, тип концентрации, единицы констант, температурный диапазон, неопределённость и provenance. Реализованы вычисление поддерживаемых форм (k(T)), включая модифицированный Аррениус и отдельные fall-off-модели, а также базовый плотный ODE-решатель Radau IIA.

Фактическая применимость ограничена данными и размерностью решателя. Полный каталог атмосферных/астрохимических реакций JPL/KIDA, большая связанная реакционная сеть и всеобъемлющая интеграция этих механизмов не подразумеваются.

### 7.4 Физический кинетический эксперимент и вертикальная физика

По состоянию на 25.11.2026 в расширенной ветке PR #1 реализован ограниченный физический путь Scheduler, отделённый от legacy-режима A. Для поддерживаемых конфигураций используются отдельные атмосферные слои, столбовые и послойные запасы, явные species/provenance и ограниченный механизм с реакционными записями #89 и #106. Отсутствующие виды, неподтверждённое происхождение, неподходящая температура или превышение доступного инвентаря приводят к fail-closed отказу. Это не полная фотохимическая сеть и не автоматическое продолжение любого сгенерированного мира.

`Core/odeSolver.ts` содержит плотный Radau IIA (3 стадии, порядок 5, L-stable) с адаптивным шагом, Ньютоном, плотным LU, аналитическим или численным якобианом, покомпонентным `atol` и контрольными `tEval`. Проверены Robertson reference case и сохранение линейного инварианта; неотрицательность не обеспечивается молчаливым clipping. Размерность состояния ограничена плотным решателем; BDF, разреженные и DAE-решатели не заявляются.

**Вертикальный эталон USSA 1976.** `createUssa1976HydrostaticColumnInput()` задаёт отдельный эталон сухого воздуха Земли: семь исходных слоёв, явный состав, давление 101325 Па и геометрию эталонной Земли. `computeUssa1976ReferenceHydrostaticColumn()` рассчитывает P(z), T(z), rho(z), среднюю молярную массу, g(z), масштаб высоты и массовый/молярный столбы. Геопотенциальный lapse rate интегрируется с корректным преобразованием геопотенциальной высоты в геометрическую. Это reference-input для проверки, а не параметры произвольного `GeneratedWorld` и не модель климата.

Адаптивное вертикальное разбиение повторно интегрирует дочерние слои, а не интерполирует давление из исходной сетки; контролируются изменения ln(P), T/T и P/T, сохраняется сумма подстолбовых инвентарей. Проверки USSA подтверждают снижение несогласованности N₂-инвентаря до заданного допуска 2% на дочерних ячейках. Реакция #89 запускается только в диапазоне и слоях, где её температурная применимость подтверждена; положительные тестовые радикальные запасы явно синтетические.

**Перенос вещества.** Для выбранных видов доступны опциональные eddy-transport через caller-supplied Kzz, молекулярная диффузия, barodiffusion/thermal diffusion и сухое конвективное tracer mixing. Молекулярные Dᵢⱼ рассчитываются Chapman–Enskog + Neufeld при наличии явных Lennard–Jones параметров и локальных P/T; смесь использует effective-binary trace approximation для xᵢ ≤ 1%, а не полную Stefan–Maxwell систему. Сухая конвекция использует диагностику N² и добавляет Kconv только для выбранных trace species. Отсутствие физических параметров или provenance блокирует запуск. Transport и химия выполняются одним атомарным Scheduler commit с откатом всей транзакции при ошибке, но последовательно (Lie splitting), а не как единая связанная система.

Границы остаются существенными: Kzz, Lennard–Jones и mixing-length параметры в проверочных конфигурациях могут быть синтетическими/некалиброванными; N₂/O₂ не переносятся этими tracer-операторами; нет конвективного теплового потока, перестройки T(z), влажной конвекции, облачности, полноценной Stefan–Maxwell модели, полной фотохимии и replenishment. Реальные марсианские наблюдения не образуют полного синхронного T(z)/P(z)/species initial state для Scheduler. Поэтому Stage 4.2 остаётся **OPEN / NOT_READY**, несмотря на реализованные ограниченные физические операторы и эталонные интеграционные тесты.

Legacy-сценарии и golden baseline режима A должны оставаться воспроизводимыми. Источники и стоки без численных скоростей и валидированного решателя остаются выключенными.

## 8. Научное ядро и временная модель

Модуль `Core` предоставляет типизированные физические величины и размерности, научные значения с provenance, виды и элементы, термодинамику, равновесие и кинетику, резервуары, журналы потоков и реакций, каноническое состояние мира, часы, реестр процессов, планировщик, аудит инвариантов и контракты численных решателей. Каталог `ChemicalElement` отделён от каталога `ScientificSpecies`: элемент имеет атомный номер и символ, а вид ссылается на элементы через `ElementCounts`.

`CoreWorldState` — опциональное поле `GeneratedWorld`; его отсутствие означает «научное ядро не инициализировано», а не нулевое состояние. Интеграция не заменяет автоматически legacy-пути: генератор, legacy-химия, атмосфера и связанные UI-сценарии продолжают использовать прежние контракты. Научное ядро и Scheduler доступны для явных физических сценариев, но UI ещё не переведён целиком на канонический `CoreWorldState`.

Время организовано двумя уровнями:
- космологический возраст/эпоха — характеристика контекста мира;
- локальное модельное время — время продвижения физической симуляции.

Продвижение научного состояния выполняется через единый Scheduler. Планировщик поддерживает Lie/Strang splitting, sub-cycling и упорядочивание событий. Для процессов используются сегментированные TimePoint (segmentIndex, localTimeS); exact deadlines не вычисляются через приблизительную elapsed-сумму. Macro-step ограничивается ближайшим solver root, событием или сроком процесса; пропустить наступивший срок нельзя. runScheduledWorldTurn сначала обрабатывает due events по (TimePoint, sequence), затем запускает готовые one-shot процессы и явно перечисленные continuousProcessIds. Ошибка события блокирует запуск процессов текущего хода. Граница (nextSegment, 0) является сменой координатного представления без физического продвижения времени.
 
Для continuous процесса включённая политика respectSelectedProcessDeadlines запрещает пройти через его собственный будущий срок. Ручной запуск физической химии регистрируется как одноразовый exact deadline в текущей точке, если более раннее расписание отсутствует; будущий срок сохраняется, а если он попадает внутрь интервала, шаг останавливается точно на нём. Это не назначает процессу вымышленное постоянное τ. Storage проверяет SchedulerBookkeeping при загрузке и JSON-импорте; отсутствие старого scheduling не превращается в искусственно пустое расписание, а повреждённое состояние не возвращается как валидный мир.

После изменения состояния аудитор проверяет материальные/энергетические балансы и прочие инварианты. Непроверяемый баланс должен иметь статус «не верифицирован», а не автоматически считаться сбалансированным.

## 9. Сохранение и экспорт

Сохранение основано на browser `localStorage`. Поддерживаются история миров, настройки генерации и последний seed. Формат сохранений версионируется; для старых версий применяются явные миграции. Миграция не должна заново генерировать отсутствующие физические поля и не должна превращать неизвестное значение в ноль.

Форматы экспорта:
- **JSON** — полная сериализованная структура мира;
- **Markdown** — человекочитаемый паспорт/проекция поддерживаемых данных.

Экспорт Markdown не является заменой полного сериализованного состояния. Неизвестные и неприменимые значения при сохранении/миграции должны сохранять свою семантику.

## 10. Пользовательский интерфейс

Основные области интерфейса:
- панель генерации (seed, режим, фиксированные категории, генерация одного или трёх миров);
- паспорт мира (краткое описание, seed, режим, научный статус, категории, атмосфера, физические характеристики, причинная цепочка);
- предупреждения совместимости и предложения по интерпретации;
- история сохранённых миров (загрузка, удаление, очистка);
- панель экспорта JSON/Markdown;
- средства ограниченного химического шага/физического кинетического эксперимента и просмотра истории/аудита там, где соответствующая конфигурация доступна.

UI отображает результат и объяснения, но не является источником научной истины: расчёты, статусы и форматирование физически значимых величин принадлежат модулям модели/ядра.

## 11. Нефункциональные требования

- **Детерминизм:** одинаковый seed, версия генератора и настройки дают воспроизводимую генерацию.
- **Типобезопасность:** TypeScript-проверка обязательна для интеграции.
- **Изолируемость:** предметные вычисления и каталоги не должны зависеть от React-компонентов.
- **Мигрируемость:** любое изменение формата сохранений сопровождается схемой/миграцией и регрессионными тестами.
- **Научная прозрачность:** единицы, допущения, источники, область применимости и статусы ошибок доступны для диагностики.
- **Fail-closed:** некорректные, недостающие или неприменимые данные не приводят к скрытому вычислению по нулю или по вымышленной константе.
- **Регрессия:** новые подсистемы не должны ломать PRNG, legacy-режим генерации, сохранения и зафиксированные golden-сценарии.
- **Производительность:** тяжёлые расчёты должны иметь отдельные измеримые бенчмарки; экспериментальный WASM/Rust-путь не считается production-бэкендом без подтверждённого контракта и проверки паритета.

## 12. Текущее состояние реализации на 27.11.2026

Таблица разделяет два разных снимка кода. **main** — текущая основная ветка (MVP/этапы 1–2). **stage-3-planetary-physics** — ветка открытого PR [#1](https://github.com/Mrcoolzbs-ai/evowars/pull/1); её функции не входят в `main`, пока PR не принят.

| Область | Снимок | Статус | Существенные границы |
|---|---|---|---|
| Генерация миров, каталоги, seed, режимы, фиксированные категории и паспорт | `main` | Реализовано | Диапазоны и часть правил являются модельными/игровыми оценками |
| История миров, настройки, локальное сохранение и экспорт | `main` | Реализовано | Данные хранятся в браузере; серверной синхронизации нет |
| Legacy-химический шаг (режим A) | `main` | Реализовано | Степень превращения за шаг — игровое правило, а не физическая кинетика |
| Физика тела, атмосферы, орбиты, энергетики, геологии и фазовый скрининг | PR #1 / Stage 3 | Частично реализовано | Орбитальные диапазоны модельные; геология преимущественно качественная; климатической модели нет |
| MGS Mars `8028D38A.TPS` и гидростатический Core-адаптер | PR #1 / Stage 3 | Reference-адаптер и first-order 1σ postprocessor | Один retrieval-профиль; состав задаётся явно; диагональное приближение ковариации; неопределённости состава/гравитации/тела не рассчитаны; нет автоматического подключения к Scheduler-химии |
| SAM, ACS HO2 и OpenMARS | PR #1 / Stage 3 | Evidence records и проверки coverage | SAM — неполный near-surface состав; ACS — upper limits, не detections; OpenMARS — модельные оценки; источники не образуют общий синхронный профиль |
| MAVEN IUVS/NGIMS L2/L3 | Верхняя атмосфера, publication references, quality-aware readers и exact co-registration | Заморожены L2 csn-abund, L3 res-den и L3 res-sht TID 14282; exact 118-node He–CO₂–Ar row intersection; отдельный аудит официальных L2/L3 product indexes: 59 816 записей, 17 020 event keys, 10 796 точных L2-CSN + L3-res-den + L3-res-sht index triples | Индексные triples — каталоговые связи, не число измеренных профилей и не доказательство row-level overlap. Для TID 14282: только csn-abund; O/NO/NO₂/CO/O₂ отсутствуют, N₂ quality I0/UR не повышается до detection. He/IV 271, CO₂/IU 134, Ar/IV 118. SHT даёт два species-specific derived fit temperatures на 464.9283 km, не local T(z). Labels имеют file_size mismatch и no MD5; исходные байты forensic-only. L3 density-bin conversion unresolved. Нет полного 16-species snapshot, синхронных T(z)/P(z), транспорта и Scheduler initial-state integration |
| MAVEN NGIMS L1B / calibration evidence | Измерительные CPS, marker/HK временная структура и pre-flight calibration evidence | L1B TID 14282 (39 999 строк), 88-row marker log, exact MKID/HK association; SIS ground references и pre-flight TID 10191/10194 HK audit | m/z не определяет вид; CPS не конвертируется в плотность. File-size mismatches требуют forensic-only. Нет flight-specific sensitivity, C_EN, CEM 2 dead-time и внешней ion-gauge series; Stage 4.2 OPEN / NOT_READY |
| Типизированные научные величины, provenance, резервуары, потоки, журналы и состояние мира | PR #1 / Stage 3 | Инфраструктура реализована | Наличие контрактов и инвариантов не означает наличие решателя для каждого физического процесса |
| Часы, Scheduler, события, splitting и аудит | PR #1 / Stage 3 | Инфраструктура реализована | Полная автоматизация всех физических процессов не завершена |
| Термодинамический каталог и вычислитель NASA-7 | PR #1 / Stage 4.3.1–4.3.4 | Частично реализовано | 20 газовых видов NASA Glenn CEA; `thermoFunctions.ts` вычисляет Cp°, H°, S° и G° для форм `nasa_cea` и `nasa7_classic` в опубликованных диапазонах; S°/ΔfG° записи без исходных данных остаются unknown, каталог фаз и веществ ограничен |
| Идеальногазовое химическое равновесие | PR #1 / Stage 4.4 | Реализовано | RAND + ньютоновский решатель с линейным поиском; валидированы балансы элементов/заряда и эталонные NH₃/WGS задачи при 1 бар; конденсированные фазы не входят в постановку |
| Peng–Robinson / VLE / реактивное равновесие | PR #1 / Stage 4.4.4 | Частично реализовано | Есть явный VLE flash и отдельный однофазный PR reactive-gas API при полном покрытии EOS/BIP; автоматического переключения нет; two_phase_candidate не означает stable; непрерывный TPD error bound имеет NO-GO, LLE/конденсированные реактивные фазы и глобальная сертификация не завершены |
| Физическая кинетика, ODE и перенос | PR #1 / Stage 4.2 / 4.5 / 4.8.1 | Частично реализовано | Radau IIA и ограниченные реакции #89/#106; USSA 1976 — эталонная 7-слойная колонка, адаптивное разбиение, опциональные eddy/molecular/barodiffusion/dry-convective tracer operators; часть коэффициентов тестовая/некалиброванная, полный механизм и марсианские Scheduler initial conditions отсутствуют |
| Каталог химических элементов и изотопные кандидаты | PR #1 / Stage 4.3.3 | Реализовано | 118 элементов; CIAAW 2024 weights/compositions; NUBASE2020 — 44 кандидата для 34 элементов, 3 изомерных состояния; категории полноты сохранены, универсальный изотопный состав экзопланет не выводится |\n| Rust/WASM | PR #1 / Stage 3 | Экспериментальный пилот | Бенчмарки и проверка паритета; это не обязательный production runtime |
| Полный климат, динамическая многослойная атмосфера, полная фотохимия, динамическая многотельная модель и полноценная геохимия | PR #1 / расширенная ветка | Не завершено / отдельные прототипы и планы | Наличие эталонной USSA-колонки и ограниченных транспортных операторов не означает готовность климатической или общей атмосферной модели |

**Важно:** подробные разделы 6.6–6.14 и архитектурные модули Stage 3 описывают состояние ветки PR #1. Они не являются перечнем функций, доступных из текущей `main`.

## 13. Критерии приёмки изменений

Изменение считается корректным только при выполнении относящихся к нему критериев:

1. Публичный контракт типов и единиц задокументирован; неизвестные, нулевые и неприменимые значения различаются.
2. Формулы сопровождаются тестами на аналитические/предельные случаи и размерности.
3. Балансы элементов, заряда, массы/вещества и энергии проверяются в пределах явно заданной области аудита.
4. Детерминированные сценарии воспроизводятся; legacy golden baseline не меняется без отдельного обоснования.
5. Ошибка входных данных, выход за диапазон, несходимость и отсутствие данных возвращают раздельные диагностические статусы.
6. Миграции старых сохранений проверены; исходные пользовательские данные не теряются и не «исправляются» выдуманными значениями.
7. TypeScript, тесты, lint и production build проходят в CI.

### Команды проверки

```bash
npm ci
npx tsc -b
npx vitest run
npm run lint
npm run build
```

Для экспериментальных подсистем дополнительно доступны отдельные сценарии benchmark и WASM, описанные в `package.json` и `docs/rust/`.

## 14. Структура исходников

### 14.1 Текущая основная ветка `main`

| Путь | Ответственность |
|---|---|
| `src/App.tsx`, `src/App.css` | React UI, генератор, паспорт мира, история и пользовательские действия |
| `src/types/index.ts` | Доменные типы, настройки генерации, модель мира и статусы |
| `src/modules/Data/` | Каталоги космологий, эпох, центральных объектов, небесных тел, колыбелей, газов и реакций |
| `src/modules/Generator/` | Seed/PRNG и детерминированная сборка мира |
| `src/modules/Atmosphere/` | Атмосферные пресеты, состав и производные характеристики |
| `src/modules/WorldModel/` | Производные характеристики и человекочитаемые описания |
| `src/modules/Compatibility/` | Правила совместимости и предупреждения |
| `src/modules/Storage/` | LocalStorage, история миров, настройки, импорт/экспорт |
| `src/modules/Tests/` | Unit- и regression-тесты текущей реализации |

### 14.2 Дополнения ветки `stage-3-planetary-physics` (открытый PR #1)

Следующие подсистемы и файлы относятся к ветке PR #1 и отсутствуют в текущем снимке `main` до слияния PR:

| Путь | Ответственность |
|---|---|
| `src/types/physics.ts`, `src/modules/Units/` | Типизированные физические величины, статусы достоверности, SI-константы и конвертеры |
| `src/modules/OrbitalMechanics/`, `EnergyBalance/`, `Geology/`, `PhaseEquilibrium/` | Орбитальная механика, энергетический баланс, внутреннее тепло и фазовые состояния |
| `src/modules/ChemicalEvolution/` | Стехиометрия, ограниченная физическая кинетика и локальная марсианская фотохимическая ODE-модель |
| `src/modules/Core/` | Каноническое состояние, provenance, резервуары, потоки, время, Scheduler, аудит, термодинамические функции, равновесие, ODE, гидростатическая колонка и ограниченные транспортные операторы |
| `src/modules/Data/mgsMarsOccultation1998.ts` | 74 строки MGS Mars PDS-профиля с опубликованными неопределённостями |
| `src/modules/Data/marsAtmosphericChemistry.ts` | SAM Gale Crater, ACS/TGO HO2 upper limits и OpenMARS estimates с раздельным provenance |
| `src/modules/Data/thermodynamicCatalog.ts`, `elements.ts`, `elementIsotopeCandidates.ts` | NASA Glenn CEA термодинамический каталог; CIAAW/IUPAC данные 118 элементов; NUBASE2020-кандидаты и их provenance |\n| `src/modules/Data/mavenUpperAtmosphereEvidence.ts`, `mavenNgimsL1bEvidence.ts`, `mavenNgimsL1bCalibrationReference.ts` и связанные frozen archive/evidence modules | MAVEN IUVS, NGIMS L2/L3/L1B readers, PDS4 gates, marker/HK diagnostics и ограниченные calibration references; без CPS-to-density модели |
| `src/modules/Data/marsPhotochemistryEvidence.ts`, `marsGasPhaseKinetics.ts` | Source-backed photolysis и gas-phase kinetics для ограниченного механизма Марса |
| `src/modules/Data/mavenNgimsIndexBundleAudit/`, `scripts/science/audit-ngims-product-indexes.py` | Frozen audit трёх официальных NGIMS selection indexes, exact TID/product-time/window joins, duplicate reconciliation и воспроизводимые проверки; результат не является Scheduler initial state |
| `src/modules/RustSim/`, `rust/`, `scripts/` | Экспериментальный Rust/WASM-пилот и benchmark-инфраструктура |
| `docs/science/`, `docs/rust/`, `docs/research/` | Расширенные инженерные, научные и исследовательские документы ветки PR #1 |

Не следует выводить наличие подсистемы в `main` только из того, что её путь описан в этой спецификации.

## 15. Документы-источники и порядок приоритета

Эта спецификация — краткая точка входа, а не замена подробным инженерным документам. Перечисленные ниже документы находятся в ветке `stage-3-planetary-physics` открытого PR #1; до слияния PR их относительные пути не существуют в `main`. Для деталей следует обращаться к:

- [Научная основа](https://github.com/Mrcoolzbs-ai/evowars/blob/stage-3-planetary-physics/docs/science/SCIENTIFIC_FOUNDATION.md) — принципы моделирования и границы допущений.
- [Полный аудит системы](https://github.com/Mrcoolzbs-ai/evowars/blob/stage-3-planetary-physics/docs/science/CURRENT_SYSTEM_AUDIT.md) — фактическое состояние модулей и известные проблемы.
- [Научное ядро](https://github.com/Mrcoolzbs-ai/evowars/blob/stage-3-planetary-physics/docs/science/CORE_SCIENTIFIC_ENGINE.md) — типы, инварианты, резервуары, потоки, часы и Scheduler.
- [Архитектура физики](https://github.com/Mrcoolzbs-ai/evowars/blob/stage-3-planetary-physics/docs/science/PHYSICS_ARCHITECTURE.md) — объекты, орбиты, температура, недра, атмосфера и климат.
- [Архитектура химии](https://github.com/Mrcoolzbs-ai/evowars/blob/stage-3-planetary-physics/docs/science/CHEMISTRY_ARCHITECTURE.md) — данные веществ, термодинамика, равновесие, кинетика и фазы.\n- [Проект и реализация PR-реактивного равновесия](https://github.com/Mrcoolzbs-ai/evowars/blob/stage-3-planetary-physics/docs/science/PR_REACTIVE_EQUILIBRIUM_DESIGN.md) — контракт `solveReactiveGasEquilibriumWithPengRobinson`, ограничения однофазного vapor API и незакрытые критерии устойчивости.
- [Движок симуляции](https://github.com/Mrcoolzbs-ai/evowars/blob/stage-3-planetary-physics/docs/science/SIMULATION_ENGINE.md) — модель времени, splitting, события и решатели.
- [Происхождение данных](https://github.com/Mrcoolzbs-ai/evowars/blob/stage-3-planetary-physics/docs/science/DATA_PROVENANCE.md) — источники, версии, неопределённость и лицензии, включая MGS `8028D38A.TPS`.
- [Дорожная карта](https://github.com/Mrcoolzbs-ai/evowars/blob/stage-3-planetary-physics/docs/science/IMPLEMENTATION_ROADMAP.md) — поэтапные критерии готовности и текущие незавершённые этапы.
- [План валидации](https://github.com/Mrcoolzbs-ai/evowars/blob/stage-3-planetary-physics/docs/science/VALIDATION_PLAN.md) — уровни тестирования и проверяемые сценарии.
- [Инженерный пилот Rust/WASM](https://github.com/Mrcoolzbs-ai/evowars/blob/stage-3-planetary-physics/docs/rust/RUST_WASM_PILOT.md) — статус экспериментального переноса вычислений.

При расхождении краткого описания с кодом и тестами приоритет имеют фактические контракты исходников и тестов. При расхождении с roadmap статус реализации должен быть уточнён, а не выведен из названия или наличия модуля.

