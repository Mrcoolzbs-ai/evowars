# CURRENT_SYSTEM_AUDIT — Полный аудит существующей системы

> Stage 4.0. Всё, что описано ниже, сверено с реальным кодом ветки
> `stage-3-planetary-physics` (HEAD a40463c на момент аудита; этап 3.1.2).
> Тесты и CI не считаются доказательством научной полноты — это только
> доказательство согласованности кода с самим собой.
> Ревизия Stage 4.0.1: добавлен §5 — документальные замечания к
> архитектурной СПЕЦИФИКАЦИИ (НЕ ошибки работающего кода).
> Ревизия Stage 4.0.2 (2026-10-30): DA-3 обновлена — фактическая последняя
> версия ATcT: TN 1.228 (ошибка ревизии 4.0.1 «ver. 1.122» исправлена
> по официальной странице atct.anl.gov).
> Ревизия Stage 4.1 (2026-10-30): добавлен §1.16 Core (научное ядро),
> обновлены §1.11 Storage (формат 1.2, делегирование миграций),
> §1.12 types (опциональное coreWorldState), §1.14 Tests (442 теста / 21 файл, CI #24 — подсчёт исправлен в 4.1.1),
§3 (реализовано: контракты ядра) и §4
> (реестр совместимости). Проблемы §2.6/§2.7 помечены «контракты готовы,
> удаление легаси — Stage 4.2». Существующие записи 4.0.x не переписаны.
> Ревизия Stage 4.1.1 (2026-10-30): аудит кода этапа 4.1 нашёл и исправил
> 8 дефектов научной целостности ядра (ISSUE 1–8, см. §1.16); после 4.1.1
> в проекте 517 тестов (21 файл), из них ядро — 246. Коммиты 4.1.1:
> f63c5be → af14dd8 → 25f813e (CI #27 зелёный: tsc 0 ошибок, vitest,
> oxlint, build).
> Ревизия Stage 4.1.1.2 (2026-10-30): корректирующая ревизия —
> 4 остаточных дефекта полноты балансов и защиты хранилища (ISSUE A/B/C/D,
> см. §1.16) и обязательность properties в validateReservoirRecord;
> после 4.1.1.2 в проекте 550 тестов (21 файл), из них ядро — 279.
> Коммиты 4.1.1.2: 35e7b0e → bf3f677 (CI run #30, 41114561545, зелёный).
> Ревизия Stage 4.1.1.3 (2026-10-30): 2 остаточных дефекта — явная
> неприменимость материи в пофазовом аудите (ISSUE A) и словари вместо
> массивов (ISSUE B, см. §1.16); после 4.1.1.3 в проекте 574 теста
> (21 файл), из них ядро — 303. Коммит 4.1.1.3: 00d9985 (CI run #32,
> 41118174329, зелёный).
> Ревизия Stage 4.1.1.3.1 (2026-10-30): строгая проверка записей —
> isPlainRecord принимает только объекты с прототипом Object.prototype
> или null: Map, Set, Date, RegExp и экземпляры пользовательских
> классов не проходят как словари. После 4.1.1.3.1 — 597 тестов
> (21 файл), из них ядро — 326. CI run #34 зелёный.
> Stage 4.2.1 (2026-10-30): фундамент политики времени — WorldClock
> поверх SimulationClock, реестр процессов с честными τ, планировщик
> (Lie/Strang, sub-cycling, очередь событий), InvariantAuditor,
> схема ядра 1.1.0, сохранения 1.3, golden baseline химии
> (877e17d346da3618ec5d15aced90c68da8a4bbb34ff18cb78023e756c1d85b20).
> После 4.2.1 — 672 теста (26 файлов), из них ядро — 401 (14 файлов).
> Коммиты: 63375e9 → eba0a94 → 31f2298 → 8cb8ba3 → 2af6970 (CI runs
> #38–#42; #41 — исправленный отказ теста untimed, #42 зелёный).
> Stage 4.2.1.2 (2026-10-30): аудит контрактов реестра процессов и
> планировщика — 3 остаточных дефекта (ISSUE 1–3, см. §1.16):
> строго положительное числовое τ (τ ≤ 0 — invalid_descriptor,
> fail-closed), запрет дублирующихся processId в macro-шаге и среди
> runtime-операторов ('duplicate_process_id' до первого вызова),
> физические подынтервалы операторов ⊆ [0, dt] (Strang: A [0, dt/2] →
> B [0, dt] → второй A [dt/2, dt]; ранее B получал intervalStartS =
> dt/2 при длительности dt — выход за macro-шаг). После 4.2.1.2 —
> 685 тестов (26 файлов), из них ядро — 414 (14 файлов).
> Stage 4.2.2 (2026-10-30): температурная иерархия и происхождение —
> 6 РАЗДЕЛЬНЫХ температурных понятий (PHYSICS_ARCHITECTURE §5.1)
> получили типизированный носитель в ядре: `Core/thermalState.ts`
> (валидация «только K», BodyThermalState, профиль атмосферы,
> reservoirTemperature, resolveLocalReactionTemperature без ложных
> fallback, ThermalStateError), адаптеры пресетных температур с честным
> provenance (historical_game → «игровое допущение»,
> observational_reference → «справочное, НЕ измерение этого мира»),
> WorldModel больше НЕ копирует пресетную температуру в
> surfaceTemperature (проблема 2.3 закрыта в типизированной части),
> генератор — типизированный фазовый скрининг с temperatureBasis.
> Схема CoreWorldState 1.2.0 (thermalState опционален; миграция
> сохранений 1.3 поле не создаёт). После 4.2.2 — 761 тест (27 файлов),
> из них ядро — 490 (76 новых в coreThermalState.test). Коммиты:
> d706841 → 7dc91ea → 7248b38 → a5888c6 (последний — фикс tsc:
> provenanceOfValue; CI зелёный, golden baseline химии совпадает).
> Stage 4.2.2.1 (2026-10-30): ревизия интеграции по итогам
> независимого аудита 4.2.2 — жёсткая валидация формы температур
> (hasUsableTemperature/temperatureValueOrNull: estimated без
> method, NaN/±Inf/отрицательные, неизвестная единица/размерность
> не пригодны; unknown/not_applicable/not_implemented/invalid не
> превращаются в число), защита resolver (пустые/пробельные id —
> invalid_place; orphan-резервуар; слой из профиля со статусом
> unknown не читается), provenance адаптеров (пояснение пресета —
> в provenance.note, sourceName — только действительный источник;
> teff-диапазон класса не схлопывается в среднее; T_eq из
> EnergyBalance с confidence estimated НЕ повышается до known),
> Compatibility-ревизия «отсутствие локальной температуры — НЕ
> доказанная совместимость» (новое правило
> cradle_temperature_unproven: conditionally_compatible, warning),
> диагностика «пресет vs T_eq» подключена к реальной генерации
> (verdict noted, порог не выдуман), фазовый скрининг —
> location-aware слой surface_boundary
> (PhaseScreeningTemperatureContext). Golden baseline (877e17d3…bc0a)
> совпадает. После 4.2.2.1 — 783 теста (27 файлов), из них ядро —
> 500. Коммиты: a62b7dd → d916fb7 → 59c4ca1 → fcb0876 →
> 78c032a (последние три — корректирующие: tsc-строгости в тестах
> и выравнивание сообщений).
> Stage 4.2.2.2 (2026-10-31): семантика оценки и измерения —
> ревизия по итогам независимого аудита: ошибка совместимости
> колыбели (incompatible/error) — только для известного (known)
> значения локальной среды вне диапазона; оценочное расхождение
> (пресет estimated или легаси-число без происхождения) — ЯВНОЕ
> предупреждение cradle_temperature_estimate_outside_range, а не
> доказанное физическое противоречие; selectCradle такую колыбель
> не отбрасывает; легаси surfaceTemperature без происхождения
> измерением не считается (миграция число сохраняет, provenance не
> выдумывает); presetNotes — всегда пояснение в note, sourceName —
> только из нового явного поля AtmosphereState.presetSourceName;
> PhaseTemperatureBasis.location — структурированное место
> температурного контекста; строгий unknown-скрининг тест
> (customAtmosphere temperature:null), реальный computeEnergyBudget
> integration test (estimated остаётся estimated, surfaceTemperature
> не заполняется); измерено: КАЖДЫЙ мир реалистичного режима несёт
> cradle_temperature_unproven → physically_plausible недостижим,
> обычные миры — hypothetical (статус смешивает правдоподобность
> объектов и полноту знания о локальной среде; предупреждение не
> ослаблено; семантика scientificStatus не менялась). Golden
> baseline (877e17d3…bc0a) совпадает. После 4.2.2.2 — 800 тестов
> (27 файлов), из них ядро — 505. Коммиты: d9a37be → 78526d6 →
> 03ffd69 (последний — корректирующий: rawInput-ключи T_eq);
> CI run 41172263279 зелёный.
> Stage 4.2.2.3 (2026-10-31): provenance gate и location-specific
> evidence — известное (known) без содержательного provenance —
> недоказанность (cradle_temperature_unproven), не ошибка; поверхность
> и океанский резервуар — РАЗНЫЕ источники
> (CradleLocalEnvironment.localReservoirId + resolver, без fallback
> на surface/T_eq/атмосферу/соседние резервуары); легаси-число
> поверхности не используется даже как оценка океана; при пригодном
> typed known легаси-скаляр не читается (нет дублирующего
> предупреждения). Golden baseline совпадает. После 4.2.2.3 — 830
> тестов (27 файлов), ядро — 505. Коммиты: c0e2fb8 → cdfef76; CI run
> 41174155913 зелёный.
> Stage 4.2.2.4 (2026-10-31): корректирующая ревизия после
> независимого аудита — соответствие CradleLocationType ↔
> ReservoirRecord.kind (LOCATION_TYPE_RESERVOIR_KINDS;
> несоответствие — недоказанность cradle_temperature_unproven,
> НЕ ошибка, другой резервуар автоматически не выбирается;
> ’other’ — fail-closed); selectCradle экспортирован, принимает
> опциональный typed evidence (coreWorldState/
> cradleLocalEnvironment → isCradleSupportedOnWorld →
> checkCompatibility) и покрыт интеграционными тестами реального
> selector’а (generateWorld evidence не передаёт — ядро строится
> после выбора колыбели). Golden baseline совпадает. После
> 4.2.2.4 — 848 тестов (27 файлов), ядро — 505. Коммиты:
> 6e7708d1 → 42ab6acc; CI run 41189806931 зелёный.
> Stage 4.2.2.5 (2026-10-31): корректирующая ревизия после
> независимой проверки 4.2.2.4 — candidate-specific локальные
> среды selector’а (карта cradleLocalEnvironmentsById по ID
> кандидата; per-candidate вычисление при отсутствии явной
> среды; перенос среды/localReservoirId/locationType между
> кандидатами исключён); семантика видов: subsurface_reservoir —
> только kind ’crust’ (вид ’ocean’ убран: схема ReservoirRecord
> не различает поверхностный/подземный океан, фикстура не
> обоснование); runtime-неизвестный locationType —
> недоказанность без исключений (fail-closed). Golden baseline
> совпадает. После 4.2.2.5 — 862 теста (27 файлов), ядро — 505.
> Коммиты: 44e93b71 → 356da6e5 → b527aa1f → ff810acd; CI run
> 41192420708 зелёный.
> Stage 4.2.2.5.1 (2026-10-31): узкая корректирующая ревизия —
> защита kind-гейта от prototype pollution: список допустимых
> видов читается только по СОБСТВЕННОМУ ключу таблицы
> (Object.prototype.hasOwnProperty.call); имена унаследованных
> свойств прототипа и произвольные строки — недоказанность без
> исключений и без автоподбора резервуара; комментарий
> таксономии приведён к действующему контракту. Golden baseline
> совпадает. После 4.2.2.5.1 — 863 теста (27 файлов), ядро —
> 505. Коммиты: 9b31419b → 1fad4992; CI run 41207933807 зелёный.
> Stage 4.2.3.1 (2026-10-31): подготовительный подэтап 4.2.3 —
> snapshot-изоляция macro-шага Scheduler: глубокий рабочий снимок
> CoreWorldState (structuredClone) до первого оператора; ошибка
> оператора после на-место-мутаций, самовольное продвижение часов
> или отклонение аудита → rejected БЕЗ частичных изменений
> входного мира; неклонируемое состояние — контролируемый отказ
> до операторов; JSON-раунд-триппинг не используется; контракты
> планировщика и аудитов не изменены; golden baseline совпадает.
> Регрессионные тесты изоляции добавлены в coreScheduler.test.ts;
> итоговые количества — по фактическому CI.
> Stage 4.2.3.2 (2026-10-31): ReactionLedger — самостоятельный
> контракт реакционных транзакций (src/modules/Core/reactionLedger.ts,
> экспорт из Core/index.ts): журнал завершённых транзакций
> (участники с явными резервуарами и положительными коэффициентами,
> extent с явным extentBasis, метка FluxTime | null), иммутабельная
> registerReaction, стехиометрический аудит элементного и
> зарядового баланса с различимыми статусами balanced / imbalanced /
> not_verifiable / approximate (+invalid формы); вид вне каталога и
> непроверяемый dataStatus → not_verifiable (пустые elements не
> доказательство отсутствия атомов), estimated → approximate;
> вымышленные ux:*-компоненты с явным составом алгебраически
> проверяемы без молярной массы. ГРАНИЦЫ ИНТЕГРАЦИИ: ReactionLedger
> НЕ входит в CoreWorldState и не сохраняется; Scheduler и
> InvariantAuditor его НЕ используют; реакции НЕ применяются к
> инвентарям; ни кинетика, ни solver не реализованы; FluxLedger,
> Storage, схема мира и ChemicalEvolution не изменены; golden
> baseline совпадает. Тесты — coreReactionLedger.test.ts; итоговые
> количества — по фактическому CI.
> Ревизия Stage 4.2.3.2.1 (2026-10-31): корректирующая ревизия
> ReactionLedger — 6 дефектов: обязательность time (undefined →
> invalid, а не эквивалент null), прототип-безопасный учёт
> компонентов (Map + Object.fromEntries; 'constructor'/'toString'/
> 'hasOwnProperty'/'__proto__' — данные, не прототип), строгая
> форма состава (только объектная запись; Map/Set/Date/RegExp/
> массив/класс/null → not_verifiable без исключений; численная
> пригодность — только known/estimated; пустой {} легитимен —
> электрон), NaN/Infinity в промежуточных итогах → not_verifiable
> с диагностикой (Infinity − Infinity ≠ balanced), tolerance —
> конечное неотрицательное (некорректное → invalid), note —
> непустая строка, однозначные пары участников (JSON.stringify).
> Границы прежние: ReactionLedger НЕ интегрирован (CoreWorldState,
> Scheduler, InvariantAuditor), FluxLedger, Storage, ChemicalEvolution,
> PRNG и UI не изменены; golden baseline совпадает; итоговые
> количества — по фактическому CI.
> НЕ завершено в 4.2: перевод химии на Scheduler (4.2.3) не
> начат — выполнены только подготовительные подэтапы 4.2.3.1
> (snapshot-изоляция планировщика) и 4.2.3.2 (ReactionLedger —
> самостоятельный контракт реакционных транзакций, НЕ
> интегрированный в мир/аудит/планировщик); 4.2.4 не начаты; RCM
> не реализована (surfaceTemperature = unknown).

## 1. Реестр модулей

Формат записи: назначение / входы / выходы / формулы / допущения / источники /
применимость / достоверность / ограничения / связи / проблемы.

### 1.1 Units (`src/modules/Units/index.ts`, 222 строки)

- **Назначение**: единая система единиц SI и физические константы.
- **Входы/выходы**: константы + функции конвертации (atm↔Па, M⊕↔кг, R⊕↔м, а.е.↔м, годы↔с); `formatPressure` для UI.
- **Формулы**: точные определения (1 atm = 101325 Па, бар = 10⁵ Па).
- **Константы**: G = 6.67430e-11, σ = 5.670374419e-8 (CODATA 2018), M⊕ = 5.9722e24 кг, R⊕ = 6.371e6 м (IAU 2015), L☉ = 3.828e26 Вт (IAU), а.е. = 1.495978707e11 м (IAU 2012), юлианский год = 3.15576e7 с. Каждая константа обёрнута в `PhysValue` с источником.
- **Достоверность**: established; метаданные `UNIT_CONSTANTS_METADATA` ведут себя как мини-каталог provenance.
- **Ограничения/проблемы**: пометка «CODATA 2018» устарела как ярлык: актуальные рекомендованные значения — **CODATA 2022** (проверено: официальная карточка NIST, physics.nist.gov/cuu/pdf/wallet_2022.pdf). Используемые цифры (G = 6.67430e-11 и др.) в CODATA 2022 не изменились, поэтому численного исправления не требуется — только обновление ссылки. Не ошибка, а задача гигиены данных (Stage 4.3).

### 1.2 OrbitalMechanics (508 строк)

- **Назначение**: структурная модель центрального объекта, сэмплирование орбиты, поток и равновесная температура.
- **Входы**: каталоги (centralObjects, celestialBodies, epochs, starPhysical), PRNG.
- **Выходы**: `CentralObjectSystem`, `OrbitalConfigurationData` (PhysValue-поля).
- **Формулы**:
  - F = L / (4πa²);
  - T_eq = [F(1−A)·f / (4εσ)]^(1/4), A = 0.3, f = 1, ε = 1 по умолчанию;
  - P = 2π·√(a³/(G·M)) (III закон Кеплера, репрезентативная масса класса);
  - лог-равномерное сэмплирование a из модельных диапазонов `ORBIT_BANDS` (0.05–50 а.е. по классам).
- **Допущения**: орбитальные диапазоны — игровые (game_assumption); устойчивость не проверяется (`stabilityCheck: 'not_performed'`); наклонение не моделируется; приливный захват — качественный.
- **Источники данных**: репрезентативные светимости/массы классов из `Data/starPhysical` (диапазоны классов, не конкретные звёзды).
- **Применимость**: классы каталога (8 типов центральных объектов). За каталогом — `null`.
- **Достоверность**: поток/период — derived (при известных L, M); полуось/эксцентриситет — game_assumption.
- **Ограничения**: нет эволюции орбиты, нет N-body, нет резонансов, нет приливного расчёта, нет теней/затмений для спутников.
- **Связи**: EnergyBalance (переиспользует `incidentFlux`, `equilibriumTemperature`), Generator, Compatibility, тесты orbital/planetPhysics.
- **Проблемы**: см. §2.1 (репрезентативная светимость класса как конкретная), §2.2 (T_eq не передаётся дальше).

### 1.3 EnergyBalance (131 строка)

- **Назначение**: связывание орбиты и центрального объекта с потоком и T_eq; объединение с уровнем внутреннего тепла из Geology.
- **Входы**: `centralObjectId`, `centralObjectSystem?`, `orbit?`, `geologyAnalysis?`.
- **Выходы**: `EnergyBudgetModel` (incidentFlux, equilibriumTemperature — PhysValue; assumptions[]; internalHeatLevel — качественный уровень).
- **Формулы**: те же F и T_eq; допущения зафиксированы в `ENERGY_BUDGET_ASSUMPTIONS`.
- **Достоверность**: derived при известных L и a; иначе unknown (null, не ноль).
- **Ограничения**: T_eq ≠ T_surface — зафиксировано в `greenhouseNote`; вклад недр в поверхностный баланс не считается.
- **Связи**: OrbitalMechanics, Data/starPhysical, Geology (односторонне).
- **Проблемы**: §2.2 — вычисленный T_eq никуда не передаётся (см. также §2.3).

### 1.4 Geology (286 строк)

- **Назначение**: качественный анализ источников внутреннего тепла.
- **Входы**: celestialBody, centralObject, orbit.
- **Выходы**: `GeologicalAnalysis`: primordial/radiogenic/tidal (level: high/moderate/low/negligible | null, status potential/not_estimated), totalInternalHeat, geothermalEnergyAvailable, volcanism/hydrothermal/subsurface (boolean | null), geochemicalGradients[].
- **Формулы**: только свёртка уровней (максимум + усиление при ≥2 заметных источниках). **Вт не вычисляются** — явно задокументировано.
- **Допущения**: радиогенный нагрев тел солнечной системы — по классу; для спутников без данных о составе — null.
- **Достоверность**: estimated/hypothetical по источнику.
- **Ограничения**: нет количественной модели недр, EOS, теплопроводности, вулканизма как потока.
- **Связи**: EnergyBalance (передаёт totalInternalHeat), Generator, тесты geology.
- **Проблемы**: уровень «high/moderate» — качественная свёртка; при подключении количественных источников (этап 4.7) карту уровней нужно сохранить как UI-проекцию, а не как физическую величину.

### 1.5 PhaseEquilibrium (446 строк)

- **Назначение**: скрининг фазовых состояний атмосферных компонентов; резервуары вещества.
- **Входы**: `AtmospherePhysicalModel` (парциальные давления), температура, данные `Data/phaseProperties`.
- **Выходы**: `AtmospherePhaseAnalysis` (по компонентам: state, S_i, P_sat, extrapolated), `SubstanceReservoirs`, перенос `transferSubstance` с сохранением количества.
- **Формулы**:
  - Antoine: log10(P/бар) = A − B/(T + C), наборы для CH₄ (Prydz & Goodwin 1972 через NIST) и C₂H₆ (два набора, 91–200 K);
  - S_i = p_i / P_sat,i (скрининг);
  - закон Рауля (p = x·P_sat) как идеализированный скрининг с предупреждением.
- **Источники**: NIST Chemistry WebBook (Antoine, критические точки) — с ссылками и диапазонами применимости в каждой записи; экстраполяция помечается.
- **Достоверность**: established (корреляции), derived (S_i), при этом EOS (PR/SRK) и равновесие смеси явно НЕ реализованы (`EOS_NOT_IMPLEMENTED_NOTE`).
- **Ограничения**: чистые вещества; многокомпонентное равновесие не считается; конденсированное количество не вычисляется.
- **Связи**: Atmosphere (вход), ChemicalEvolution (резервуары), Data/phaseProperties.
- **Проблемы**: §2.3 — температура для скрининга берётся из пресета атмосферы, а не из какого-либо термического контура.

### 1.6 ChemicalEvolution (685 строк)

- **Назначение**: стехиометрический движок химической эволюции атмосферного инвентаря.
- **Входы**: `ChemicalEvolutionState` (инвентарь, режимы `column_inventory` (моль/м²) | `game_normalized`), каталог реакций (4 реакции), элементные составы.
- **Выходы**: записи шагов (`ChemicalStepRecord`: extent, лимитирующий реагент, изменения, confidence), обновлённый инвентарь/резервуары/давление, кислородный баланс шага, `modelTimeYears += stepDurationYears`.
- **Формулы/механика**:
  - проверка элементного баланса каждой реакции (атомные counts из `elementCompositions`);
  - extent = extentFraction × min(inventory_i/коэфф_i) — лимитирующий реагент;
  - `computeOxygenBalance(records, mode)` — по явному набору записей (Stage 3.1.2): производство/потребление O₂ за шаг; пустой набор → нули;
  - режим B (`runKineticStep`) честно возвращает «не рассчитано» — кинетических данных нет.
- **Допущения**: степень превращения за шаг — игровая (происходит из `gameSpeedCoefficient` каталога реакций: 0.05–0.5, помечено как игровое); длительность шага — явное игровое допущение.
- **Источники**: стехиометрия — established (формулы реакций); скорости — отсутствуют (не выдуманы).
- **Ограничения**: нет кинетики, термодинамики, фотохимии, растворения, источников/стоков (реестр `ChemicalProcess` существует, `ratePerStep = null`).
- **Связи**: Atmosphere (синхронизация долей и давления), PhaseEquilibrium (резервуары), App.tsx (`runChemicalEvolutionStep`), тесты chemical (включая 3.1.2-сценарии).
- **Проблемы**: §2.4 (температурные пороги реакций из каталога сопоставляются с температурой пресета), §2.5 (обратные реакции и равновесие отсутствуют — стехиометрия单向).

### 1.7 Atmosphere (733 строки)

- **Назначение**: пресеты атмосфер (исторические игровые + справочные), нормализация, валидация, физическая модель столба.
- **Входы**: `AtmosphereState` (проценты компонентов, totalPressure в atm, temperature), каталог gases, гравитация.
- **Выходы**: `AtmospherePhysicalModel`: молярные доли, P_surf (Па), M смеси, p_i, столб m = P/g, n = P/(g·M), один слой (`surface_boundary`).
- **Формулы**: x_i = pct_i/Σpct; p_i = x_i·P (идеальный газ); m = P/g; n = P/(g·M).
- **Допущения**: идеальный газ (помечено), гидростатический столб; неидеальность — только предупреждение (`fugacityNote`).
- **Источники**: пресеты Земли/Венеры/Марса/Титана — справочные составы с погрешностью; исторические пресеты помечены `presetKind: 'historical_game'`.
- **Достоверность**: derived для столба; состав пресетов — established (справочный) или historical_game.
- **Ограничения**: один слой; без вертикального переноса, фотохимии, облаков, парника, утечки.
- **Связи**: PhaseEquilibrium, ChemicalEvolution, Generator, App, тесты atmosphere/atmospherePhysics.
- **Проблемы**: §2.3 — температура/давление пресета используются как физические входы фазового скрининга и химии; прямого использования T_eq нет. Пресетная температура Титана (95 K) помечена historical_game — корректно, но потребитель должен видеть это.

### 1.8 WorldModel (734 строки)

- **Назначение**: физические характеристики тела, локальная среда колыбели, описания.
- **Формулы**: ρ = M/(4/3·π·R³); g = G·M/R²; диапазон плотности 1000–13000 кг/м³ как фильтр сэмплирования (≤40 попыток, честная пометка plausible: false).
- **Входы/выходы**: `sampleBodyPhysics` (сэмпл из диапазонов каталога), `calculateBodyCharacteristics` (легаси-средние ИЛИ сэмпл), `calculatePhysicalCharacteristics`, колыбельные среды, описания.
- **Достоверность**: estimated (сэмпл), derived (ρ, g).
- **Связи**: Units, Generator, Compatibility, Storage (описания), тесты planetPhysics.
- **Проблемы**: §2.6 — **двойной путь вычисления** (легаси-средние диапазонов и Stage-3 сэмплирование). При отсутствии bodyPhysics UI показывает среднее диапазона — две разные «правды» для одного мира.

### 1.9 Generator (709 + 173 + 7 строк)

- **Назначение**: детерминированная генерация мира по seed.
- **PRNG**: Mulberry32 (хеш seed → состояние; проверен тестами: детерминизм, распределение).
- **Причинная цепочка**: космология → эпоха → центральный объект → тело → атмосфера → сэмплирование физики тела → центральная система → орбита → атмосферная физика → фазовый скрининг → геология → энергобюджет → химический инвентарь → колыбель → совместимость.
- **Достоверность**: выборки — estimated; сами каталоги — смесь established (составы) и game_assumption (диапазоны).
- **Проблемы**: сэмплирование массы и радиуса независимо + rejection по плотности — смещённое распределение (задокументировано «estimated»; целевое исправление — зависимость масса-радиус на этапе 4.7, не сейчас).

### 1.10 Compatibility (706 строк)

- **Назначение**: правила совместимости на РЕАЛЬНЫХ данных мира; аномальный режим отключает только правила с `exemptInAnomalousMode`.
- **Связи**: Generator, WorldModel, Data/starPhysical (время жизни звёзд).
- **Проблемы**: правила включают качественные эвристики (пороги эпох) — их нужно переводить в явные PhysValue-параметры по мере роста физики.

### 1.11 Storage (604 строки)

- **Назначение**: localStorage; версия формата `STORAGE_FORMAT_VERSION` = 1.1 с миграцией; экспорт JSON/Markdown, импорт.
- **Проблемы**: нет — это готовая основа для версионирования схемы (целевое требование §15). Экспорт Markdown — игровая проекция.
- **Ревизия Stage 4.1**: `STORAGE_FORMAT_VERSION` = '1.2'; версия и цепочка
  миграций ведутся реестром `Core/migrations` (SUPPORTED_SAVE_VERSIONS =
  ['1.0','1.1','1.2']); `migrateWorld` делегирует `migrateSavedWorld`.
  Экспорт Markdown дополнен секцией «Научное ядро (этап 4.1)». Легаси-семантика
  хранения не изменена; поля не пересчитываются, null не становится 0.
- **Ревизия Stage 4.2.1**: `STORAGE_FORMAT_VERSION` = '1.3'
  (SUPPORTED_SAVE_VERSIONS = ['1.0','1.1','1.2','1.3']); миграция 1.2 → 1.3
  не создаёт scheduling и не переносит химическое modelTimeYears в локальные
  секунды WorldClock; сохранения без coreWorldState остаются без него;
  старые значения не пересчитываются.

### 1.12 types/physics.ts (465 строк) и types/index.ts (543 строки)

- `PhysValue`, `ScientificConfidence`, структурные типы центральных объектов (звезда/остаток/субзвёздный/газовый гигант/джет), орбита, энергобюджет, атмосфера, фазы, резервуары, химия, геология.
- **Оценка**: одна из самых сильных частей системы — provenance-обёртка уже на месте. Целевые расширения — категории происхождения и версионирование данных (см. SCIENTIFIC_FOUNDATION §4).
- **Ревизия Stage 4.1**: в `GeneratedWorld` добавлено ОПЦИОНАЛЬНОЕ поле
  `coreWorldState?: CoreWorldState` (тип-only импорт из ядра, цикла нет).
  Отсутствие поля = «ядро для мира не инициализировано», а не нулевое
  состояние; миграции его не создают и не заполняют задним числом.

### 1.13 Data (каталоги)

| Файл | Содержимое | Достоверность |
|---|---|---|
| starPhysical.ts (435) | классы центральных объектов: диапазоны массы/светимости/T_eff, earliestUniverseAgeGyr, typicalLifetimeGyr | estimated/derived, с источниками-описаниями |
| phaseProperties.ts (265) | Antoine CH₄ (90.99–189.99 K), C₂H₆ (2 набора), критические/тройные точки | established, NIST WebBook с библиографией |
| chemicalReactions.ts (97) | 4 реакции окисления: стехиометрия, allowedRanges (T, P), gameSpeedCoefficient | стехиометрия established; коэффициенты/диапазоны — game_assumption |
| gases.ts (167) | 12 веществ: молярная масса, состояния, источники/стоки (качественно) | молярная масса established; источники/стоки — качественные описания |
| elementCompositions.ts (44) | атомные составы для проверки баланса | established |
| celestialBodies.ts (116), centralObjects.ts (161), cosmologies.ts (148), cradles.ts (116), epochs.ts (41) | игровые каталоги с massRange/radiusRange, scientificStatus | смесь established/hypothetical/game_assumption — научный статус указан в полях |

### 1.14 Tests и CI

- units, random (PRNG-детерминизм), generator (+физика причинной цепочки), atmosphere (+физика столба), phase, geology, orbital (солнечная постоянная ~1361 Вт/м², периоды), planetPhysics (g≈9.82, столб Земли ≈10332 кг/м²), chemical (стехиометрия, баланс O₂, сценарии A–F), compatibility.
- CI (GitHub Actions): tsc -b (strict), vitest, oxlint, build. Известные не-блокирующие предупреждения: setState-in-effect в App.tsx (L30/625/809), deprecation Node 20 в actions.
- **Оценка**: хорошее покрытие формул-инвариантов (уровень 1) и аналитических проверок (уровень 2 частично). Отсутствуют: эталонные планетарные сценарии с допусками (уровень 3), чувствительность (уровень 5).
- **Ревизия Stage 4.1** (подсчёт уточнён в 4.1.1): 21 файл, 442 теста
  (CI #24, HEAD ab9c9ab; в ревизии 4.1 ошибочно указано 438), из них 171 —
  ядро этапа 4.1 (9 файлов core*.test.ts: физические величины,
  ScientificValue, виды, резервуары, потоки, часы, состояние мира,
  solver-контракт, миграции + адаптеры + PRNG-регрессия).
- **Ревизия Stage 4.1.1**: 21 файл, 517 тестов, из них 246 — ядро
  (Stage 4.1 + 75 регрессионных тестов на 8 исправленных дефектов в
  coreReservoir, coreFluxLedger, coreWorldState, corePersistence).
  CI run #27 (HEAD 25f813e) зелёный: tsc 0 ошибок, все тесты прошли,
  oxlint без новых предупреждений, build успех.
- **Ревизия Stage 4.1.1.2**: 21 файл, 550 тестов, из них 279 — ядро
  (246 после 4.1.1 + 33 регрессионных теста на ISSUE A/B/C/D и
  обязательность properties: 19 в coreFluxLedger, 7 в corePersistence,
  4 в coreWorldState, 3 в coreReservoir). CI run #30 (41114561545,
  HEAD bf3f677) зелёный: tsc 0 ошибок, vitest, oxlint, build.
- **Ревизия Stage 4.1.1.3**: 21 файл, 574 теста, из них 303 — ядро
  (279 после 4.1.1.2 + 24 регрессионных теста на ISSUE A/B: 11 в
  coreFluxLedger, 10 в coreReservoir, 3 в coreWorldState; фактические
  итоги Vitest «Test Files 21 passed (21) / Tests 574 passed (574)»
  публикуются notice-аннотацией шага Tests — страницы логов GitHub
  Actions требуют входа в аккаунт). CI run #32 (41118174329,
  HEAD 00d9985) зелёный: tsc 0 ошибок, vitest, oxlint, build.
- **Ревизия Stage 4.1.1.3.1**: 21 файл, 597 тестов, из них 326 —
  ядро (303 + 23 регрессионных теста строгой проверки записей:
  Map/Set/Date/RegExp/экземпляры классов не принимаются за словари
  ни в одной точке валидации; пустой {} и Object.create(null)
  валидны). CI run #34 зелёный.
- **Stage 4.2.1**: 26 файлов, 672 теста, из них 401 — ядро (14
  файлов: 9 прежних + coreChemicalGoldenBaseline, coreWorldClock,
  coreProcessRegistry, coreScheduler, coreInvariantAuditor; новые
  тесты 4.2.1 — 64 в четырёх файлах (11 + 15 + 23 + 15), 4 golden,
  7 scheduling/миграционных в coreWorldState/corePersistence).
  Фактические итоги Vitest «Test Files 26 passed (26) / Tests 672
  passed (672)» публикуются notice-аннотацией шага Tests; golden
  baseline публикуется отдельной notice-аннотацией. CI run #42
  (41128350834, HEAD 2af6970; первый прогон #41 41128163714 —
  исправление теста untimed-области в coreInvariantAuditor) зелёный:
  tsc 0 ошибок, vitest, oxlint, build.
- **Stage 4.2.1.2**: 26 файлов, 685 тестов, из них 414 — ядро
  (14 файлов; +13 регрессионных тестов контрактов аудита: 6 в
  coreProcessRegistry — 21 итого, 7 в coreScheduler — 30 итого).
  Новые контракты: строго положительное числовое τ (τ ≤ 0 —
  invalid_descriptor, tauSeconds fail-closed → null, не
  autorunnable, Scheduler не запускает даже при прямом вызове);
  дублирующиеся processId в processIds и среди runtime-операторов —
  duplicate_process_id до вызова первого оператора (исходный мир и
  часы не изменяются); физические подынтервалы операторов ⊆ [0, dt]
  (Strang: A [0, dt/2] → B [0, dt] → второй A [dt/2, dt]). Фактические
  итоги Vitest «Test Files 26 passed (26) / Tests 685 passed (685)»
  сверяются с notice-аннотацией шага Tests; golden baseline
  (877e17d3…bc0a) не изменился.
- **Stage 4.2.2**: 27 файлов, 761 тест, из них 490 — ядро (15
  файлов: 14 прежних + coreThermalState.test — 76 новых проверок:
  термодинамическая валидация «только K», профиль атмосферы
  (single_layer_estimate/limitations), BodyThermalState в
  validateWorldState (схема 1.2.0, invalid_thermal_state),
  reservoirTemperature (invalid_reservoir), адаптеры пресетов с
  provenance, resolver локальной температуры (отказ fallback на
  T_eq/surfaceTemperature/соседние области, честный unknown,
  ThermalStateError invalid_place/invalid_threshold),
  diagnosePresetEquilibriumDivergence, типизированный фазовый
  анализ (числовое совпадение с легаси), регрессии пресетов
  (methane_ethane 95 K ≠ titan_reference 94 K, earth/venus/mars).
  Фактические итоги Vitest «Test Files 27 passed (27) / Tests 761
  passed (761)» сверяются с notice-аннотацией шага Tests; golden
  baseline (877e17d3…bc0a) совпадает. Обновлён generator.test:
  пресетная температура (288/95 K) больше НЕ появляется в
  physicalCharacteristics.surfaceTemperature. CI зелёный:
  tsc 0 ошибок, vitest, oxlint, build.
- **Stage 4.2.2.1**: 27 файлов, 783 теста (+22: 8 compatibility.test,
  10 coreThermalState.test, 4 generator.test), из них ядро — 500.
  Ревизия интеграции: Compatibility cradle_temperature_unproven
  (отсутствие локальной температуры → conditionally_compatible
  warning, а НЕ молчаливый true; вне диапазона → error; known /
  estimated / unknown различимы; isWorldCompatible различает
  условную совместимость и отсутствие проверки), диагностика
  «пресет vs T_eq» в реальной генерации (детерминизм, температуры
  не изменяются), location-aware фазовый скрининг (слой
  surface_boundary, статус/provenance сохранены, без fallback на
  T_eq), строгая форма температур, orphan-резервуар, unknown-профиль
  резолвера, provenance адаптеров (presetNotes → note,
  teff-диапазон, T_eq estimated не повышается до known).
  Фактические итоги Vitest «Test Files 27 passed (27) / Tests 783
  passed (783)» сверяются с notice-аннотацией шага Tests; golden
  baseline (877e17d3…bc0a) совпадает. CI зелёный: tsc, vitest,
  oxlint, build.
- **Stage 4.2.2.2**: 27 файлов, 800 тестов (+17: 10 compatibility.test,
  5 coreThermalState.test, 2 generator.test), из них ядро — 505.
  Семантика оценки vs измерения: known вне диапазона — error,
  estimated вне диапазона — предупреждение
  cradle_temperature_estimate_outside_range (НЕ физическая
  ошибка), estimated в диапазоне — условная совместимость,
  unknown — предупреждение о недоказанности; легаси
  surfaceTemperature без происхождения — не proof
  (миграция сохраняет число без выдуманного provenance);
  historical_game остаётся игровым допущением,
  observational_reference не становится known конкретного мира;
  isCradleSupportedOnWorld не отбрасывает кандидата из-за
  оценочного расхождения; presetNotes ≠ sourceName (источник —
  только явное поле presetSourceName); PhaseTemperatureBasis.
  location ({kind:'atmosphere_layer', layerId}); строгий
  unknown-скрининг тест (customAtmosphere temperature:null — все
  компоненты unknown, T_eq не подставлена); РЕАЛЬНЫЙ
  computeEnergyBudget integration test (estimated сохранён,
  метод/uncertainty/rawInput перенесены, surfaceTemperature не
  заполняется); измерение 25 сидов: все миры реалистичного режима
  несут cradle_temperature_unproven → hypothetical. Фактические
  итоги Vitest «Test Files 27 passed (27) / Tests 800 passed
  (800)» сверяются с notice-аннотацией шага Tests; golden baseline
  (877e17d3…bc0a) совпадает. CI зелёный: tsc, vitest, oxlint,
  build (run 41172263279).
- **Stage 4.2.2.3**: 27 файлов, 830 тестов (+30 к 4.2.2.2: 26
  compatibility.test, 4 generator.test), из них ядро — 505 (новых
  core-тестов нет). Покрытие: evidence gate (known без provenance /
  пустой {} / note-только — недоказанность, не ошибка; непригодные
  формы (invalid, не та единица, NaN, отрицательные) не
  доказательство; method/rawInput — валидное происхождение;
  estimated не повышается), поверхность ≠ океан (surface known не
  подтверждает/не опровергает океан; резервуар known ± provenance
  вне/в диапазоне; без reservoir ID / без температуры / unknown /
  estimated / чужое тело / несуществующий ID → недоказанность или
  предупреждение; subsurface через резервуар), приоритет typed над
  легаси-скаляром (нет дублирующего предупреждения), запрет
  fallback, реальный путь isCradleSupportedOnWorld (доказанное
  known-нарушение исключает колыбель из автоматического выбора;
  оценка/unknown — нет). Фактические итоги Vitest «Test Files
  27 passed (27) / Tests 830 passed (830)»; tsc, oxlint, build
  зелёные (run 41174155913); golden baseline (877e17d3…bc0a) совпал.
- **Stage 4.2.2.4**: 27 файлов, 848 тестов (+18 к 4.2.2.3: 11
  compatibility.test, 7 generator.test), из них ядро — 505
  (новых core-тестов нет). Покрытие: соответствие вида резервуара
  локальной среде (ocean + kind ’atmosphere’/’ice’ даже при known и
  provenance — недоказанность, не физическая ошибка; subsurface/
  deep с заведомо несовместимым kind — не принимается как
  доказательство; правильный kind + known вне/в диапазоне —
  доказанная ошибка/доказанная проверка; правильный kind +
  estimated — warning без incompatible/error; чужое тело —
  прежняя защита) и интеграционные тесты самого selectCradle
  (known в диапазоне — кандидат доступен; known-нарушение
  исключает при допустимой альтернативе; estimated вне диапазона
  и unknown — условные кандидаты; без typed evidence не
  выдумывается; fixedCategories.cradle — прежняя семантика;
  детерминизм — фиксированная фикстура и нулевые веса).
  Фактические итоги Vitest «Test Files 27 passed (27) / Tests 848
  passed (848)»; tsc, oxlint, build зелёные (run 41189806931);
  golden baseline (877e17d3…bc0a) совпал.
- **Stage 4.2.2.5**: 27 файлов, 862 теста (+14 к 4.2.2.4: 12
  generator.test, 2 compatibility.test), из них ядро — 505
  (новых core-тестов нет). Покрытие: candidate-specific локальные
  среды selector’а — в одном selectCradle-вызове кандидаты
  четырёх локаций (ocean / atmosphere / subsurface_reservoir /
  deep_planetary_layers), каждый по собственной среде; среда
  одного кандидата (locationType, состав, localReservoirId) не
  применяется к другому; known-нарушение океанической колыбели
  исключает только её кандидата при допустимой альтернативе;
  атмосферная колыбель требует H₂/He по собственному составу;
  правило давления и cradle_matter_state_location — по
  расположению текущего кандидата; estimated вне диапазона и
  unknown — условные кандидаты, не hard error; без reservoir ID
  для кандидата температура не подставляется; fallback
  (warn_cradle_support_fallback) и ручная фиксация — прежние;
  нулевые веса по-прежнему исключают кандидатов; без typed
  evidence selector не изобретает температуру; детерминизм —
  фиксированная фикстура и повторный вызов. Семантика видов:
  subsurface+kind ’ocean’ + known 700 (в диапазоне 647–1000) —
  недоказанность, не ошибка (фикстура таксономию не обосновывает);
  фикстура доказательства подземной среды переведена на
  допустимый вид ’crust’. Runtime-безопасность: некорректный
  runtime locationType (явно приведённая фикстура) — без
  исключения, недоказанность, другой резервуар не выбирается.
  Фактические итоги Vitest «Test Files 27 passed (27) / Tests 862
  passed (862)»; tsc, oxlint, build зелёные (run 41192420708);
  golden baseline (877e17d3…bc0a) совпал.
- **Stage 4.2.2.5.1**: 27 файлов, 863 теста (+1 к 4.2.2.5:
  compatibility.test), из них ядро — 505 (новых core-тестов
  нет). Покрытие: защита kind-гейта от prototype pollution —
  LOCATION_TYPE_RESERVOIR_KINDS наследует свойства
  Object.prototype, поэтому lookup по ’constructor’/’toString’/
  ’hasOwnProperty’/’__proto__’ вернул бы унаследованные значения,
  а последующий .includes() — TypeError; теперь читается только
  СОБСТВЕННЫЙ ключ (hasOwnProperty): все 5 некорректных
  runtime-значений (плюс ’hydrothermal_sinter’) проверены через
  РЕАЛЬНЫЙ путь checkCompatibility — без исключения, без ошибки
  cradle_temperature_compatibility, с недоказанностью и без
  автоподбора (декой-резервуар kind ’crust’ с доказанной
  неприемлемой 288 K не становится «доказательством»).
  Фактические итоги Vitest «Test Files 27 passed (27) / Tests 863
  passed (863)»; tsc, oxlint, build зелёные (run 41207933807);
  golden baseline (877e17d3…bc0a) совпал.

### 1.16 Core — научное ядро (Stage 4.1, `src/modules/Core/`, 11 файлов)

- **Назначение**: канонические контракты научных данных и инвариантов,
  не зависящие от легаси-модулей: PhysicalQuantity (значение+единица+
  размерность, запрет NaN/±Inf, реестр ASCII-единиц, русские единицы
  только через адаптер), ScientificValue (6 статусов данных, uncertainty,
  provenance; «неизвестно» ≠ 0), ScientificSpecies (вид+фаза, элементный/
  зарядовый баланс), Reservoir (инвентарь с явным basis; энергия: запас/
  мощность/поток раздельно), FluxLedger (внутренние/внешние переносы,
  rate≠integrated, атомарность, revert, аудиты сохранения вещества/
  элементов/заряда/энергии), ReactionLedger (4.2.3.2: журнал
  завершённых реакционных транзакций; стехиометрический аудит
  элементов/заряда; самостоятельный контракт — пока НЕ входит в
  CoreWorldState и не используется Scheduler/InvariantAuditor),
  SimulationClock (сегментация против потери
  точности; космический возраст — отдельно), CoreWorldState (гравитация
  и излучение — раздельные записи; validateWorldState), SolverBackend
  (честный контракт: probe-проверка заявлений, planned ≠ available),
  migrations (1.0→1.1→1.2, идемпотентность, null≠0), adapters (PhysValue/
  GeneratedWorld → ядро с сохранением метода, источника, семантики
  неизвестности).
- **Входы**: типы `src/types/physics.ts` (только чтение, без цикла).
- **Выходы**: `GeneratedWorld.coreWorldState?`, делегирование миграций
  в Storage, тесты core*.
- **Ограничения**: реализованы КОНТРАКТЫ и инварианты, не модели.
  Solver-бэкенды пустые (все solve → not_implemented); кинетика,
  термодинамика, EOS, равновесия не реализованы; UI не переключён.
- **Документация**: `docs/science/CORE_SCIENTIFIC_ENGINE.md`.
- **Связи**: легаси-модули (Generator, ChemicalEvolution, Units,
  WorldModel) не изменены; связь только через адаптеры.
- **Ревизия Stage 4.1.1 — 8 дефектов научной целостности, исправленных
  аудитом кода** (все подтверждены в коде ДО правки на HEAD ab9c9ab;
  исправлены в 25f813e):
  1. reservoir: massToAmount делил сырое значение (г!) на кг/моль без
     convert; amountToMass не проверял переполнение — теперь convert
     ДО умножения/деления, переполнение → QuantityError 'overflow';
  2. fluxLedger: elementTotals/chargeTotal были basis-слепы, аудиты
     возвращали balanced:true при исключённых видах — теперь basis-aware
     молярная семантика и balanced:true только при полном 'balanced';
  3. fluxLedger: аудиты сверяли только суммарный запас и все applied-записи
     без временной области; applyFlux молча создавал пустой инвентарь —
     теперь FluxAuditScope (after < t <= upTo, untimed-записи
     перечисляются), отсутствующий инвентарь → unknown_inventory;
  4. fluxLedger: энергетический applyFlux менял только статус, НЕ меняя
     storedJ; revertFlux для энергии ничего не делал — теперь энергия
     РЕАЛЬНО переносится и возвращается;
  5. worldState: валидация резервуаров/потоков/schemaVersion была
     поверхностной — теперь validateReservoirRecord + validateFluxLedger
     + строгий список поддерживаемых версий схемы ('1.0.0');
  6. migrations: любая неизвестная версия ('2.0','1.3','abc') тихо
     трактовалась как 1.0 — теперь MigrationError (unsupported_version /
     invalid_version / missing_migration_path), undefined → легаси 1.0
     с честной записью;
  7. Storage: одна битая запись прятала все миры в getAllWorlds;
     saveWorld/deleteWorld могли стереть несовместимые записи — теперь
     raw-изоляция каждой записи + getStorageHealth, несовместимые
     записи сохраняются как есть;
  8. adapters: '%' не масштабировался (50 → «50 долей» вместо 0.5);
     у unknown терялся provenance; invalid получал фиктивную unit '1' —
     исправлено (×0.01, provenance сохраняется, quantity не создаётся).
- **Ревизия Stage 4.1.1.2 — 4 остаточных дефекта полноты балансов и
  защиты хранилища + валидация записи** (подтверждены в коде ДО правки
  на HEAD 19efd6c; исправлены в 35e7b0e → bf3f677):
  A. fluxLedger: reservoirsToMolarCounts молча исключал резервуар без
     material (`if (!res.material) continue`) — неизвестный запас
     превращался в ноль, и баланс мог сойтись ложно; теперь три
     состояния разделены: material отсутствует → not_verifiable
     (запас неизвестен, не ноль), entries = {} → известная пустота,
     entries[species] = 0 → известный ноль; явный materialApplicability
     'not_applicable' законно выводит резервуар из материального
     баланса (неприменимость НЕ выводится из отсутствия поля;
     конфликт material + not_applicable и мусорное значение — ошибки
     валидации);
  B. fluxLedger: auditReservoirFluxes проверял только резервуары из
     expected (затронутые потоками) — изменение резервуара без записи
     потока (A→B применён, C вырос на 50 моль из ниоткуда) проходило
     молча; теперь проверяется объединение «до» ∪ «после» ∪
     затронутых: нетронутый резервуар с известным инвентарём обязан
     иметь Δ = 0; непроверяемые вклады дают exclusions, которые
     делают итог not_verifiable — balanced при непроверенных
     обязательных вкладах невозможен;
  C. fluxLedger: применённые integrated-записи без времени,
     исключённые ограниченной областью (FluxAuditScope), не мешали
     статусу balanced (untimedRecords.length > 0 при status ===
     'balanced' было возможно); теперь untimed-барьер во всех
     глобальных аудитах и в auditReservoirFluxes: untimed-исключения
     → not_verifiable; includeUntimed: true — на ответственность
     вызывающего; запись с временем ВНЕ диапазона — другая
     диагностика (не untimed), статус суммарного аудита области
     не отравляется;
  D. Storage: saveWorld игнорировал parseError от readRawEntries и мог
     перезаписать повреждённое хранилище новым массивом (уничтожение
     нечитаемых данных); теперь при повреждённом корневом JSON
     saveWorld бросает структурированную StorageError
     'storage_unreadable' (исходная строка НЕ меняется), deleteWorld
     возвращает false без записи; getStorageHealth() сохраняет
     диагностику; несовместимые raw-записи (2.0) по-прежнему не
     удаляются; clearAllWorlds() — явная очистка осталась;
  E. validateReservoirRecord: properties — ОБЯЗАТЕЛЬНОЕ поле записи
     (раньше отсутствие проходило молча, проверка была условной);
     отсутствующие material/energy — отдельные состояния, не ошибки;
     storedJ = null допустим; NaN/±Inf/отрицательный запас — ошибки.
- **Ревизия Stage 4.1.1.3 — 2 остаточных дефекта materialApplicability
  и формы записей** (подтверждены в коде ДО правки на HEAD a5e6065;
  исправлены в 00d9985):
  A. fluxLedger: auditReservoirFluxes при отсутствии material в ОБОИХ
     состояниях без материальных потоков молча пропускал материальное
     измерение (materialMandatory = false → ни проверки, ни
     исключения) — противоречие с reservoirsToMolarCounts, где
     отсутствие material без маркера уже означало неизвестный запас:
     глобальный аудит давал not_verifiable, пофазовый — balanced;
     теперь единственное законное основание пропуска измерения —
     materialApplicability = 'not_applicable' в ОБОИХ состояниях;
     маркер только в одном состоянии — «переход неприменимости не
     подтверждён» (not_verifiable); отсутствие material без маркера —
     исключение «запас неизвестен и не приравнивается к нулю»
     (not_verifiable); энергетические буферы обязаны объявлять
     нематериальность явно (energyFixture в тестах); материальная и
     энергетическая применимость не смешиваются;
  B. reservoir: проверки typeof 'object' пропускали массивы —
     properties: [] и material.entries: [] проходили как «пустые
     словари», inventoryToMolarCounts через spread пустого массива
     давал «известную пустоту», totalInventory агрегировал бы
     индексные ключи; теперь isPlainRecord (объект, не null, не
     массив) в validateReservoirRecord, validateMaterialInventory,
     inventoryToMolarCounts (массив → not_verifiable, а не «известный
     пустой инвентарь»), totalInventory (массив → FluxLedgerError) и
     auditReservoirFluxes; пустой объект {} остаётся валидным,
     известные нули (entries[s] = 0) не меняются.
- **Stage 4.2.1 — WorldClock, реестр процессов, планировщик,
  инварианты** (коммиты 63375e9 → eba0a94 → 31f2298 → 8cb8ba3 →
  2af6970, CI runs #38–#42; фундамент политики времени БЕЗ
  выдуманной физики):
  A. WorldClock: { clock } поверх сегментированного SimulationClock —
     второго независимого elapsed-поля не существует
     (validateWorldClock отклоняет лишние поля); локальное время
     не смешивается с космологическим возрастом; годы → секунды
     только явно (yearsToSeconds, юлианский год 3.15576e7 с);
     Date.now()/системное время не используются;
  B. ProcessRegistry: τ — ScientificValue с размерностью времени и
     provenance либо unknownValue с причиной; текстовые
     timescaleNote не конвертируются в числа; dt ≤ τ/20 — только
     предварительная эвристика (tau_heuristic); итоговая
     доступность disabled/not_implemented/scheduled/unknown/
     available; 11 легаси-процессов ChemicalEvolution перенесены
     мостом chemicalProcessesToCoreDescriptors в ЧЕСТНОМ состоянии
     (tau unknown, solver not_implemented, enabled false) и НЕ
     активируются автоматически;
  C. Scheduler: детерминированный порядок; Lie (порядок id,
     sub-cycling равными подшагами — только Lie) и Strang ровно
     для двух операторов A(dt/2) → B(dt) → A(dt/2) (иначе
     invalid_splitting); ЕДИНСТВЕННОЕ продвижение WorldClock после
     успешного прохода операторов и аудита; атомарность шага:
     ошибка оператора / самовольное продвижение часов / нарушенный
     инвариант → rejected, исходный мир, время не продвигается;
     snapshot-изоляция (4.2.3.1): операторы работают с глубоким
     рабочим снимком CoreWorldState (structuredClone), входной
     мир не мутируется на месте; невозможность снимка —
     контролируемый отказ до вызова операторов; очередь событий: comparePoints + sequence tie-break, повторная
     обработка запрещена, данные JSON-сериализуемы, ошибка
     обработки не теряет событие;
  D. InvariantAuditor: 9 секций (substance, element, charge, energy,
     reservoir_fluxes, nonnegativity, ledger, state, time);
     агрегация: invalid|imbalanced → imbalanced, иначе not_verifiable
     или граница ≠ complete → not_verifiable, иначе approximate →
     approximate, иначе balanced; balanced = true только при
     полной границе; правила 4.1.1.2/4.1.1.3 (unknown ≠ 0,
     untimed не маскируется) сохранены;
  E. версии: CoreWorldState 1.0.0 → 1.1.0 (опциональное
     scheduling; миграция его НЕ создаёт), сохранения 1.2 → 1.3
     (migrate12to13 не выдумывает прошедшее время); сохранения без
     coreWorldState остаются без него;
  F. golden baseline химии (63375e9, CI run #38): SHA-256
     канонического снимка 100 шагов runChemicalEvolutionStep
     (877e17d346da3618ec5d15aced90c68da8a4bbb34ff18cb78023e756c1d85b20;
     steps=100, modelTimeYears=1e8, reactionRecords=0, oxygenNet=0)
     рассчитан реально выполнявшимся кодом, зафиксирован тестом и
     notice-аннотацией CI; после всех коммитов 4.2.1 совпадает.
     ChemicalEvolution НЕ переведён на Scheduler (4.2.3),
     температурная иерархия (4.2.2) — на момент 4.2.1 не начата;
     выполнена ревизией 4.2.2 (см. блок Stage 4.2.2 ниже) — отсутствие
     готовых физических solver не маскируется.
- **Stage 4.2.1.2 — аудит контрактов реестра процессов и
  планировщика** (3 остаточных дефекта, исправлены; +13
  регрессионных тестов: 6 coreProcessRegistry → 21, 7
  coreScheduler → 30):
  G. (ISSUE 1) τ: числовое τ для known/estimated обязано быть
     строго положительным конечным временем (после перевода в
     секунды SI); τ ≤ 0 в любой единице — invalid_descriptor
     (validateProcessDescriptor), значение НЕ «чинится» (не |τ|,
     не ε, не 0); tauSeconds при непригодном τ — fail-closed (null),
     heuristicStepSeconds → null, processAvailability → unknown,
     isProcessAutoRunnable → false; runMacroStep не запускает
     процесс с непригодным τ даже при прямом вызове
     (process_tau_unknown до первого оператора);
  H. (ISSUE 2) дубликаты processId: идентификаторы одного
     macro-шага уникальны; дубликат в processIds (Strang ['A','A']
     — не «два оператора») и повторяющийся processId в списке
     runtime-операторов (молчаливая перезапись Map.set запрещена)
     → SchedulerError duplicate_process_id ДО вызова первого
     оператора; исходный мир и часы не изменяются; корректный
     Strang A + B сохраняет поведение;
  I. (ISSUE 3) физические подынтервалы: intervalStartS — начало
     ФИЗИЧЕСКОГО подынтервала [intervalStartS,
     intervalStartS + durationS) ⊆ [0, dt]; Lie — [0, dt]
     (sub-cycling — равные подшаги), Strang — A [0, dt/2] →
     B [0, dt] → второй A [dt/2, dt] (ранее B получал
     intervalStartS = dt/2 при durationS = dt — интервал
     [dt/2, 3dt/2] выходил за macro-шаг); порядок Strang и
     ЕДИНСТВЕННОЕ продвижение часов на dt сохранены; тесты
     проверяют и порядок вызовов, и согласованность временных
     аргументов.
- **Stage 4.2.2 — температурная иерархия и происхождение**
  (проблемы 2.2/2.3 закрыты в типизированной части; +76 тестов в
  coreThermalState.test, +2 правки generator.test):
  J. новые контракты `Core/thermalState.ts`: термодинамическая
     температура — только единица 'K' с размерностью
     Θ (validateThermalScientificValue; known/estimated конечны и
     ≥ 0; invalid — только диагностика); BodyThermalState
     (equilibrium/surface/effective раздельно + профиль атмосферы);
     AtmosphericTemperatureProfile со статусами unknown /
     single_layer_estimate (ровно 1 слой + обязательный
     limitations) / partial_profile / complete_profile;
  K. resolver локальной температуры
     resolveLocalReactionTemperature: читает ТОЛЬКО явно указанную
     область — (bodyId, reservoirId) или (bodyId, layerId);
     T_eq, глобальная surfaceTemperature, температура соседних
     резервуаров/слоев и AtmosphereState.temperature НЕ являются
     fallback ни при каких условиях; отсутствие/чужая
     область/непригодные данные → синтезированный unknown с
     причиной; заявленные unknown/not_applicable/not_implemented
     сохраняются как есть с provenance; некорректное место (оба
     id / ни одного / пустой bodyId) → ThermalStateError
     invalid_place; чистая функция (иммутабельность проверена
     тестами);
  L. схема CoreWorldState 1.2.0: WorldBody.thermalState опционален;
     миграция сохранений 1.2→1.3 поле НЕ создаёт; validateWorldState
     даёт invalid_thermal_state / invalid_reservoir
     (reservoirTemperature);
  M. адаптеры provenance: пресетная температура → ScientificValue с
     происхождением (historical_game → estimated «игровое допущение
     (game_assumption)», observational_reference → estimated
     «справочное, НЕ измерение этого мира», hypothetical /
     пользовательская — с пометками); planetThermalStateFromLegacy:
     T_eq — known отдельно, surfaceTemperature — ЯВНО unknown до
     RCM, effective — not_applicable (планета — получатель
     излучения); WorldModel больше НЕ присваивает
     characteristics.surfaceTemperature из пресета; генератор
     передаёт в фазовый скрининг типизированную температуру
     (analyzeAtmospherePhasesWithProvenance, числовой результат
     неизменен, temperatureBasis с примечанием). Пресетная
     температура (288/95 K) больше не появляется в
     physicalCharacteristics.surfaceTemperature.
- **Stage 4.2.2.1 — ревизия интеграции температурной иерархии**
  (+22 теста: 8 compatibility.test, 10 coreThermalState.test,
  4 generator.test):
  N. строгая форма в hasUsableTemperature/temperatureValueOrNull:
     estimated без method непригоден; числовые пороки
     (NaN/±Inf/отрицательные/неизвестная единица) не проходят;
     unknown/not_applicable/not_implemented/invalid никогда не
     становятся числом; resolver отклоняет пустые/пробельные
     reservoirId/layerId (invalid_place), orphan-резервуар не
     является областью существующего мира, слой из профиля со
     статусом unknown не читается;
  O. provenance адаптеров: пояснение пресета (presetNotes) живёт в
     provenance.note, sourceName — только при действительном
     источнике (observational_reference); teff-диапазон класса при
     value=null сохраняется в provenance.rawInput и НЕ
     схлопывается в среднее; T_eq из реального EnergyBalance
     (confidence estimated — репрезентативная светимость класса)
     остаётся estimated после адаптации, не повышаясь до known;
  P. Compatibility: cradle_temperature_compatibility больше не
     возвращает молчаливый true при отсутствии локальной
     температуры — новое правило cradle_temperature_unproven
     (категория cradle_temperature, conditionally_compatible,
     warning) различает «условная совместимость» и «нет
     проверки»; известная локальная температура вне диапазона —
     по-прежнему error; атмосферная среда читается через
     типизированное значение (atmospherePresetTemperatureToScientificValue
     + temperatureValueOrNull), историческое игровое допущение не
     изображается наблюдательным измерением; температура другого
     резервуара или T_eq не подставляется;
  Q. диагностика «пресет vs T_eq» подключена к реальному
     генерационному контуру (шаг 10e): исходная пресетная
     температура и исходная T_eq сохранены отдельно, абсолютная
     разница вычислена, запись severity info явно называет их
     РАЗНЫМИ физическими величинами и не объявляет противоречием;
     порог не задаётся скрытым значением по умолчанию;
  R. фазовый скрининг — location-aware: контекст
     PhaseScreeningTemperatureContext (ScientificValue или слой
     AtmosphereTemperatureLayer) привязывает скрининг к явно
     обозначенной локальной области surface_boundary (однослойная
     модель текущего этапа); статус и provenance сохранены; при
     отсутствии пригодной локальной температуры скрининг
     остаётся unknown без fallback на T_eq;
  S. Compatibility: ошибка (incompatible/error) — только для
     известного (known) значения локальной среды вне диапазона;
     оценочная температура (пресет estimated или легаси-число
     без происхождения) вне диапазона — отдельное ЯВНОЕ
     предупреждение cradle_temperature_estimate_outside_range
     (conditionally_compatible, warning), НЕ физическая ошибка;
     selectCradle не отбрасывает такую колыбель (фильтр — только
     severity error); известное в диапазоне — проверка может
     считаться доказанной; неизвестное — предупреждение
     недоказанности без ложного подтверждения;
  T. легаси surfaceTemperature без происхождения — не proof:
     cradle_temperature_unproven подтверждается только
     типизированной known-температурой (coreWorldState →
     planet → thermalState.surfaceTemperature); миграция старых
     сохранений сохраняет исходное число без выдуманных
     источника/метода/статуса; T_eq, атмосфера и соседние
     резервуары как fallback не используются;
  U. provenance: presetNotes — ВСЕГДА пояснение в note (включая
     observational_reference); sourceName — только из отдельного
     явного поля AtmosphereState.presetSourceName при
     действительно известном источнике, иначе undefined;
     observational_reference — классификация происхождения
     пресета, НЕ библиографическая ссылка; provenance
     переносится в AtmosphericTemperatureProfile;
  V. PhaseTemperatureBasis.location — структурированное место
     температурного контекста ({kind:'atmosphere_layer',
     layerId}; ScientificValue-контекст — без location; unknown
     остаётся unknown без fallback); строгий unknown-скрининг
     тест (customAtmosphere temperature:null → все компоненты
     unknown, T_eq не подставлена); РЕАЛЬНЫЙ computeEnergyBudget
     integration test (equilibriumTemperature → адаптер:
     estimated остаётся estimated, метод/uncertainty/rawInput
     сохранены, surfaceTemperature не заполняется); измерение
     25 сидов (fixed cosmology big_bang): КАЖДЫЙ мир
     реалистичного режима несёт cradle_temperature_unproven →
     physically_plausible недостижим, обычные миры —
     hypothetical; scientificStatus смешивает физическую
     правдоподобность выбранных объектов и полноту знания о
     локальной среде (архитектурное следствие задокументировано,
     семантика статуса НЕ менялась).
- **Stage 4.2.2.3 — provenance gate и location-specific evidence**
  (+30 тестов: 26 compatibility.test, 4 generator.test; коммиты
  c0e2fb8 → cdfef76; CI run 41174155913 зелёный):
  W. evidence gate: известная (known) температура — доказательство
     совместимости ТОЛЬКО при содержательном provenance — непустое
     одно из sourceName/sourceId/datasetId/recordId/reference/
     method/modelVersion ИЛИ непустой rawInput (проверяемый расчёт
     не требует библиографии); note/applicability/limitations/
     conditions/license/retrievedAt и пустой {} происхождением НЕ
     считаются; known без происхождения — cradle_temperature_unproven
     (правило 6a, warning), НЕ ошибка правила 6; непригодные формы
     (invalid, не та единица, NaN, отрицательные) доказательством не
     являются; estimated до known не повышается; gate не меняет
     глобальную семантику knownValue — только использование known
     как доказательства температурной совместимости;
  X. поверхность ≠ резервуар: typedLocalTemperatureOfWorld —
     surface: typedSurfaceTemperatureOfWorld (coreWorldState →
     тело 'planet' → thermalState.surfaceTemperature);
     ocean/subsurface_reservoir/deep_planetary_layers и прочие
     резервуарные среды: resolveLocalReactionTemperature(core,
     {bodyId: 'planet', reservoirId: env.localReservoirId}) — только
     явная ссылка CradleLocalEnvironment.localReservoirId; без ID,
     у чужого тела, при несуществующем ID или без пригодной
     температуры → недоказанность (warning, не физическая
     ошибка); произвольный резервуар по совпадению kind не
     выбирается; surfaceTemperature, T_eq, температура атмосферы и
     соседних резервуаров — НЕ fallback; океанская колыбель не
     подтверждается и не опровергается температурой поверхности;
  Y. правило 6b (приоритет typed): при пригодном typed known
     легаси-скаляр physicalCharacteristics.surfaceTemperature не
     читается — доказанное вне диапазона = ОДНА ошибка
     cradle_temperature_compatibility без дублирующего
     cradle_temperature_estimate_outside_range; доказанное в
     диапазоне — без error/warning/unproven; при typed estimated
     используется именно оценка; легаси-скаляр — оценочный сценарий
     ТОЛЬКО поверхности и ТОЛЬКО без typed evidence, никогда error;
     для океана не используется даже как оценка;
  Z. старые сохранения: CradleLocalEnvironment.localReservoirId —
     необязательное поле (миграции не заполняют, автозаполнение
     запрещено), легаси-числа не становятся ScientificValue;
     isCradleSupportedOnWorld: контекст расширен опциональными
     coreWorldState/cradleLocalEnvironment (тесты РЕАЛЬНОГО пути
     автоматического выбора — доказанное known-нарушение исключает
     колыбель, оценка/unknown — нет; генерация не меняется);
     measured: 830 тестов, CI 41174155913 зелёный, golden совпал.
- **Stage 4.2.2.4 — проверка вида резервуара и интеграция
  selector’а** (+18 тестов: 11 compatibility.test, 7
  generator.test; коммиты 6e7708d1 → 42ab6acc; CI run 41189806931
  зелёный):
  AA. соответствие CradleLocationType ↔ ReservoirRecord.kind —
     экспортированная таблица LOCATION_TYPE_RESERVOIR_KINDS
     (ocean → [’ocean’]; subsurface_reservoir → [’ocean’,
     ’crust’]; deep_planetary_layers → [’mantle’, ’core’];
     surface/atmosphere/other → null — допустимые виды не
     определены, природа по одному ID не выводится); таксономия —
     только задокументированные значения kind (’atmosphere’|
     ’ocean’|’ice’|’crust’|’mantle’|’core’|…), новых типов нет,
     переименований нет; проверка выполняется ДО признания known
     доказательством: резервуар с несоответствующим видом не
     доказывает и не опровергает — cradle_temperature_unproven
     (warning), НЕ incompatible/error; другой резервуар
     автоматически не подставляется;
  BB. selectCradle: экспортирован (testable без дублирования
     алгоритма выбора), принимает опциональные coreWorldState/
     cradleLocalEnvironment и передаёт их в
     isCradleSupportedOnWorld → checkCompatibility; без typed
     evidence селектор не выдумывает его и не исключает кандидата
     по температуре (условный результат); фиктивное CoreWorldState
     не создаётся; estimated до known не повышается;
     generateWorld evidence не передаёт (ядро строится после
     выбора колыбели); переданная среда применяется ко всем
     кандидатам без пересчёта;
  CC. интеграционные тесты проверяют сам selectCradle (не только
     predicate isCradleSupportedOnWorld): known в диапазоне —
     кандидат остаётся; known-нарушение — кандидат исключен при
     допустимой альтернативе; estimated вне диапазона и unknown —
     условные кандидаты, не hard error; без typed evidence —
     прежний выбор; fixedCategories.cradle — выбранная вручную
     колыбель остаётся, несовместимость отражается
     предупреждениями/ошибками без автоматической подмены;
     детерминизм — фиксированная фикстура, нулевые веса и
     единственная допустимая альтернатива; measured: 848 тестов,
     CI 41189806931 зелёный, golden совпал.
- **Stage 4.2.2.5 — candidate-specific локальные среды selector’а
  и семантика видов** (+14 тестов: 12 generator.test,
  2 compatibility.test; коммиты 44e93b71 → 356da6e5 →
  b527aa1f → ff810acd; CI run 41192420708 зелёный):
  DD. контекст selectCradle: singular-поле cradleLocalEnvironment
     заменено картой cradleLocalEnvironmentsById (ID кандидата →
     его среда); каждый кандидат фильтруется по СВОЕЙ среде —
     явной из карты или вычисленной per-candidate
     (determineCradleLocalEnvironment, тот же путь, что и в
     реальном контуре); coreWorldState общий; перенос
     locationType/состава/localReservoirId между кандидатами
     исключён; generateWorld evidence по-прежнему не передаёт
     (selector-интеграционные тесты НЕ заявляют использование
     typed evidence генератором);
  EE. семантика видов и runtime: LOCATION_TYPE_RESERVOIR_KINDS.
     subsurface_reservoir = [’crust’] (вид ’ocean’ убран: схема
     ReservoirRecord не различает поверхностный и подземный
     океан, описание CRADLE_LOCATION_MAP не доказывает
     представительство, тестовая фикстура не обоснование; новые
     виды не введены); lookup по неизвестному runtime locationType
     даёт undefined — без исключения, недоказанность, другой
     резервуар не выбирается (fail-closed);
  FF. интеграционные тесты selector’а: в одном selectCradle-вызове
     кандидаты четырёх локаций (liquid_methane_ethane — ocean;
     hydrogen_helium_aerosols — atmosphere; supercritical_water —
     subsurface_reservoir; molten_salts — deep_planetary_layers),
     каждый по собственной среде; known-нарушение исключает
     только своего кандидата; атмосферная колыбель требует H₂/He
     по собственному составу; давление и matter_state — по
     расположению текущего кандидата; estimated вне диапазона и
     unknown — условные кандидаты; без reservoir ID температура
     не подставляется; fallback, нулевые веса и ручная фиксация —
     прежние; детерминизм — повторный вызов selector’а; measured:
     862 теста, CI 41192420708 зелёный, golden совпал.
- **Stage 4.2.2.5.1 — prototype safety kind-гейта** (+1 тест:
  compatibility.test; коммиты 9b31419b → 1fad4992; CI run
  41207933807 зелёный):
  GG. runtime lookup LOCATION_TYPE_RESERVOIR_KINDS[env.locationType]
     — только по СОБСТВЕННОМУ ключу таблицы
     (Object.prototype.hasOwnProperty.call): унаследованные
     значения Object.prototype списками допустимых видов не
     являются; несобственный ключ — недоказанность без
     исключения, без TypeError и без выбора другого резервуара
     (fail-closed); корректные CradleLocationType — прежнее
     поведение; валидация kind, provenance и
     isProvenTemperatureEvidence не ослаблены;
  HH. регрессионные тесты через реальный путь checkCompatibility:
     5 значений (’hydrothermal_sinter’, ’constructor’, ’toString’,
     ’hasOwnProperty’, ’__proto__’; приведение типа — только на
     границе фикстуры) с резервуаром допустимого вида ’crust’
     (known 700 K + содержательный provenance) и декой-резервуаром
     (known 288 K, вне диапазона 647–1000) — no-throw, нет ошибки
     cradle_temperature_compatibility, есть
     cradle_temperature_unproven, автоподбор не выполняется;
     measured: 863 теста, CI 41207933807 зелёный, golden совпал.

### 1.15 App.tsx (966 строк)

- **Назначение**: монолитный UI: GeneratorPanel, WorldDisplay, HistoryPanel, ExportPanel, форматтеры (`formatPhysValue`, `formatConfidence`, ...), вызов `runChemicalEvolutionStep`.
- **Проблемы**: (а) UI напрямую импортирует физические модули и знает структуру `PhysValue`; (б) форматирование достоверности — в UI-слое; (в) setState-in-effect предупреждения; (г) 966 строк — всё в одном файле.
- **Целевое состояние** (без переписывания сейчас): слой адаптеров (ядро → view-model) в Stage 4.1; форматтеры переезжают в ядро; UI теряет импорты физических модулей кроме адаптеров.

## 2. Найденные проблемы (не исправляются в Stage 4.0)

Нумерация используется в других документах. **Критических ошибок вычислений не обнаружено**; ниже — несоответствия связей и риски архитектуры. Каждая проблема сопровождается предлагаемым ОТДЕЛЬНЫМ исправлением.

### 2.1 Репрезентативная светимость класса как конкретное значение [средний риск]

- **Где**: EnergyBalance `computeEnergyBudget` → `getRepresentativeLuminosityW(cid)`; OrbitalMechanics `sampleOrbit` → `getRepresentativeMassKg(cid)`.
- **Что происходит**: для мира используется одна светимость/масса на весь класс звёзд (например, все жёлтые карлики дают одинаковый поток). Неопределённость задокументирована в PhysValue, но потребитель (T_eq) получает единственное число.
- **Последствие**: систематическое смещение T_eq внутри класса; потенциальные миры не различаются термически внутри класса.
- **Предлагаемое исправление (Stage 4.6)**: сэмплировать светимость/массу звезды из диапазона класса тем же PRNG (одна звезда = один сэмпл, сохраняемый в мире), поток считать по сэмплу, диапазон — в PhysValue.range. Каталог уже хранит диапазоны — данные готовы.

### 2.2 T_eq вычисляется, но не потребляется [высокий риск для целостности]

- **Где**: EnergyBudget вычисляет `equilibriumTemperature`; PhaseEquilibrium и ChemicalEvolution используют `atmosphere.temperature` (из пресета) как рабочую температуру.
- **Последствие**: энергетический контур и термохимический контур живут на разных температурах; результат одной модели (T_eq) не используется там, где он единственный физически обоснованный, а игровая пресетная температура выступает как физическая.
- **Предлагаемое исправление (Stage 4.2/4.8, ревизия 4.0.1)**: ввести иерархию РАЗДЕЛЬНЫХ температурных величин вместо одного поля `T_surface` с разными источниками (PHYSICS_ARCHITECTURE §5.1): effectiveTemperature, equilibriumTemperature, surfaceTemperature, atmosphericTemperatureProfile, reservoirTemperature, localReactionTemperature. T_eq — радиационная оценка, не подменяет температуру поверхности; температура атмосферного пресета несёт явную пометку происхождения (historical_game / справочная); реакции и фазовые переходы читают температуру своего резервуара/области. До появления RCM surfaceTemperature остаётся `unknown` или явно оценочной, не подменяется T_eq. До реализации — задокументировано здесь.
- **Статус (Stage 4.2.2)**: базовый слой иерархии реализован в ядре —
  BodyThermalState (T_eq отдельно known; surfaceTemperature явно
  unknown до RCM; effective not_applicable), профиль атмосферы со
  статусами, reservoirTemperature, resolver локальной температуры
  без ложных fallback, типизированный фазовый анализ
  (temperatureBasis с provenance; подстановка T_eq/surface
  запрещена и отмечена в примечании). Числовой легаси-путь
  PhaseEquilibrium/ChemicalEvolution НЕ тронут (перевод химии на
  Scheduler и локальную температуру — 4.2.3): легаси-химия
  продолжает использовать пресетную температуру как рабочую,
  что остаётся честно задокументированным.
- **Статус (Stage 4.2.2.1)**: диагностика «пресет vs T_eq»
  подключена к реальному генерационному контуру (запись severity
  info в warnings мира, verdict noted без выдуманного порога;
  сами температуры не изменяются); T_eq из EnergyBalance с
  confidence estimated остаётся estimated после адаптации
  (оценка не повышается до измерения); типизированный контекст
  фазового скрининга привязан к локальной области
  surface_boundary.
- **Статус (Stage 4.2.2.2)**: известная (known) температура
  поверхности подтверждает или опровергает совместимость
  колыбели только как типизированное значение из научного ядра
  (coreWorldState со статусом и provenance); легаси-скаляр
  surfaceTemperature (в старых сохранениях мог быть скопирован
  из пресета) измерением не считается — остаётся оценочным/
  неизвестным; оценка вне диапазона — предупреждение
  cradle_temperature_estimate_outside_range, не ошибка;
  T_eq по-прежнему не подставляется как температура поверхности.
- **Статус (Stage 4.2.2.3)**: известная (known) температура
  подтверждает/опровергает совместимость только при содержательном
  provenance И принадлежности именно указанной локальной области
  (evidence gate; известное число без происхождения —
  недоказанность, не ошибка); поверхность не подменяет температуру
  океанского/глубинного резервуара — явная ссылка
  CradleLocalEnvironment.localReservoirId + resolver, без fallback;
  при пригодном typed known легаси-скаляр не читается (доказанное
  вне диапазона — одна ошибка, без дублирующего оценочного
  предупреждения).
- **Статус (Stage 4.2.2.4)**: доказательство резервуаром требует
  также соответствия ReservoirRecord.kind локальной среде
  (LOCATION_TYPE_RESERVOIR_KINDS); несоответствующий вид —
  недоказанность (cradle_temperature_unproven), не ошибка, без
  автоподбора другого резервуара; selectCradle передаёт
  опциональный typed evidence в проверку (интеграционные тесты
  реального selector’а, не только predicate).
- **Статус (Stage 4.2.2.5)**: локальная среда selector’а стала
  candidate-specific — карта cradleLocalEnvironmentsById по ID
  кандидата (без явной среды — per-candidate вычисление
  determineCradleLocalEnvironment); перенос
  localReservoirId/locationType/состава между кандидатами
  исключён; subsurface_reservoir доказывается только kind
  ’crust’ (вид ’ocean’ убран: недостаточно данных, фикстура не
  обоснование); runtime-неизвестный locationType — fail-closed
  без исключений.
- **Статус (Stage 4.2.2.5.1)**: runtime fail-closed дополнительно
  охватывает имена унаследованных свойств прототипа — список
  допустимых видов читается только по СОБСТВЕННОМУ ключу
  LOCATION_TYPE_RESERVOIR_KINDS (hasOwnProperty): ’constructor’/
  ’toString’/’hasOwnProperty’/’__proto__’ и произвольные строки —
  недоказанность без исключения, без TypeError, другой резервуар
  не выбирается; контракты 4.2.2.5 не изменены.

### 2.3 Пресетная температура — скрытый вход скрининга [средний риск]

- **Где**: `analyzeAtmospherePhases` (вход из AtmospherePhysicalModel), `runChemicalEvolutionStep` (пороги реакций).
- **Последствие**: для Титана скрининг корректен (94 K из справочного пресета), но для случайных атмосфер температуры пресетов могут конфликтовать с T_eq орбиты (например, холодная орбита + тёплый пресет).
- **Предлагаемое исправление**: то же, что 2.2 (единая политика температуры) + валидационное правило совместимости «пресетная температура vs T_eq: расхождение > X К — предупреждение» (Stage 4.2, правило Compatibility).
- **Статус (Stage 4.2.2)**: исправлено в типизированной части —
  WorldModel больше НЕ копирует пресетную температуру в
  `characteristics.surfaceTemperature` (проверено тестами генератора:
  288/95 K не появляются); фазовый скрининг генератора получает
  типизированную температуру с происхождением пресета
  (analyzeAtmospherePhasesWithProvenance); расхождение пресет vs
  T_eq диагностируется ядром (diagnosePresetEquilibriumDivergence:
  noted / threshold_exceeded / not_comparable — порог только явный,
  температуры не изменяются). Легаси-правило Compatibility с жёстким
  порогом НЕ добавлялось (чтобы не менять поведение легаси-совместимости
  и RNG); правило совместимости появится при переводе UI/совместимости
  на ядро.
- **Статус (Stage 4.2.2.1)**: фазовый скрининг генератора привязан к
  явно обозначенной локальной области surface_boundary
  (PhaseScreeningTemperatureContext): статус и provenance
  температуры сохранены, температура скрининга НЕ называется
  surfaceTemperature и НЕ использует T_eq как fallback; при
  отсутствии пригодной локальной температуры скрининг остаётся
  unknown.
- **Статус (Stage 4.2.2.2)**: строгий unknown-скрининг
  гарантирован тестом (customAtmosphere с корректным составом и
  temperature:null → phaseAnalysis.temperatureK === null,
  temperatureBasis.temperature.status === 'unknown', все компоненты
  фазового анализа unknown, T_eq из энергетического бюджета не
  подставлена); layerId доступен структурно через
  temperatureBasis.location ({kind:'atmosphere_layer',
  layerId:'surface_boundary'}), а не только в свободном тексте.
- **Статус (Stage 4.2.2.3)**: без изменений для фазового скрининга —
  этап его не трогал (численный API и корреляции Антуана прежние);
  strict-семантика локальной области Compatibility теперь применена и
  к резервуарным средам через явный localReservoirId (без ID —
  недоказанность, не ошибка).
- **Статус (Stage 4.2.2.4)**: фазовый скрининг не менялся; таблица
  соответствия locationType ↔ kind ограничена доказательной
  семантикой Compatibility колыбели и на скрининг не влияет.
- **Статус (Stage 4.2.2.5)**: фазовый скрининг не менялся;
  сужение subsurface_reservoir до kind ’crust’ и runtime-гейт
  касаются только выбора резервуара-доказательства локальной
  температуры колыбели.
- **Статус (Stage 4.2.2.5.1)**: фазовый скрининг не менялся;
  prototype safety kind-гейта касается только выбора
  резервуара-доказательства локальной температуры колыбели.

### 2.4 Температурные диапазоны реакций каталога — игровые [низкий риск, гигиена данных]

- **Где**: `chemicalReactions.allowedRanges` (например, ch4_oxidation: 300–2000 K).
- **Проблема**: диапазоны выглядят как экспериментальные данные, но происхождения не имеют (реальное окисление CH₄ в атмосферах — фотохимическое, многостадийное). `gameSpeedCoefficient` честно помечен игрой, диапазоны — нет.
- **Предлагаемое исправление (Stage 4.5)**: пометить диапазоны `game_assumption` в типе `ChemicalReaction` и добавить поле provenance; при появлении данных JPL Evaluation — заменить на проверенные.
- **Статус (Stage 4.2.2)**: provenance-метки диапазонов реакций НЕ
  тронуты — остаются Stage 4.5 (изменение каталога реакций вне этапа
  запрещено). Подготовлен типизированный путь: локальная температура
  процесса теперь разрешается ядром
  (resolveLocalReactionTemperature) с honest-статусами, и при
  появлении проверенных диапазонов реакции смогут читать температуру
  своей области, а не пресет атмосферы.
- **Статус (Stage 4.2.2.1)**: типизированный путь подтверждён
  ревизией — provenance адаптеров очищен (пояснение пресета
  живёт в provenance.note, sourceName только для действительного
  источника; teff-диапазон класса сохраняется в rawInput и не
  схлопывается в среднее); сами provenance-метки диапазонов
  реакций остаются Stage 4.5.
- **Статус (Stage 4.2.2.2)**: sourceName пресета заполняется
  ТОЛЬКО из явного отдельного поля
  AtmosphereState.presetSourceName (когда реальный источник
  действительно известен); presetNotes остаётся пояснением в
  provenance.note во всех случаях (observational_reference —
  классификация происхождения пресета, не библиография);
  provenance не теряется в AtmosphericTemperatureProfile;
  provenance-метки диапазонов реакций остаются Stage 4.5.
- **Статус (Stage 4.2.2.3)**: provenance-метки диапазонов реакций
  по-прежнему не тронуты (Stage 4.5); evidence gate применяется
  только к использованию known-температуры как доказательства
  совместимости колыбели, глобальная семантика ScientificValue не
  менялась.
- **Статус (Stage 4.2.2.4)**: без изменений для диапазонов реакций
  (Stage 4.5); kind-гейт применяется только к выбору
  резервуара-доказательства локальной температуры колыбели.
- **Статус (Stage 4.2.2.5)**: без изменений для диапазонов реакций
  (Stage 4.5); candidate-specific среды и семантика видов —
  только доказательная семантика Compatibility колыбели.
- **Статус (Stage 4.2.2.5.1)**: без изменений для диапазонов
  реакций (Stage 4.5); prototype safety kind-гейта — только
  доказательная семантика Compatibility колыбели.

### 2.5 Однонаправленная стехиометрия [архитектурное ограничение]

- **Где**: ChemicalEvolution — реакции только вперёд, без обратных и равновесия.
- **Последствие**: инвентарь неизбежно движется к полному превращению; это не ошибка (движок объявлен стехиометрическим), но ограничивает науку. Равновесие появится отдельным решателем (CHEMISTRY_ARCHITECTURE §3), не патчем стехиометрии.

### 2.6 Двойной путь характеристик тела [средний риск]

- **Где**: WorldModel `calculateBodyCharacteristics` — ветка bodyPhysics (сэмпл) и легаси-ветка (среднее диапазона).
- **Последствие**: один и тот же мир может показывать разные массу/радиус в разных кодовых путях; легаси-ветка не помечена достоверностью.
- **Предлагаемое исправление (Stage 4.1)**: генератор всегда заполняет bodyPhysics; легаси-ветка удаляется после миграции сохранений (миграция уже есть в Storage — дополнить заполнением bodyPhysics при загрузке миров 1.0/1.1).
- **Статус (Stage 4.1)**: НЕ исправлено, отложено на Stage 4.2. Ядро
  подготовило канонический приёмник (`WorldBody.properties` с ScientificValue
  и адаптер `bodyPhysicsToPlanetBody`), но легаси-ветка и миграция
  сохранений с дозаполнением bodyPhysics не тронуты — по правилу этапа
  не изменять легаси-модули и семантику старых сохранений (поля не
  пересчитываются задним числом). Удаление двойного пути — 4.2.

### 2.7 Дублирование вспомогательных функций [низкий риск]

- `unknownValue(note, unit)` определена и в OrbitalMechanics, и в ChemicalEvolution; PhysValue-обёртки повторяются. G продублирован в units.test.ts (допустимо для независимой проверки инварианта).
- **Предлагаемое исправление (Stage 4.1)**: `core/values` с общими фабриками PhysValue; дубликаты удалить.
- **Статус (Stage 4.1)**: НЕ исправлено, отложено на Stage 4.2. Ядро
  предоставило канонические фабрики (ScientificValue.knownValue/
  estimatedValue/unknownValue, physicalQuantity.convert), но дубликаты
  в легаси-модулях сохранены — их удаление требует перевода легаси-
  потребителей, что по правилам этапа не выполнялось.

### 2.8 Циклических зависимостей не обнаружено

Проверено по импортам: Data и Units — листья; OrbitalMechanics → Data/Units; EnergyBalance → OrbitalMechanics/Data; PhaseEquilibrium → Atmosphere(типы)/Data/Units; ChemicalEvolution → Data/PhaseEquilibrium(резервуары)/Atmosphere(типы); Generator → все; App → все. Направление ациклично. Риск появляется при «обратных» связях (например, химия → орбита) — правило: физика общается только через контракты ядра (SIMULATION_ENGINE §4).

### 2.9 Скрытые зависимости через строковые поля

Орбитальные `radiativeConditions`, примечания геологии и т.п. — человекочитаемые строки, которые UI показывает. Они не парсятся, но создают риск: текст обещает больше, чем вычисляет код («спутник освещается звездой и проходит через тень» — тени нет). Требование: тексты-обещания синхронизировать с возможностями (Stage 4.1, ревизия строк).

## 3. Сводка: реализовано / частично / отсутствует / невозможно без данных

- **Реализовано**: SI-единицы с provenance; PhysValue; PRNG-детерминизм; причинная цепочка генерации; Кеплер-периоды; поток и T_eq с явными допущениями; физика столба атмосферы; Antoine-скрининг CH₄/C₂H₆ с диапазонами; стехиометрия с элементным балансом; кислородный баланс по записям шага (3.1.2); резервуары с сохранением количества; миграция сохранений; 267 тестов + CI.
- **Ревизия Stage 4.1 — добавлено к «Реализовано»**: контракты научного
  ядра (величины с размерностями, 6 статусов данных, виды+фазы, резервуары
  с basis, потоковый журнал с аудитами сохранения, сегментированные часы,
  каноническое состояние мира, solver-контракт с честными заявками,
  миграции 1.0→1.1→1.2, адаптеры из легаси; после ревизии 4.1.1 —
  246 тестов ядра, всего 517).
  Это контракты и инварианты — физические модели из списков ниже они
  НЕ реализуют и за реализованное не выдаются.
- **Частично**: структурная модель центральных объектов (классы без сэмплирования звезды); орбиты (без устойчивости/возмущений); геология (уровни без Вт); атмосфера (1 слой, без парника/фотохимии/утечки); фазы (только скрининг чистых веществ).
- **Отсутствует**: кинетика; термодинамика реакций; равновесие; EOS; N-body; приливные расчёты; внутреннее строение; радиационный перенос; климатический контур; геохимические потоки; распространение неопределённости.
- **Невозможно без данных** (и в проекте это фиксируется как unknown, а не подменяется): мощности радиогенного нагрева (нужны изотопные составы), приливная диссипация (нужны k₂, Q), скорости реакций (нужны JPL/эксперименты), сечения поглощения (нужны HITRAN/ExoMol таблицы), тепловые потоки недр (нужны теплоёмкости, EOS).

## 4. Функции, которые обязаны сохраниться (реестр совместимости)

1. Детерминизм генерации по seed (Mulberry32 + порядок цепочки).
2. Формат сохранений с версионированием и миграциями (Storage 1.1).
3. PhysValue-контракты и шкала ScientificConfidence.
4. Пресеты атмосфер байт-в-байт (historical_game) + справочные.
5. Каталоги и правила Compatibility с флагами аномального режима.
6. Стехиометрический движок и его тесты (сценарии A–F, O₂-баланс 3.1.2).
7. Формулы F, T_eq, Кеплер, ρ, g, столб m=P/g — как проверяемые эталонные блоки.
8. Экспорт JSON/Markdown.
9. Аномальный режим как управляемое отклонение (не «выключить всё»).

Ревизия Stage 4.1 — проверка реестра по факту:

- пп. 1–9 сохранены: легаси-модули и формат их данных не изменены;
  PRNG-детерминизм дополнительно защищён регрессионным тестом в
  corePersistence.test (два инстанса createRandom(seed) дают идентичные
  последовательности, разные seed различаются);
- п. 2 расширен без ломки: формат сохранений поднят до 1.2 через
  реестр миграций ядра (цепочка 1.0→1.1→1.2, идемпотентность,
  SUPPORTED_SAVE_VERSIONS), старые сохранения читаются и мигрируют
  без пересчёта значений; STORAGE_FORMAT_VERSION и миграции
  делегированы Core/migrations;
- добавлено: п. 10 — контракты ядра Core (величины, статусы данных,
  виды, резервуары, потоки, часы, состояние мира, solver-контракт,
  миграции, адаптеры) как новые защищаемые инварианты (246 тестов
  после 4.1.1).

## 5. Замечания ревизии Stage 4.0.1 — дефекты архитектурной спецификации

> Ниже — ошибки ДОКУМЕНТОВ Stage 4.0 (спецификации), найденные независимой
> ревизией и исправленные ревизией 4.0.1. Это НЕ ошибки работающего
> программного кода: код на них не опирался. Нумерация DA-*.

- **DA-1 (PHYSICS_ARCHITECTURE §3.1)**: формула жидкого предела Роша была
  записана как d ≈ 2.44 R_p (m/M)^⅓ — неверная общая зависимость для
  жидкого спутника. Классическая форма: d_R ≈ 2.44 R_p (ρ_p/ρ_s)^⅓, где
  ρ_p и ρ_s — средние плотности родителя и спутника. Исправлено; добавлены
  ограничения модели, библиография и численные проверки (VALIDATION_PLAN).
- **DA-2 (аудит §2.2, PHYSICS §5)**: предложение о ЕДИНОМ поле T_surface с
  разными источниками объединяло физически разные температурные величины.
  Исправлено на иерархию раздельных величин (PHYSICS_ARCHITECTURE §5.1).
- **DA-3 (DATA_PROVENANCE §2.3; история и исправление)**: версия ATcT была
  указана как 1.220 в Stage 4.0; ревизия 4.0.1 ОШИБОЧНО объявила ver. 1.122
  последней проверенной; Stage 4.0.2 исправляет: фактическая последняя
  выпущенная версия на 30.10.2026 — **TN 1.228** (проверено по официальной
  странице atct.anl.gov, перечень выпусков Thermochemical Data). TN 1.222,
