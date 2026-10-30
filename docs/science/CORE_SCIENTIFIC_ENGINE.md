# CORE_SCIENTIFIC_ENGINE — Научное ядро проекта (Stage 4.1)

> Stage 4.1. Реализация: ветка `stage-3-planetary-physics`, коммиты
> `718bcee` → `890973c` → `8c1a8e0` (CI #23 зелёный: tsc, vitest, oxlint,
> build). Ядро НЕ заменяет легаси-модули этапов 1–3 — оно связано с ними
> явными адаптерами. Легаси-модули (Generator, ChemicalEvolution, Units,
> WorldModel, пресеты) не изменены; PRNG и формат их данных сохранены
> байт-в-байт.
>
> Главный принцип ядра: **неизвестное не подменяется числом**. Отсутствие
> поля означает «неизвестно», а не 0; неприменимое не становится
> неизвестным; отклонённые данные сохраняются для диагностики и не
> используются как корректные.
>
> Ревизия Stage 4.1.1 (2026-10-30): независимый аудит кода 4.1 нашёл 8
> дефектов научной целостности (ISSUE 1–8); все исправлены в рамках этапа
> (коммиты f63c5be → af14dd8 → 25f813e, CI #27 зелёный): convert-корректные
> преобразования массаↆколичество с контролем переполнения, статусная
> семантика аудитов (balanced | imbalanced | approximate | not_verifiable),
> basis-aware элементные/зарядовые балансы, РЕАЛЬНЫЙ перенос энергии в
> applyFlux, временная область аудитов (FluxAuditScope), строгие версии
> схем (MigrationError), изоляция несовместимых сохранений в Storage,
> масштабирование процентов в адаптере (50% → 0.5). Контракты §2.4/2.5/
> 2.9/2.10 и §4 обновлены. Подсчёт тестов исправлен: CI #24 = 442 теста /
> 21 файл (в доках ревизии 4.1 ошибочно указывалось 438); после 4.1.1 —
> 517 тестов, из них ядро — 246.

## 1. Слои ядра (`src/modules/Core/`)

| Файл | Слой | Ответственность |
|---|---|---|
| `physicalQuantity.ts` | Величины | значение + единица + размерность; преобразование единиц; runtime-контроль размерностей; запрет NaN/±Inf |
| `scientificValue.ts` | Семантика данных | статусы known/estimated/unknown/not_applicable/not_implemented/invalid; неопределённость; provenance |
| `species.ts` | Химия (контракт) | формальный элементный состав, заряд, фаза; каталог видов; проверка элементного/зарядового баланса |
| `reservoir.ts` | Вещество и энергия | материальный инвентарь с явным основанием; энергетический инвентарь (запас/мощность/поток раздельно); иммутабельные записи |
| `fluxLedger.ts` | Потоки | внутренние/внешние переносы; rate против integrated; атомарное применение; revert; аудиты сохранения |
| `simulationClock.ts` | Время | сегментированное локальное время; сериализация; космический возраст — отдельно |
| `worldState.ts` | Состояние мира | каноническое состояние: тела, гравитация, излучение, резервуары, потоки, часы; валидация |
| `solverBackend.ts` | Численные методы | контракт решателей без фиктивных методов; probe-проверка заявлений; реестр available/planned |
| `migrations.ts` | Версионирование | версии схем сохранений 1.0→1.1→1.2; реестр наборов данных; детерминированные миграции |
| `adapters.ts` | Мосты | PhysValue/GeneratedWorld → ядро без потери метода, источника и семантики неизвестности |
| `index.ts` | Баррель | публичный вход: `import from '../Core'` |

Зависимости ацикличны: физика общается только через контракты ядра
(правило из CURRENT_SYSTEM_AUDIT §2.8). Ядро не импортирует легаси-модули,
кроме типов `src/types/physics.ts` (чтение, без цикла: types/index.ts
импортирует только тип CoreWorldState из ядра).

## 2. Контракты и их семантика

### 2.1 PhysicalQuantity — величина с размерностью

- Величина = { value: number, unit: string } с вычисленной размерностью
  (SI-основа: m, kg, s, K, mol, A). Составные размерности проверяются
  на этапе выполнения: `кг + Па` — ошибка `incompatible_dimension`,
  а не молчаливый ноль.
- Реестр единиц ASCII (канон для новых вычислений): m/km/cm/mm/AU, kg/g,
  s/min/h/day/yr, K, mol, A, Pa/kPa/MPa/bar/atm, J/kJ, W/kW, W_m2, m2/m3,
  kg_m3/mol_m3/kg_m2/mol_m2, J_kg/J_m3, kg_mol/g_mol, m_s/m_s2/N/g0,
  1/rad/deg. Русские строки легаси («кг», «Па», «Вт/м²») в реестре НЕ
  живут — они переводятся адаптером `legacyUnitToCore` и не становятся
  каноном.
- NaN и ±Inf запрещены конструктором (ошибка `invalid_number`); знак и
  величина свободны (отрицательные массы отклоняются моделью, а не
  реестром).
- Аффинных шкал в реестре нет: преобразования линейны (°C сознательно
  отсутствует — для температур используется K; добавление аффинной шкалы
  потребует отдельного контракта).

### 2.2 ScientificValue — статус вместо «confidence: 0.8»

Discriminated union по `status`. Различия статусов не схлопываются
в один null:

- `known` — известно в рамках явно указанного источника/модели;
- `estimated` — оценено приближённой моделью; **метод обязателен**
  (`estimatedValue` без непустого метода не создаётся);
- `unknown` — неизвестно; не 0 и не значение по умолчанию;
- `not_applicable` — неприменимо в выбранной модели (твёрдая кора
  газового гиганта); не превращается в unknown;
- `not_implemented` — проектируется, но модуль не реализован; оценивать
  нечем, статус не позволяет выдать интерфейс за модель;
- `invalid` — данные есть, но не прошли проверку; сохраняются для
  диагностики, как корректное значение запрещены (`expectQuantity`
  бросает структурированную ошибку вместо молчаливого нуля).

**Неопределённость** (`Uncertainty`) не сводится к качеству источника:
interval / stddev / relative / bounded. Отсутствие uncertainty означает
«неопределённость неизвестна», а не «погрешность 0»; интервал не
объявляется доверительным без явного `interpretation`. При смене единицы
неопределённость пересчитывается и не теряется; неопределимый пересчёт
даёт undefined («неизвестна»), а не null-значение.

**Происхождение** (`DataProvenance`): источник, метод, формула, исходные
параметры (rawInput), применимость, версия модели/набора данных. Пустых
фиктивных значений нет: нет источника — поля отсутствуют.

### 2.3 ScientificSpecies — химический вид как запись

`ScientificSpecies` = { id, formula, elements, charge, phase,
molarMassKgMol | null, molarMassStatus, dataStatus, provenance }.
Модель «запись = вид + фаза»: CO2(g) и CO2(aq) — разные записи каталога
с одной формулой (`findByFormula` возвращает обе). Каталог
(`createSpeciesCatalog`) проверяет дубли. Балансы:

- `elementBalanceCheck` — элементы/заряд сохраняются в реакции
  (неизвестные виды **исключаются явно**, а не считаются нулями —
  результат помечается непроверяемым);
- `chargeBalanceCheck` — заряд сохраняется.

### 2.4 Reservoir — инвентарь с явным основанием

Материальный инвентарь всегда несёт `basis`: amount | mass |
column_amount | column_mass | molar_concentration | mass_concentration |
molar_fraction | mass_fraction | arbitrary_units. Смешение оснований —
ошибка `basis_mismatch`, а не молчаливое сложение. Записи резервуаров
иммутабельны (все операции возвращают новые записи).

Энергетический инвентарь разделяет **запас** (storedJ, Дж), **мощность**
(netPowerW, Вт) и **удельный поток** (fluxW_m2, Вт/м²): Дж ≠ Вт ≠ Вт/м²,
null = «неизвестно» в каждом поле отдельно.

Преобразования между количеством и массой — только явные, через
молярную массу вида (ревизия 4.1.1): `amountToMass` = convert(mol →
kg-основа) ДО умножения, `massToAmount` = convert(г/кг → kg) ДО деления
(дефект 4.1: сырое значение в граммах делилось на кг/моль — 1000 г
давало 1/0.018 вместо 55.5556 моль); молярная масса обязательна и
положительна; переполнение результата — QuantityError 'overflow', а не
±Infinity. Валидация: `validateMaterialInventory` (basis из
INVENTORY_BASES, конечные неотрицательные entries),
`validateEnergyInventory` (storedJ: null = «неизвестно» — допустимо,
NaN или отрицательное значение — ошибка; netPowerW и fluxW_m2 могут
быть отрицательными), `validateReservoirRecord` (id, kind, material,
energy, properties через validateScientificValueShape).

### 2.5 FluxLedger — потоки и аудиты

- Поток: internal_transfer | external_input | external_output;
  предмет: substance | energy; количество: integrated (amount/energyJ)
  или rate (ratePerSecond/powerW). **rate ≠ integrated**: скорость
  применяется только после явной интеграции (`integrateSubstanceRate`,
  `integratePower` с dt > 0), иначе ошибка `rate_not_applicable`.
- Стороны: `EXTERNAL = 'external'` — граница системы; внутренний поток
  не может ссылаться на неё и наоборот (маскировка внешнего переноса
  под внутренний невозможна).
- Применение атомарно и идемпотентно: повторное применение —
  `already_applied`; revert восстанавливает инвентарь и сохраняет
  историю статусов (pending → applied → reverted).
- Применение РЕАЛЬНО переносит величины (ревизия 4.1.1): substance —
  from −amount / to +amount; energy — internal: from −energyJ /
  to +energyJ, external_input: to +energyJ, external_output:
  from −energyJ; revertFlux атомарно возвращает и substance, и energy.
  Отсутствующий материальный инвентарь — `unknown_inventory` (пустой
  инвентарь больше не создаётся молча); несовместимый basis —
  `incompatible_basis`; достаточность запаса проверяется всегда;
  неизвестный запас энергии — `unknown_energy_inventory`; уход
  в отрицательный запас — `insufficient_energy`.
- Аудиты: `auditSubstanceConservation`, `auditElementConservation`,
  `auditChargeConservation`, `auditEnergyConservation` — по паре
  «до/после» с результатом-СТАТУСОМ: ConservationStatus = balanced |
  imbalanced | approximate | not_verifiable; balanced:true допускается
  ТОЛЬКО при полном 'balanced'. Непроверяемость не приравнивается к
  нулю и не считается успехом: неизвестный (null) запас энергии любого
  резервуара, исключённый вид или несмешиваемые основания дают
  not_verifiable; оценочные (estimated) молярные массы — approximate.
- Basis-aware молярная семантика (4.1.1): amount и column_amount —
  точные моль (но между собой НЕ смешиваются); mass/column_mass —
  через молярную массу вида (отсутствует или статус не known/estimated
  → not_verifiable; estimated → approximate); концентрации (нужен
  объём), доли (нужен общий запас) и arbitrary_units (нет калибровки)
  → not_verifiable.
- Временная область аудита: FluxAuditScope { after, upTo, includeUntimed }
  с семантикой after < t <= upTo; потоки без метки времени по умолчанию
  исключены и перечисляются в untimedRecords.
- `auditReservoirFluxes` (4.1.1): пофазовая проверка — ожидаемое Δ
  каждого резервуара по каждому виду и энергии сверяется с фактически
  применёнными потоками; ловит «вещество ушло не туда» при сохранении
  общей суммы (расхождения несут reservoirId).
- `validateFluxLedger`: форма и согласованность записей журнала
  (id, status, kind, subject, time, ссылки на резервуары).
- `totalInventory` отказывается суммировать резервуары со смешанными
  основаниями.

### 2.6 SimulationClock — время без потери точности

Локальное время симуляции хранится сегментированно
(SimulationClockState: segmentIndex, localTimeS, priorSegmentsS,
stepCount, representableStepS). Когда шаг становится непредставим
относительно накопленного времени (|t|·EPSILON), открывается новый
сегмент — «малый шаг при большом elapsed time» не исчезает.
`totalElapsedSeconds` — честная ОЦЕНКА (double-сумма); точное сравнение
моментов — `comparePoints` по паре (segmentIndex, localTimeS).
Шаги только положительные конечные; нулевой/отрицательный/NaN —
`invalid_step`. **Космический возраст — отдельная характеристика мира**
(`CoreWorldState.cosmicAge`), а не поле часов: время симуляции процесса
и возраст Вселенной/системы не смешиваются.

### 2.7 CoreWorldState — каноническое состояние мира

`CoreWorldState` = { schemaVersion ('1.0.0'), worldId, clock, cosmicAge,
bodies, gravity, radiationSources, reservoirs, fluxLedger, legacy,
note }. Ключевое разделение:

- `gravity: Record<bodyId, parentId | null>` — гравитационная иерархия;
- `radiationSources` — источники излучения.

Гравитация не выводится из излучения и наоборот: компактный остаток
может быть гравитационным родителем, не будучи излучателем; свободно
плавающий мир не получает ни родителя, ни фиктивного излучателя.
`validateWorldState` диагностирует: дубли id, битые ссылки (излучение →
тело, резервуар → тело, поток → резервуар), self_parent, циклы
гравитации, некорректные часы, несовпадение версий, пустой worldId.

### 2.8 SolverBackend — контракт без блефа

Поддерживаемые классы задач объявлены явно (ode, dae,
algebraic_equilibrium, linear_system). Backend описывает capabilities
(problemKinds, implementedMethods, adaptiveStep, implicit, stiff,
sparseJacobian, maxStateDimension, deterministic с честной семантикой
bitwise_same_environment | within_tolerance | platform_dependent).
`validateBackendContract` делает probe-вызов: бэкенд, заявивший
метод, который не реализует, отвергается (`unsupported_kind_claim`).
`PlannedBackendDescriptor` обязан иметь ПУСТЫЕ implementedMethods:
планы не выдаются за реализованное. В составе Stage 4.1 поставлен
только честный пустой бэкенд (все solve → not_implemented): решатели
появятся на этапах 4.4–4.5.

### 2.9 migrations — пять разных версий

Разделяются: (1) версия схемы ядра (CORE_WORLD_STATE_SCHEMA_VERSION),
(2) версия набора данных (DatasetDescriptor.version), (3) версия модели
(provenance.modelVersion), (4) версия алгоритма/генератора, (5) версия
сохранения (SavedWorld.version). Цепочка миграций сохранений:
**1.0 → 1.1 → 1.2** (текущая 1.2). Правила:

- миграция детерминирована и идемпотентна на целевой версии (мир 1.2
  не переписывается повторно, история не плодится);
- «нет поля» остаётся «неизвестно»: поля не создаются и не
  пересчитываются задним числом; null не становится 0; provenance
  и легаси-записи истории сохраняются и дополняются;
- отсутствующая версия (undefined) трактуется как легаси 1.0 С ЧЕСТНОЙ
  записью об этом в migration.notes; формат-валидная, но НЕИЗВЕСТНАЯ
  версия ('0.9', '1.3', '2.0') — MigrationError 'unsupported_version',
  а не тихая миграция «как из 1.0» (дефект 4.1); мусорные версии
  ('abc', '2', '') — MigrationError 'invalid_version'; оригинал не
  мутируется;
- миграция к несуществующей цепочке — MigrationError
  'missing_migration_path' (в сообщении явно «нет миграции»), сбой шага
  — 'migration_failed'; тихий noop невозможен.

`DatasetRegistry` регистрирует наборы по (id, version); поля лицензии и
контрольной суммы не выдумываются (undefined = «не определено»).

### 2.10 adapters — мосты к легаси

- `legacyUnitToCore`: русские единицы PhysValue → реестр ядра
  («кг»→kg, «Вт/м²»→W_m2, «g»→g0); неизвестная единица →
  null, а не выдуманный идентификатор. «%» и «доля» → безразмерная
  единица '1' С масштабированием: проценты переводятся в доли ×0.01
  (50% → 0.5, 100% → 1.0), range масштабируется вместе со значением,
  факт пересчёта фиксируется в provenance (ревизия 4.1.1: ранее '%'
  проходил без пересчёта — 50 превращалось в «50 долей»).
- `physValueToScientificValue`: established/derived → known;
  estimated → estimated (метод обязателен); hypothetical → estimated
  с предупреждением о гипотетичности; game_assumption → estimated
  с пометкой «не является научным измерением»; value=null → unknown
  (provenance СОХРАНЯЕТСЯ: sourceName, method, note, rawInput — ревизия
  4.1.1); незарегистрированная единица → invalid БЕЗ фиктивной единицы
  '1' (quantity не создаётся; отклонённые данные сохраняются в
  provenance.rawInput с originalValue/originalUnit — ревизия 4.1.1);
  range → interval-неопределённость (масштабируется при factor ≠ 1);
  parameters → rawInput; source → sourceName.
- `buildSpeciesCatalogFromLegacy`: г/моль → кг/моль (точный множитель
  1e-3), фаза gas, заряд 0; виды без известного состава в каталог
  не попадают (состав не выдумывается).
- `chemicalStateToMaterialInventory`: column_inventory → column_amount
  (моль/м²); game_normalized → arbitrary_units — игровая нормировка
  НЕ превращается в моль/м²; пустой инвентарь → null.
- `coreWorldStateFromLegacyWorld`: часы с нуля (легаси химическое
  время в годах НЕ переносится как прошедшее время симуляции);
  гравитация только around_star/around_parent_body; излучение только
  kind==='star'; компактный остаток не объявляется излучателем;
  атмосферный резервуар создаётся только при непустом инвентаре;
  seed и generatorVersion сохраняются в legacy.

## 3. Интеграция (точки контакта с легаси)

1. `GeneratedWorld.coreWorldState?: CoreWorldState` — опциональное поле.
   **Отсутствие = «ядро для мира не инициализировано»**, а не нулевое
   состояние; миграции его не создают.
2. `Storage`: STORAGE_FORMAT_VERSION = '1.2' (ведётся реестром миграций
   ядра); SUPPORTED_SAVE_VERSIONS = ['1.0','1.1','1.2'];
   `migrateWorld` делегирует цепочке `Core/migrations`; экспорт Markdown
   дополнен секцией «Научное ядро (этап 4.1)». Ревизия 4.1.1: работа с
   localStorage ведётся по RAW-записям (readRawEntries) — одна битая
   или несовместимая запись не скрывает остальные (изолированная
   обработка каждой) и НИКОГДА не удаляется при saveWorld/deleteWorld;
   getStorageHealth() диагностирует хранилище (rawEntryCount,
   loadedWorldCount, parseError, incompatibleEntries, nonObjectEntries);
   importWorldFromJSON возвращает null при MigrationError.
3. Баррель `Tests/index.ts` реэкспортирует 9 новых тест-файлов ядра.

Чего интеграция НЕ делает: UI не переключён на ядро (задача Stage 4.2);
легаси-вычисления (Generator, ChemicalEvolution, Atmosphere, PhaseEquilibrium,
OrbitalMechanics, Geology, WorldModel) продолжают работать как есть;
дублирование вспомогательных функций (аудит §2.7) и легаси-ветка
характеристик тела (§2.6) пока не удалены — контракты для этого готовы.

## 4. Тесты ядра (246 тестов, 9 файлов; Stage 4.1 + ревизия 4.1.1)

| Файл | it() | Покрытие |
|---|---|---|
| corePhysicalQuantity.test | 21 | преобразования, round-trip, несовместимые размерности, составные размерности, NaN/Inf, неизвестные единицы, нули/отрицательные, переполнение |
| coreScientificValue.test | 14 | все 6 статусов, unknown≠0, na≠ni, invalid unusable, метод estimated, uncertainty, provenance при конвертации |
| coreSpecies.test | 18 | валидация, каталог, CO2(g)/CO2(aq), фазы, элементный/зарядовый баланс, непроверяемость при неизвестном составе |
| coreReservoir.test | 30 | basis, insufficient_amount, иммутабельность, basis_mismatch, arbitrary_units, свойства ScientificValue, энергия (null≠0, NaN), amount↔mass с convert ДО деления и контролем переполнения (1000 г / 0.018 кг/моль = 55.5556 моль), validateReservoirRecord |
| coreFluxLedger.test | 52 | внутренние/внешние, rate≠integrated, идемпотентность, revert, РЕАЛЬНЫЕ переносы энергии (applyFlux/revertFlux меняют storedJ), аудиты со статусами и областью времени (FluxAuditScope, untimed), basis-aware балансы элементов/заряда (масса через молярную массу: 1 моль CO2 = 0.044 кг → 1 моль C), auditReservoirFluxes, validateFluxLedger, ghost-резервуары |
| coreSimulationClock.test | 17 | шаги, запрет zero/negative/NaN, сегментация 1e16+0.001, сравнение моментов, round-trip сериализации, yearsToSeconds |
| coreWorldState.test | 31 | валидный каркас, дубли, битые ссылки, self_parent, циклы, гравитация≠излучение, строгие версии схем, резервуары/потоки через validateReservoirRecord/validateFluxLedger, unknown-значения допустимы |
| coreSolverBackend.test | 11 | честный empty backend, лжец unsupported_kind_claim, реестр planned vs available |
| corePersistence.test | 52 | миграции 1.0/1.1/1.2 (идемпотентность, null≠0, легаси-записи; '0.9'/'1.3'/'2.0' → unsupported_version; 'abc'/'2'/'' → invalid_version; оригинал не мутируется), Storage raw-изоляция несовместимых записей + getStorageHealth, адаптеры всех веток (50% → 0.5, provenance у unknown), PRNG-регрессия |

Всего в проекте 21 тест-файл, 517 тестов (после ревизии 4.1.1; этап 4.1
фактически заканчивался на 442 — CI #24: в доках ревизии 4.1 ошибочно
указывалось 438). PRNG-регрессия
(два инстанса `createRandom(seed)` дают идентичные последовательности
next/nextIntRange/shuffle/generateId; разные seed различаются) защищает
главное требование совместимости — детерминизм генерации.

## 5. Границы Stage 4.1 (честные ограничения)

Реализованы КОНТРАКТЫ и инварианты. НЕ реализовано (и не выдаётся
за реализованное):

- численные решатели (ODE/DAE/равновесия/линейные системы) — только
  контракт и пустой бэкенд;
- кинетика, термодинамика видов, EOS, равновесие смесей;
- сэмплирование звезды из класса (аудит §2.1), иерархия температурных
  величин (§2.2/2.3) — контракты ScientificValue/Reservoir к ним
  готовы, физика придет на этапах 4.2–4.8;
- перевод UI на ядро, перенос форматтеров из App.tsx, удаление
  легаси-ветки bodyPhysics (§2.6) и дублей (§2.7) — Stage 4.2;
- сами миграции создают только версии — значения в старых сохранениях
  не пересчитываются и не «дозаполняются»;
- массово-молярные пересчёты требуют молярной массы вида: неизвестная
  или неподтверждённая масса → not_verifiable, оценочная (estimated) →
  approximate; концентрации, доли и arbitrary_units не пересчитываются
  в моль без дополнительных данных (объём, общий запас).
