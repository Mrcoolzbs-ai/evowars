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
>
> Ревизия Stage 4.1.1.2 (2026-10-30): корректирующая ревизия полноты
> балансов и защиты хранилища — 4 остаточных дефекта (ISSUE A/B/C/D):
> отсутствие материального инвентаря больше не превращается в ноль
> (unknown ≠ known-empty ≠ known-zero; явный materialApplicability
> 'not_applicable'), пофазовый аудит проверяет объединение всех
> резервуаров (изменение «из ниоткуда» ловится), untimed-исключения
> не маскируются как balanced (отдельная диагностика от out-of-range),
> Storage отказывает записью при повреждённом корневом JSON
> (StorageError 'storage_unreadable', исходная строка не меняется),
> properties в ReservoirRecord обязательны. Коммиты 35e7b0e → bf3f677
> (CI run #30 зелёный). После 4.1.1.2 — 550 тестов, из них ядро — 279.
>
> Ревизия Stage 4.1.1.3 (2026-10-30): materialApplicability и форма
> записей — 2 остаточных дефекта (ISSUE A/B). ISSUE A: пофазовый
> аудит auditReservoirFluxes больше НЕ выводит нематериальность из
> отсутствия material — единственное законное основание пропустить
> материальное измерение — materialApplicability = 'not_applicable'
> в ОБОИХ состояниях (согласованно с reservoirsToMolarCounts); чисто
> энергетические буферы обязаны объявлять нематериальность явно.
> ISSUE B: properties и material.entries обязаны быть объектами-
> записями (isPlainRecord: объект, не null, не массив): массив — не
> словарь; пустой массив НЕ равен пустому словарю и не трактуется
> как «известная пустота». Коммит 00d9985 (CI run #32, 41118174329,
> зелёный). После 4.1.1.3 — 574 теста, из них ядро — 303.
>
> Ревизия Stage 4.1.1.3.1 (2026-10-30): строгая проверка записей —
> isPlainRecord принимает только настоящие объекты-записи (прототип
> Object.prototype или null): Map, Set, Date, RegExp и экземпляры
> пользовательских классов больше не проходят как «словари» и не
> превращаются в «известную пустоту» через Object.entries(). После
> 4.1.1.3.1 — 597 тестов (CI run #34, 21 файл), из них ядро — 326.
>
> Stage 4.2.1 (2026-10-30): фундамент политики времени — WorldClock
> поверх сегментированного SimulationClock (§2.11), реестр процессов
> с честными τ (§2.12), планировщик с Lie/Strang splitting,
> sub-cycling и очередью событий (§2.13), общий InvariantAuditor
> (§2.14); схема состояния ядра 1.0.0 → 1.1.0 (опциональное
> scheduling), версия сохранений 1.2 → 1.3 (§2.9). Коммиты:
> 63375e9 (golden baseline химии) → eba0a94 → 31f2298 → 2af6970
> (CI runs #38–#42, зелёные). ChemicalEvolution НЕ переведён на
> Scheduler (это Stage 4.2.3): SHA-256 контрольной траектории 100
> шагов
> (877e17d346da3618ec5d15aced90c68da8a4bbb34ff18cb78023e756c1d85b20)
> совпал до и после. После 4.2.1 — 672 теста (26 файлов), из
> них ядро — 401 (14 файлов).
>
> Ревизия Stage 4.2.1.2 (2026-10-30): аудит контрактов реестра
> процессов и планировщика — 3 остаточных дефекта (ISSUE 1–3),
> все исправлены. ISSUE 1: числовое τ ОБЯЗАНО быть строго
> положительным — нулевое/отрицательное τ (в любой единице
> времени, проверка ПОСЛЕ перевода в секунды) отклоняется
> валидацией дескриптора (invalid_descriptor); tauSeconds
> fail-closed (τ ≤ 0 → null, как неизвестное; значение не
> «чинится»), процесс с непригодным τ не autorunnable и не
> запускается планировщиком даже при прямом вызове. ISSUE 2:
> дублирующиеся processId в одном macro-шаге (список процессов
> ИЛИ переданные runtime-операторы) отклоняются ДО вызова первого
> оператора — SchedulerError 'duplicate_process_id'; молчаливая
> перезапись оператора через Map.set невозможна; Strang требует
> ровно два РАЗНЫХ processId. ISSUE 3: временной аргумент
> ProcessOperator зафиксирован как ФИЗИЧЕСКИЙ подынтервал —
> [intervalStartS, intervalStartS + durationS) ⊆ [0, dt];
> Strang: A — [0, dt/2], B — [0, dt], второй A — [dt/2, dt]
> (ранее B получал intervalStartS = dt/2 и формально охватывал
> [dt/2, 3dt/2] — выход за границы macro-шага). После 4.2.1.2 —
> 685 тестов (26 файлов), из них ядро — 414 (14 файлов).
>
> Ревизия Stage 4.2.2 (2026-10-30): температурная иерархия и
> происхождение — новый слой `thermalState.ts` (§2.15): 6 раздельных
> температурных понятий с валидацией «только K», BodyThermalState на
> теле (схема CoreWorldState 1.2.0), профиль атмосферы со статусами,
> reservoirTemperature с provenance, resolver локальной температуры
> без ложных fallback, диагностика расхождения пресет/T_eq, адаптеры
> пресетных температур с честным происхождением (historical_game →
> estimated «игровое допущение»; observational_reference → «справочное,
> НЕ измерение этого мира»). WorldModel больше НЕ копирует пресетную
> температуру в surfaceTemperature; генератор передаёт в фазовый
> скрининг типизированную температуру (analyzeAtmospherePhasesWithProvenance,
> temperatureBasis). RCM и вертикальный профиль НЕ реализованы и не
> выдаются за реализованные (этап 4.8). После 4.2.2 — 761 тест
> (27 файлов), из них ядро — 490 (15 файлов, +76 в
> coreThermalState.test). Коммиты: d706841 → 7dc91ea → 7248b38 →
> a5888c6 (CI зелёный; golden baseline химии совпадает).
>
> Ревизия Stage 4.2.2.1 (2026-10-30): ревизия интеграции
> температурной иерархии по итогам независимого аудита — строгая
> форма температур в hasUsableTemperature/temperatureValueOrNull
> (estimated без method, NaN/±Inf/отрицательные, неизвестная
> единица не пригодны; unknown/not_applicable/not_implemented/
> invalid не превращаются в число), защита resolver (пустые/
> пробельные id — invalid_place; orphan-резервуар; слой из профиля
> со статусом unknown не читается), provenance-дисциплина
> адаптеров (пояснение пресета — в provenance.note, sourceName —
> только действительный источник; teff-диапазон класса не
> схлопывается в среднее; T_eq из EnergyBalance с confidence
> estimated НЕ повышается до known), Compatibility: новое правило
> cradle_temperature_unproven — отсутствие локальной температуры
> есть УСЛОВНАЯ совместимость (warning), а НЕ доказанная
> (известная температура вне диапазона — по-прежнему error);
> диагностика «пресет vs T_eq» подключена к реальной генерации
> (запись severity info, порог не выдуман); фазовый скрининг —
> location-aware слой surface_boundary
> (PhaseScreeningTemperatureContext: ScientificValue | слой
> AtmosphereTemperatureLayer). Golden baseline химии совпадает.
> После 4.2.2.1 — 783 теста (27 файлов), из них ядро — 500.
> Коммиты: a62b7dd → d916fb7 → 59c4ca1 → fcb0876 → 78c032a
> (последние три — корректирующие: tsc-строгости в тестах и
> выравнивание фактических сообщений; CI зелёный).

## 1. Слои ядра (`src/modules/Core/`)

| Файл | Слой | Ответственность |
|---|---|---|
| `physicalQuantity.ts` | Величины | значение + единица + размерность; преобразование единиц; runtime-контроль размерностей; запрет NaN/±Inf |
| `scientificValue.ts` | Семантика данных | статусы known/estimated/unknown/not_applicable/not_implemented/invalid; неопределённость; provenance |
| `species.ts` | Химия (контракт) | формальный элементный состав, заряд, фаза; каталог видов; проверка элементного/зарядового баланса |
| `reservoir.ts` | Вещество и энергия | материальный инвентарь с явным основанием; энергетический инвентарь (запас/мощность/поток раздельно); иммутабельные записи |
| `fluxLedger.ts` | Потоки | внутренние/внешние переносы; rate против integrated; атомарное применение; revert; аудиты сохранения |
| `simulationClock.ts` | Время | сегментированное локальное время; сериализация; космический возраст — отдельно |
| `worldClock.ts` | Мировое время | контракт ПОВЕРХ SimulationClock (4.2.1): продвижение, сериализация; второе числовое поле времени запрещено |
| `processRegistry.ts` | Процессы | дескрипторы процессов с честными τ и статусами доступности solver (4.2.1) |
| `scheduler.ts` | Планировщик | детерминированный порядок операторов, Lie/Strang, sub-cycling, очередь событий (4.2.1) |
| `invariantAuditor.ts` | Инварианты | объединённый аудит перехода before → process → after (4.2.1) |
| `thermalState.ts` | Температуры (4.2.2) | термодинамическая температура «только K»; BodyThermalState; профиль атмосферы со статусами; reservoirTemperature; resolver локальной температуры без ложных fallback; диагностика расхождения пресет/T_eq |
| `worldState.ts` | Состояние мира | каноническое состояние: тела (с thermalState, 4.2.2), гравитация, излучение, резервуары, потоки, часы; валидация |
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
energy, properties через validateScientificValueShape; ревизия 4.1.1.2:
properties — ОБЯЗАТЕЛЬНОЕ поле записи (объект; пустой `{}` допустим),
materialApplicability — только 'not_applicable' и только при
ОТСУТСТВУЮЩЕМ material).

Три состояния материального вклада не схлопываются (ревизия 4.1.1.2,
ISSUE A): (1) `material` отсутствует без явного маркера — запас
НЕИЗВЕСТЕН и не приравнивается к нулю: глобальные аудиты возвращают
not_verifiable с исключением; (2) явно заданный пустой инвентарь
(`entries = {}`) — известное отсутствие запасов; (3) нулевое значение
вида в заданном инвентаре (`entries[species] = 0`) — известный ноль.
Резервуар, по своей природе не содержащий материю (энергетический
буфер), помечается явно: `materialApplicability: 'not_applicable'` —
неприменимость НЕ выводится из отсутствия поля.

Словари — не массивы (ревизия 4.1.1.3, ISSUE B): `properties` и
`material.entries` обязаны быть объектами-записями (помощник
`isPlainRecord`: объект, не null, не массив). У массива typeof тоже
'object', поэтому массивы исключаются ЯВНО: пустой массив `[]` НЕ
равен пустому словарю `{}` и не принимается за «известную пустоту».
Пустой объект остаётся допустимым; известные нули не меняются.
Энергетический буфер без материи по своей природе ОБЯЗАН объявлять
это явно: `materialApplicability: 'not_applicable'` — и в валидации,
и в тестовых фикстурах.

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
  исключены и перечисляются в untimedRecords. Ревизия 4.1.1.2 (ISSUE C):
  применённые integrated-записи без времени в ограниченной области делают
  аудит not_verifiable — их изменения нельзя отнести к интервалу, и
  численно «сходящийся» итог не объявляется успехом; includeUntimed:
  true включает их в область НА ОТВЕТСТВЕННОСТЬ вызывающего кода
  (untimedRecords при этом пуст). Запись С меткой времени вне
  диапазона — ДРУГАЯ диагностика (событие относится к другому
  интервалу): она не попадает в untimedRecords и не отравляет статус
  суммарного аудита области.
- `auditReservoirFluxes` (4.1.1; полнота — 4.1.1.2, ISSUE B):
  пофазовая проверка — ожидаемое Δ каждого резервуара по каждому виду
  и энергии сверяется с фактически применёнными потоками; проверяется
  ОБЪЕДИНЕНИЕ резервуаров «до» ∪ «после» ∪ затронутых потоками:
  нетронутый резервуар с известным инвентарём обязан сохранить его
  (ожидаемое Δ = 0) — изменение «из ниоткуда» ловится (A→B применён,
  C изменился без записи → imbalanced с указанием C). Измерение
  (материя/энергия) обязательно для резервуара, если инвентарь задан
  хотя бы в одном состоянии или резервуар затронут потоком этого
  типа; непроверяемые вклады (отсутствующий инвентарь, сменённый
  basis, storedJ = null, несовместимые основания) дают диагностические
  exclusions и ДЕЛАЮТ итог not_verifiable: balanced при непроверенных
  обязательных вкладах невозможен. Статусы: imbalanced (расхождения)
  / not_verifiable (untimed-исключения или exclusions) / balanced
  (всё проверено и сходится). Ревизия 4.1.1.3 (ISSUE A): если
  инвентаря нет в ОБОИХ состояниях и материальных потоков нет,
  единственное законное основание пропустить материальное измерение —
  materialApplicability = 'not_applicable' в ОБОИХ состояниях;
  отсутствие material без маркера — неизвестный запас (исключение
  с ключом reservoirId, итог not_verifiable — согласованно с
  reservoirsToMolarCounts и глобальным аудитом); маркер только в
  одном состоянии — переход неприменимости не подтверждён (тоже
  not_verifiable); materialApplicability ничего не говорит об
  известности энергетического инвентаря (применимости не
  смешиваются); массив в material.entries — не словарь, пофазовая
  сверка невозможна (ISSUE B).
- `validateFluxLedger`: форма и согласованность записей журнала
  (id, status, kind, subject, time, ссылки на резервуары).
- `totalInventory` отказывается суммировать резервуары со смешанными
  основаниями и с material.entries-массивом (не словарём).
  Ревизия 4.1.1.3: totalInventory — СПРАВОЧНЫЙ агрегат заданных
  инвентарей, а НЕ доказательство сохранения материи: резервуары
  без инвентаря в сумму не входят (их запас неизвестен, а не ноль),
  поэтому «постоянство» итога ничего не доказывает о полноте баланса
  (доказательство — аудиты, дающие not_verifiable при неизвестных
  запасах).

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

`CoreWorldState` = { schemaVersion ('1.2.0' после 4.2.2; ранее
'1.1.0' и '1.0.0' — поддерживаются все), worldId, clock, cosmicAge,
bodies, gravity, radiationSources, reservoirs, fluxLedger,
scheduling?, legacy, note }. `scheduling` (динамика процессов и
очередь событий, §2.13) и `WorldBody.thermalState` (температурное
состояние тела, §2.15) опциональны: отсутствие = «не
инициализировано», миграции их НЕ создают (миграция сохранений
1.2→1.3 не создаёт thermalState). Ключевое разделение:

- `gravity: Record<bodyId, parentId | null>` — гравитационная иерархия;
- `radiationSources` — источники излучения.

Гравитация не выводится из излучения и наоборот: компактный остаток
может быть гравитационным родителем, не будучи излучателем; свободно
плавающий мир не получает ни родителя, ни фиктивного излучателя.
`validateWorldState` диагностирует: дубли id, битые ссылки (излучение →
тело, резервуар → тело, поток → резервуар), self_parent, циклы
гравитации, некорректные часы, несовпадение версий, пустой worldId;
ревизия 4.2.1: некорректное scheduling (включая события с
некорректным временем в очереди) — invalid_scheduling /
invalid_event; ревизия 4.2.2: некорректное thermalState тела
(включая профиль атмосферы) — invalid_thermal_state, некорректная
reservoirTemperature резервуара — invalid_reservoir.

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
**1.0 → 1.1 → 1.2 → 1.3** (текущая 1.3; ревизия 4.2.1: migrate12to13
НЕ создаёт scheduling и НЕ переносит ChemicalEvolutionState.
modelTimeYears в локальные секунды WorldClock — фиктивное
прошедшее время не изобретается; версия схемы CoreWorldState
поднята 1.0.0 → 1.1.0 с миграцией 1.0.0 → 1.1.0, которая также не
создаёт scheduling и не пересчитывает старые значения; сохранения
без coreWorldState остаются без него). Правила:

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

### 2.11 WorldClock — мировое время поверх SimulationClock (4.2.1)

WorldClockState = { clock: SimulationClockState } — ровно одно поле;
второго независимого числового поля прошедшего времени НЕ существует
(validateWorldClock отклоняет любые дополнительные поля — защита от
дублирующего elapsed). Продвижение — advanceWorldClock /
advanceWorldClockYears (годы переводятся в секунды ТОЛЬКО явно:
yearsToSeconds, юлианский год 3.15576e7 с); шаги только положительные
конечные (WorldClockError 'invalid_step'/'invalid_state'). Локальное
время симуляции не смешивается с космологическим возрастом
(cosmicAge — отдельное поле состояния мира): возраст Вселенной,
звезды и эпохи никогда не суммируются с локальным временем.
Сериализация/десериализация — round-trip без потерь; повторный
запуск с одинаковым состоянием даёт одинаковый результат
(Date.now()/системное время не используются).

### 2.12 ProcessRegistry — процессы с честными τ (4.2.1)

Дескриптор процесса (ProcessDescriptor): id (уникальность
проверяется реестром), name, processKind, tau (ScientificValue с
размерностью времени и provenance), stepPolicy, solverAvailability
(available | scheduled | not_implemented | unknown), enabled,
provenance, applicability, assumptions, timescaleNote, dependencies.
Правила честности:

- τ — физически значимая величина в секундах ИЛИ unknownValue с
  явной причиной; текстовые timescaleNote («миллионы лет») НЕ
  конвертируются в числа; словесные диапазоны не превращаются в
  якобы точные τ; числовое τ строго ПОЛОЖИТЕЛЬНО (4.2.1.2):
  нулевое/отрицательное τ — не «мгновенный» процесс, а
  некорректное время — invalid_descriptor, tauSeconds → null
  (fail-closed), автоматически не «чинится»;
- dt ≤ τ/20 — только ПРЕДВАРИТЕЛЬНАЯ эвристика (heuristicStepSeconds,
  provenance 'tau_heuristic'): окончательный шаг выбирает конкретный
  solver; единого универсального dt для химии, атмосферы, орбит и
  геологии НЕ существует;
- итоговая доступность (processAvailability): disabled →
  not_implemented → scheduled → unknown → available; процесс без
  пригодного числового τ (строго положительного, 4.2.1.2) или без
  решателя НЕ запускается автоматически
  (isProcessAutoRunnable = false);
- мост chemicalProcessesToCoreDescriptors переносит 11 легаси-
  процессов ChemicalEvolution в ЧЕСТНОМ состоянии: tau unknown,
  solver not_implemented, enabled false → доступность 'disabled';
  скорости, характерные времена, константы и физическая
  доступность НЕ выдумываются.

### 2.13 Scheduler — порядок процессов и события (4.2.1)

runMacroStep(world, registry, operators, { durationS, splitting,
processIds?, subCycles?, audit? }) → { status, world, bookkeeping,
log, audit?, diagnostics }. Свойства:

- детерминированность: скрытого состояния нет; runtime-исполнители
  (ProcessOperator) передаются отдельно от сериализуемого состояния
  мира; Lie — последовательное выполнение (порядок по id),
  sub-cycling делит durationS на равные подшаги (только для Lie);
- Strang splitting — ровно ДВА РАЗНЫХ оператора в симметричном
  порядке A(dt/2) → B(dt) → A(dt/2) (журнал strang_a_half_first →
  strang_b_full → strang_a_half_second); Strang с subCycles или
  ≠ 2 процессов — SchedulerError 'invalid_splitting'; фиктивные
  операторы ради демонстрации Strang не создаются;
- идентификаторы процессов одного macro-шага уникальны (4.2.1.2):
  дубликат processId — в списке процессов шага ИЛИ среди
  runtime-операторов — SchedulerError 'duplicate_process_id'
  ДО вызова первого оператора; молчаливая перезапись оператора
  невозможна;
- временные аргументы операторов — ФИЗИЧЕСКИЕ подынтервалы
  [intervalStartS, intervalStartS + durationS) ⊆ [0, dt] (4.2.1.2):
  Lie без sub-cycling — каждый оператор [0, dt]; sub-cycling —
  последовательные подшаги [i·dt/n, (i+1)·dt/n); Strang —
  A: [0, dt/2], B: [0, dt] (полный шаг B-динамики внутри
  macro-шага), второй A: [dt/2, dt]; выхода за [0, dt] нет;
- атомарность транзакции шага: мировое время продвигается РОВНО
  один раз — после успешного выполнения всех операторов и успешного
  аудита; ошибка оператора, самовольное продвижение часов или
  нарушенный инвариант → шаг rejected: возвращается исходный мир,
  время не продвигается, диагностика не теряется;
- очередь событий мира: порядок по comparePoints, при равном
  времени — стабильный tie-break по sequence; данные события
  JSON-сериализуемы (callback-функции в состоянии мира не
  хранятся); повторная обработка обработанного события запрещена
  (already_processed); ошибка обработки помечает событие failed с
  failReason (событие не теряется); enqueue дубликата,
  некорректного времени или несериализуемых данных — 'invalid_event'.
  Физические события не изобретаются: типизированная инфраструктура
  готова для фазовых переходов, исчерпания реагента, смены режима
  и событий solver.

### 2.14 InvariantAuditor — аудит перехода (4.2.1)

auditWorldTransition(before, after, fluxLedger, { speciesCatalog,
boundary, tolerance?, scope? }) объединяет контракты Stage 4.1 в
ДЕВЯТИ секциях: substance, element, charge, energy, reservoir_fluxes,
nonnegativity (отрицательные запасы), ledger (validateFluxLedger),
state (validateReservoirRecord + validateWorldState), time
(согласованность часов). Агрегация статусов: любой invalid или
imbalanced → imbalanced; иначе not_verifiable или граница ≠ complete
→ not_verifiable; иначе approximate → approximate; иначе balanced.
Правила честности сохранены: balanced = true только при статусе
balanced И полной границе системы; approximate НЕ является balanced;
внутренний перенос, корректно отражённый в ledger, дисбалансом не
признан; внешние источники/стоки учитываются явно (EXTERNAL);
untimed-записи в ограниченной временной области не маскируются
(правила 4.1.1.2/4.1.1.3). Scheduler вызывает аудитор ДО фиксации
нового состояния: обязательные нарушенные инварианты отклоняют шаг
без продвижения времени и без потери исходного состояния.

### 2.15 thermalState — температурная иерархия (4.2.2)

Слой реализует иерархию РАЗДЕЛЬНЫХ температурных величин
(PHYSICS_ARCHITECTURE §5.1; проблемы аудита 2.2/2.3 закрыты в
типизированной части). Шесть понятий НЕ сводятся к одному полю:

- `effectiveTemperature` — эффективная температура ИСТОЧНИКА
  излучения (звезда, компактный остаток, субзвёздный объект);
  для планеты — not_applicable (получатель излучения);
- `equilibriumTemperature` — T_eq серого тела из энергетического
  бюджета (known при известном потоке; радиационная оценка с
  допущениями A/f/ε, НЕ температура поверхности);
- `surfaceTemperature` — температура физической поверхности;
  до появления RCM (этап 4.8) — ЯВНО unknown, не подменяется
  T_eq и пресетом;
- `atmosphericTemperatureProfile` — профиль атмосферы со
  статусами unknown / single_layer_estimate (ровно 1 слой +
  обязательные limitations: «НЕ расчётный вертикальный профиль») /
  partial_profile / complete_profile;
- `reservoirTemperature` (`ReservoirRecord`) — температура
  резервуара, где идёт процесс, с provenance; отсутствие ≠
  температуре поверхности;
- локальная температура реакции/фазового перехода — результат
  `resolveLocalReactionTemperature`.

Контракты и правила честности:

- термодинамическая температура — ТОЛЬКО единица 'K' с размерностью
  Θ (validateThermalScientificValue: known/estimated конечны и ≥ 0;
  invalid — только диагностика; unknown без чисел);
- `resolveLocalReactionTemperature(state, {bodyId, reservoirId |
  layerId})` читает ТОЛЬКО явно указанную область; T_eq, глобальная
  surfaceTemperature, соседние резервуары/слои и
  AtmosphereState.temperature НЕ являются fallback ни при каких
  условиях; отсутствие/чужая область/непригодные данные →
  синтезированный unknown с причиной; заявленные
  unknown/not_applicable/not_implemented сохраняются с provenance;
  некорректное место → ThermalStateError 'invalid_place';
- `diagnosePresetEquilibriumDivergence` — честная диагностика
  расхождения пресетной температуры с T_eq (not_comparable /
  noted / threshold_exceeded; порог только явный, иначе
  'invalid_threshold'; температуры не изменяются);
- адаптеры (§2.10): пресетная температура → ScientificValue с
  provenance (historical_game → estimated «игровое допущение
  (game_assumption)», observational_reference → «справочное, НЕ
  измерение этого мира»); `planetThermalStateFromLegacy`:
  T_eq known отдельно, surfaceTemperature unknown, effective
  not_applicable; центральные объекты: T_eff known или unknown —
  среднее по классу НЕ подставляется;
- схема CoreWorldState 1.2.0: `WorldBody.thermalState?`
  (validateWorldState → invalid_thermal_state), `ReservoirRecord.
  reservoirTemperature?` (invalid_reservoir); миграция сохранений
  1.2→1.3 thermalState НЕ создаёт;
- фазовый скрининг: `analyzeAtmospherePhasesWithProvenance(model,
  temperature: PhaseScreeningTemperatureContext)` (PhaseEquilibrium;
  контекст — ScientificValue ИЛИ слой AtmosphereTemperatureLayer) —
  делегирует числовой анализ, добавляет temperatureBasis
  {temperature, note}; подстановка T_eq или температуры поверхности
  запрещена и отмечена в примечании. WorldModel больше НЕ присваивает
  пресетную температуру в characteristics.surfaceTemperature.

Ревизия 4.2.2.1 (строгость форм и интеграция):

- `hasUsableTemperature`/`temperatureValueOrNull` проверяют ФОРМУ
  значения так же строго, как единицу и размерность: estimated без
  method непригоден; NaN/±Inf/отрицательные и неизвестная
  единица/размерность не проходят; unknown/not_applicable/
  not_implemented/invalid никогда не превращаются в число;
- resolver отклоняет пустые/пробельные reservoirId/layerId
  (invalid_place); orphan-резервуар (тело отсутствует в bodies)
  не является областью существующего мира; слой из профиля со
  статусом unknown не читается — заявленная неизвестность не
  изображается данными;
- адаптеры: пояснение пресета (presetNotes) живёт в
  provenance.note; sourceName — только при действительном
  источнике (observational_reference); teff-диапазон класса при
  value=null сохраняется в provenance.rawInput и НЕ схлопывается
  в среднее; T_eq из реального EnergyBalance (confidence
  estimated — репрезентативная светимость класса) остаётся
  estimated после адаптации;
- диагностика «пресет vs T_eq» вызывается реальным
  генерационным контуром (запись severity info в warnings мира;
  verdict noted; порог по умолчанию НЕ выдуман);
- фазовый скрининг генератора получает location-aware контекст —
  слой surface_boundary (однослойная модель текущего этапа):
  температура скрининга НЕ называется surfaceTemperature и НЕ
  является T_eq; при отсутствии пригодной локальной температуры
  скрининг остаётся unknown;
- Compatibility: cradle_temperature_compatibility больше не
  возвращает молчаливый true при отсутствии локальной температуры;
  правило cradle_temperature_unproven (conditionally_compatible,
  warning) различает «условная совместимость» и «нет проверки»;
  атмосферная среда читается через типизированное значение
  адаптера (historical_game не изображается наблюдательным
  измерением); известная температура вне диапазона — error.

RCM, вертикальный профиль, гидростатика, парниковый эффект и
вычисление surfaceTemperature НЕ реализованы и не выдаются за
реализованные (этап 4.8); легаси-химия продолжает работать на
пресетной температуре (перевод на Scheduler — 4.2.3).

## 3. Интеграция (точки контакта с легаси)

1. `GeneratedWorld.coreWorldState?: CoreWorldState` — опциональное поле.
   **Отсутствие = «ядро для мира не инициализировано»**, а не нулевое
   состояние; миграции его не создают.
2. `Storage`: STORAGE_FORMAT_VERSION = '1.3' (ведётся реестром миграций
   ядра; ревизия 4.2.1: была '1.2'); SUPPORTED_SAVE_VERSIONS =
   ['1.0','1.1','1.2','1.3'];
   `migrateWorld` делегирует цепочке `Core/migrations`; экспорт Markdown
   дополнен секцией «Научное ядро (этап 4.1)». Ревизия 4.1.1: работа с
   localStorage ведётся по RAW-записям (readRawEntries) — одна битая
   или несовместимая запись не скрывает остальные (изолированная
   обработка каждой) и НИКОГДА не удаляется при saveWorld/deleteWorld;
   getStorageHealth() диагностирует хранилище (rawEntryCount,
   loadedWorldCount, parseError, incompatibleEntries, nonObjectEntries);
   importWorldFromJSON возвращает null при MigrationError. Ревизия
   4.1.1.2 (ISSUE D): при повреждённом корневом JSON (битая строка или
   корень не массив) saveWorld/deleteWorld ОТКАЗЫВАЮТ — исходная строка
   localStorage не меняется; saveWorld бросает структурированную
   StorageError 'storage_unreadable' (с parseError; диагностика —
   getStorageHealth(), явная очистка — clearAllWorlds()). Никаких
   резервных копий в виде «фиктивного мира» с выдуманной версией;
   несовместимые записи (например, 2.0) по-прежнему сохраняются как
   raw и не удаляются.
3. Баррель `Tests/index.ts` реэкспортирует 9 тест-файлов ядра Stage
   4.1; тест-файлы Stage 4.2.1 (coreChemicalGoldenBaseline,
   coreWorldClock, coreProcessRegistry, coreScheduler,
   coreInvariantAuditor) и Stage 4.2.2 (coreThermalState.test)
   запускаются Vitest напрямую (баррель никем не импортируется
   и не расширялся — несвязанный код не трогался).
4. Баррель ядра `Core/index.ts` реэкспортирует thermalState (4.2.2);
   PhaseEquilibrium дополнился типизированной функцией
   `analyzeAtmospherePhasesWithProvenance` (числовой API и его
   результат НЕ изменены); Generator передаёт в фазовый скрининг
   типизированную температуру через адаптер; WorldModel больше не
   копирует пресетную температуру в surfaceTemperature. Ревизия
   4.2.2.1: Generator передаёт в скрининг location-aware контекст
   (слой surface_boundary) и вызывает диагностику «пресет vs T_eq»
   (запись severity info в warnings); Compatibility читает
   атмосферную температуру через типизированный адаптер и
   различает отсутствие доказательства
   (cradle_temperature_unproven, warning) и ошибку диапазона
   (error).

Чего интеграция НЕ делает: UI не переключён на ядро (задача Stage 4.2);
легаси-вычисления (Generator, ChemicalEvolution, Atmosphere, PhaseEquilibrium,
OrbitalMechanics, Geology, WorldModel) продолжают работать как есть;
ChemicalEvolution НЕ переведён на Scheduler (Stage 4.2.3): applyReaction
не меняет модельное время, один runChemicalEvolutionStep увеличивает
modelTimeYears ровно один раз, Scheduler легаси-химию не вызывает;
golden-траектория 100 шагов воспроизводится численно (SHA-256
877e17d346da3618ec5d15aced90c68da8a4bbb34ff18cb78023e756c1d85b20);
дублирование вспомогательных функций (аудит §2.7) и легаси-ветка
характеристик тела (§2.6) пока не удалены — контракты для этого готовы.

## 4. Тесты ядра (500 тестов, 15 файлов; Stage 4.1 + ревизии 4.1.1 + 4.1.1.2 + 4.1.1.3 + 4.1.1.3.1 + 4.2.1 + 4.2.1.2 + 4.2.2 + 4.2.2.1)

| Файл | it() | Покрытие |
|---|---|---|
| corePhysicalQuantity.test | 21 | преобразования, round-trip, несовместимые размерности, составные размерности, NaN/Inf, неизвестные единицы, нули/отрицательные, переполнение |
| coreScientificValue.test | 14 | все 6 статусов, unknown≠0, na≠ni, invalid unusable, метод estimated, uncertainty, provenance при конвертации |
| coreSpecies.test | 18 | валидация, каталог, CO2(g)/CO2(aq), фазы, элементный/зарядовый баланс, непроверяемость при неизвестном составе |
| coreReservoir.test | 56 | basis, insufficient_amount, иммутабельность, basis_mismatch, arbitrary_units, свойства ScientificValue, энергия (null≠0, NaN), amount↔mass с convert ДО деления и контролем переполнения (1000 г / 0.018 кг/моль = 55.5556 моль), validateReservoirRecord; 4.1.1.2: обязательность properties + materialApplicability (not_applicable; конфликт и мусор — ошибки); 4.1.1.3: словари ≠ массивы (properties/material.entries: [] — invalid, {} — valid, known-zero сохранён); 4.1.1.3.1: строгие записи — Map/Set/Date/RegExp/экземпляры классов в properties/material.entries/energy — invalid, Object.create(null) валиден |
| coreFluxLedger.test | 88 | внутренние/внешние, rate≠integrated, идемпотентность, revert, РЕАЛЬНЫЕ переносы энергии (applyFlux/revertFlux меняют storedJ), аудиты со статусами и областью времени (FluxAuditScope, untimed), basis-aware балансы элементов/заряда (масса через молярную массу: 1 моль CO2 = 0.044 кг → 1 моль C), auditReservoirFluxes, validateFluxLedger, ghost-резервуары; 4.1.1.2: unknown ≠ known-empty ≠ known-zero, полный пофазовый union-баланс, untimed не маскируется как balanced; 4.1.1.3: materialApplicability в пофазовом аудите (маркер в обоих состояниях; unknown ≠ not_applicable), reservoirsToMolarCounts отвергает массив entries; 4.1.1.3.1: Map/Date в entries — not_verifiable, а не «известная пустота» |
| coreSimulationClock.test | 17 | шаги, запрет zero/negative/NaN, сегментация 1e16+0.001, сравнение моментов, round-trip сериализации, yearsToSeconds |
| coreWorldState.test | 46 | валидный каркас, дубли, битые ссылки, self_parent, циклы, гравитация≠излучение, строгие версии схем, резервуары/потоки через validateReservoirRecord/validateFluxLedger, unknown-значения допустимы; 4.1.1.2: обязательность properties ReservoirRecord; 4.1.1.3: массивы в properties/material.entries — invalid_reservoir; 4.2.1: scheduling (invalid_scheduling/invalid_event; схема 1.0.0 → 1.1.0) |
| coreSolverBackend.test | 11 | честный empty backend, лжец unsupported_kind_claim, реестр planned vs available |
| corePersistence.test | 62 | миграции 1.0/1.1/1.2 (идемпотентность, null≠0, легаси-записи; '0.9'/'1.3'/'2.0' → unsupported_version; 'abc'/'2'/'' → invalid_version; оригинал не мутируется), Storage raw-изоляция несовместимых записей + getStorageHealth, адаптеры всех веток (50% → 0.5, provenance у unknown), PRNG-регрессия; 4.1.1.2: отказ записи при повреждённом корневом JSON (storage_unreadable); 4.2.1: миграция сохранений 1.2 → 1.3 (scheduling не создаётся, старые значения не пересчитываются) |
| coreChemicalGoldenBaseline.test | 4 | 4.2.1 golden-траектория химии: generateWorld → runChemicalEvolutionStep × 100, фиксированный seed; SHA-256 канонического снимка 877e17d346da3618ec5d15aced90c68da8a4bbb34ff18cb78023e756c1d85b20 (steps=100, modelTimeYears=1e8, reactionRecords=0, oxygenNet=0); детерминизм повтора; обязательная регрессия перед 4.2.3 |
| coreWorldClock.test | 11 | 4.2.1: старт с нуля, секунды SI, advance, сегментация, cosmicAge не смешивается, round-trip сериализации, некорректные интервалы, детерминизм |
| coreProcessRegistry.test | 21 | 4.2.1: уникальные id, τ с размерностью времени и provenance, unknown τ ≠ число, disabled/без solver не запускаются автоматически, мост легаси-химии (11 процессов, честное состояние); 4.2.1.2: числовое τ строго положительно (0/−1 s и −1 ч → invalid_descriptor после перевода в секунды), fail-closed tauSeconds (τ ≤ 0 → null, не autorunnable, эвристика шага не назначается) |
| coreScheduler.test | 30 | 4.2.1: детерминированный порядок, sub-cycling, Lie и Strang A(dt/2) → B(dt) → A(dt/2) (ровно 2 оператора), один macro-шаг — одно продвижение WorldClock, атомарный отказ шага, очередь событий (сортировка, tie-break, повторная обработка запрещена), сериализация bookkeeping; 4.2.1.2: дубликаты processId (processIds и operators) — duplicate_process_id до первого вызова оператора, мир/часы не тронуты, физические подынтервалы Strang внутри [0, dt] (A [0,dt/2], B [0,dt], A [dt/2,dt]) в вызовах и журнале, неположительное τ не запускается даже при прямом вызове |
| coreInvariantAuditor.test | 15 | 4.2.1: balanced/imbalanced/approximate/not_verifiable, внутренние потоки ≠ дисбаланс, внешние источники/стоки, неизвестный материал/энергия, untimed, неполная граница, отрицательные запасы |
| coreThermalState.test | 86 | 4.2.2: термодинамическая валидация («только K», размерность Θ, known/estimated конечны и ≥ 0, unknown без чисел, invalid — только диагностика, hasUsableTemperature/temperatureValueOrNull); профиль атмосферы (single_layer_estimate + обязательные limitations, unknown — 0 слоёв, дубли/пустые layerId, слои не в K, altitudeRangeM); BodyThermalState в validateWorldState (схема 1.2.0, 1.1.0 поддерживается, invalid_thermal_state; reservoirTemperature не в K → invalid_reservoir; миграция 1.2→1.3 thermalState не создаёт); адаптеры пресетов (historical_game 95 K → estimated «game_assumption» + rawInput, observational_reference 94 K «НЕ измерение» + sourceName, hypothetical, пользовательская, null/NaN/отрицательная; planetThermalState: T_eq known отдельно, surface unknown, effective not_applicable; центральные: star/substellar known\|unknown (среднее по классу НЕ подставляется), jet not_applicable; wiring coreWorldStateFromLegacyWorld); resolver (резервуар/слой с provenance, отсутствие → синтезированный unknown с причиной, T_eq/surfaceTemperature/соседние области НЕ fallback, заявленный unknown сохраняется, invalid не используется, чужое тело, invalid_place throw ×3, иммутабельность, детерминизм); диагностика (noted, threshold_exceeded, not_comparable, invalid_threshold throw, входы не изменяются); фазовый анализ (temperatureBasis + числовое совпадение с легаси, unknown → все компоненты unknown, числовой API без регрессии); регрессии пресетов (methane_ethane 95/1.5/historical_game, titan_reference 94 observational_reference ≠ methane_ethane, earth/venus/mars, not_applicable ≠ unknown); 4.2.2.1: строгая форма (estimated без method, NaN/±Inf/отрицательные, known без quantity, статусы не превращаются в число), T_eq из EnergyBalance с confidence estimated НЕ повышается до known, teff-диапазон 2500–4000 K сохранён в rawInput и не схлопнут в среднее, presetNotes → provenance.note (sourceName только observational_reference), resolver: пустые/пробельные id → invalid_place, orphan-резервуар → unknown, слой из unknown-профиля не читается, location-aware фазовый скрининг (слой surface_boundary — числовой паритет и unknown без fallback) |

Всего в проекте 27 тест-файлов, 783 теста (после ревизии 4.2.2.1 —
фактические итоги Vitest «Test Files 27 passed (27) / Tests 783
passed (783)» из CI; после 4.2.2 — 761,
фактические итоги Vitest «Test Files 27 passed (27) / Tests 761
passed (761)» из CI; после 4.2.1.2 — 685 (26 файлов),
фактические итоги Vitest «Test Files 26 passed (26) / Tests 685
passed (685)» из CI; после 4.2.1 — 672,
фактические итоги Vitest «Test Files 26 passed (26) / Tests 672
passed (672)» из CI; после golden baseline — 601 (22 файла), после
4.1.1.3.1 — 597, после ревизии 4.1.1.3 — 574, после 4.1.1.2 — 550,
после 4.1.1 — 517; этап 4.1
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
- физические solver'ы процессов (4.2.1): планировщик управляет
  порядком и временем, но ни один процесс легаси-химии не получил
  скорость, константу, τ или решателя — реестр перенесён мостом в
  честном состоянии (unknown τ, not_implemented, disabled), ни один
  процесс не активируется автоматически;
- перевод ChemicalEvolution на Scheduler — Stage 4.2.3 (легаси-химия
  продолжает работать как есть, golden-траектория воспроизводится);
- кинетика, термодинамика видов, EOS, равновесие смесей;
- сэмплирование звезды из класса (аудит §2.1) — контракты
  ScientificValue/Reservoir готовы, физика придёт на этапах
  4.6–4.8;
- температурная иерархия (Stage 4.2.2): реализованы КОНТРАКТЫ —
  валидация «только K», BodyThermalState, профиль атмосферы со
  статусами, reservoirTemperature, resolver локальной температуры,
  адаптеры provenance, диагностика пресет/T_eq. Ревизия 4.2.2.1
  добавила строгую проверку формы значений, защиту resolver
  (orphan / unknown-профиль / пустые id), provenance-дисциплину
  адаптеров (T_eq estimated не повышается; teff-диапазон не
  схлопывается) и подключила диагностику и location-aware
  фазовый скрининг к реальному контуру генерации и
  Compatibility (отсутствие локальной температуры — НЕ
  доказанная совместимость). НЕ реализовано и не
  выдаётся за реализованное: RCM и вертикальный профиль (этап 4.8),
  гидростатика, парниковый эффект, вычисление surfaceTemperature
  (остаётся ЯВНО unknown); ни один резервуар/слой не получил
  физическую модель температуры — известные значения приходят
  ТОЛЬКО из явных данных (пресет, фикстура) с provenance;
  легаси-химия продолжает использовать пресетную температуру
  (перевод на локальную температуру — вместе с Scheduler, 4.2.3);
- перевод UI на ядро, перенос форматтеров из App.tsx, удаление
  легаси-ветки bodyPhysics (§2.6) и дублей (§2.7) — в рамках
  Stage 4.2.2 НЕ выполнялись (следующие шаги этапа 4.2: 4.2.3 —
  химия на Scheduler, затем 4.2.4);
- сами миграции создают только версии — значения в старых сохранениях
  не пересчитываются и не «дозаполняются»;
- массово-молярные пересчёты требуют молярной массы вида: неизвестная
  или неподтверждённая масса → not_verifiable, оценочная (estimated) →
  approximate; концентрации, доли и arbitrary_units не пересчитываются
  в моль без дополнительных данных (объём, общий запас).
