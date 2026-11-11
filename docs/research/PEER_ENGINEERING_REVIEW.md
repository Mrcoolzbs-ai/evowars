# PEER_ENGINEERING_REVIEW: сравнительное инженерное исследование зрелых open-source проектов

> Тип документа: исследовательский отчёт. Дата: 2026-11-10, корректирующая редакция 2026-11-11.
> Ветка: `stage-3-planetary-physics`, база: `4ce7a3c` (fast-forward поверх цепочки `9e2b7b7c` →
> `c572399b` → `5b8f525b` → `a886c31d`).
> Корректирующая редакция исправляет: трактовку выбора интеграторов в PHREEQC (выбор задаётся
> пользователем параметром `-cvode`, автоматической смены метода нет), версию и лицензию REBOUND
> (исследована 5.2.2, GPL-3.0-only по pyproject.toml), разграничение версий PHREEQC
> (3.8.6-17100 USGS downloads и 3.9.0-17591 upstream), Alpha-статус PROTEUS, привязку всех
> исследованных исходников к точным commit SHA.
> Документ исследовательский: он не является разрешением менять код, тесты, научные данные,
> этапы 4.5.4/4.5.5 или какие-либо иные незакрытые этапы. Все действующие ограничения EvoWars
> (NASA CEA, gameSpeedCoefficient, Radau IIA, PURE PR, статусы unknown/no_kinetic_data,
> fail-closed, запрет подмены KIDA/JPL коэффициентов, запрет производства Rust/WASM без
> отдельного решения) сохраняются без изменений.
>
> Правило доказательности: каждое существенное утверждение снабжено источником (URL файла
> исходного кода, страницы документации, теста или публикации). Утверждения, которые не
> удалось подтвердить в этой сессии, помечены как **(непроверено)**. Предположения не
> выдаются за результаты изучения исходного кода.

## 1. Executive summary

Ранжированные главные выводы исследования.

1. **PROTEUS ближе всего к EvoWars по архитектуре и предлагает самый большой пакет
   переносимых решений**: слоты физических доменов с заменяемыми реализациями, обязательный
   dummy-бэкенд для каждого слота, парные интеграционные тесты всех комбинаций модулей,
   golden-файл регрессии (`tests/integration/golden_run.tsv`), разделение быстрых unit-тестов
   и ночных интеграционных прогонов, честная документация известных нарушений сохранности.
   Лицензия Apache-2.0 не ограничивает заимствование подхода. Оценка зрелости сдержанная:
   PyPI-классификатор пакета fwl-proteus 26.10.16: «Development Status :: 3 - Alpha», а релизные
   заметки самих разработчиков перечисляют конфигурационные ключи, значения по умолчанию которых
   меняются между релизами; интерфейсы и состав модулей могут меняться, PROTEUS не является
   стабилизированной production-платформой. Переносимы именно архитектурные решения (слоты,
   dummy, парные тесты, golden-файл), устойчиво присутствующие в нескольких релизах, а не готовые
   API. Категория: **ADAPT**.
2. **CoolProp 8.0 реализует двухэтапную процедуру Михельсена** (стабильность по TPD, затем
   расщепление фаз) с GDEM-ускорением и trust-region минимизацией второго порядка, и это
   структурно совпадает с подэтапом 4.4.4.4.2 поиска TPD в EvoWars. Но CoolProp сам
   документирует в исходном коде, что тест Михельсена может дать ложный вердикт «stable»
   вблизи фазовой границы: метод не даёт глобальной сертификации, только достаточное условие
   неустойчивости (TPD < 0). Это подтверждает правильность позиции EvoWars: строгие вердикты
   остаются за `validatedErrorBound`, без него `indeterminate`. Категория: **ADAPT**
   (структура алгоритма) + **REFERENCE** (оракул), сертификацией не признавать.
3. **Cantera даёт образец контракта реакции**, который стоит перенять на уровне контрактов
   (не данных): явные типы falloff (Lindemann/Troe/SRI/Tsang) с точными формулами в
   `src/kinetics/Falloff.cpp`, явно указанные единицы в константах скорости, явно
   декларированные диапазоны применимости (Chebyshev-реакции), семантика дублей и явных
   третьих тел. Категория: **ADAPT** (контракты) + **REFERENCE** (офлайн-оракул кинетики и
   равновесия). Подмена коэффициентов №89/№106 данными Cantera: **REJECT**.
4. **PHREEQC применим как офлайн-оракул водной геохимии** (этап 4.9) и как образец границы
   интеграции (IPhreeqc/PhreeqcRM: модуль с начальными/граничными условиями, прогон реакции
   во всех ячейках, MPI/OpenMP). Граница применимости: водные растворы; силикатные расплавы
   и недра не входят в его предметную область. Юридический текст прав USGS в этой сессии не
   открыт полностью: **(непроверено)**. Категория: **REFERENCE** + **STUDY** (граница
   интеграции), для недр: **REJECT**.
5. **REBOUND исследован в актуальной версии 5.2.2** (5 октября 2026): SimulationArchive даёт
   бинарные снапшоты с побитовым воспроизведением рестарта, машинно-независимые между
   операционными системами; совместимость между версиями не безусловна: релиз 5.0.0
   (15 мая 2026) прямо заявляет смену формата и нечитаемость архивов предыдущих версий,
   кросс-версионная совместимость не является свойством формата. Дисциплина интеграторов
   (IAS15 по умолчанию, симплектики WHFast/SEI/LEAPFROG/EOS/SABA, гибриды MERCURIUS/TRACE,
   JANUS, SIMD-интегратор WHFast512) образует матрицу «режим → метод». Лицензия 5.2.2 по
   pyproject.toml: GPL-3.0-only (в README сохраняется формулировка «or (at your option) any
   later version», неоднозначность текстов зафиксирована); встраивание в распространяемый
   EvoWars проблемно без отдельного лицензионного решения. Запуск отдельным процессом как
   офлайн-оракул соответствует текущей практике VALIDATION_PLAN, но отсутствие лицензионных
   обязательств при этом не заявляется гарантированным без анализа конкретной схемы
   распространения и взаимодействия компонентов. Категория: **REFERENCE** (оракул) +
   **ADAPT** (паттерн снапшотов), встраивание: **REJECT** без отдельного решения.
6. **VPLanet показывает, как организовать эталонные планетарные сценарии**: около 40
   сценариев-примеров, каждый привязан к публикации и воспроизводит её результат, плюс
   публичный раздел «Broken» с честным списком сломанных примеров. Это прямой шаблон для
   Уровня 3/5 VALIDATION_PLAN EvoWars. Лицензия MIT. Категория: **ADAPT** (система сценариев)
   + **REFERENCE**.

Сводка лицензий (все проверены по официальным файлам лицензий в репозиториях):
PROTEUS Apache-2.0; CoolProp MIT; Cantera BSD-3 (Caltech/Sandia/Cantera Developers);
PHREEQC: файла LICENSE в репозитории нет, README релиза 3.9.0-17591 содержит USGS-дисклеймер
«preliminary or provisional... No warranty...» (текст ниже), полный текст User Rights Notice
**(непроверено)**; REBOUND 5.2.2: GPL-3.0-only (pyproject.toml); VPLanet MIT.

## 2. Методология исследования и версии проектов

Метод: для каждого проекта открывались официальный сайт и документация, репозиторий
исходного кода, конкретные файлы реализации, тестовые каталоги, файлы лицензий, страницы
релизов и библиография. Исходные файлы читались напрямую (raw-версии GitHub), страницы
документации открывались целиком. Дата обращения к первичным источникам: 2026-11-10;
корректирующая редакция (точные версии, commit SHA, лицензии, PHREEQC KINETICS, REBOUND 5.2.2):
2026-11-11. Исследование ведётся по релизным версиям; все исходники, тесты и файлы лицензий
привязаны к неизменяемым commit SHA (таблица ниже). Ссылки на изменяемые ветки main/master не
используются как доказательные: там, где дерево репозитория читалось через веб-интерфейс ветки,
это помечено. Код ветки разработки не смешивается со стабильным релизом: анализ Cantera
выполнен по тегу v3.2.0, ветка main (линия разработки 4.0.0a2) для выводов не используется.

Ограничения метода: (1) чтение файлов через веб-интерфейс ограничено размером выгрузки,
поэтому для двух больших файлов CoolProp анализировались начала файлов и целевые фрагменты;
(2) локальный запуск проектов не выполнялся (задача исследования, не установки зависимостей);
(3) перечисленные в §15 вопросы помечены как непроверенные, а не домысленные.

| Проект | Версия | Полный commit SHA | Версия документации | Источники тестов | Лицензия |
|---|---|---|---|---|---|
| PROTEUS | 26.10.16 | e6c872f6205f2d3aa213a83136fc02e5fdace2d6 (тег 26.10.16) | proteus-framework.org, обращение 2026-11-10 | дерево tests/ читалось через ветку main 2026-11-10; сверка с тегом не выполнялась **(непроверено)** | Apache-2.0, LICENSE.txt тега 26.10.16 (проверен) |
| CoolProp | 8.0.0 | ae81610e7d23efc57f9d051c8e70a4d66e87537f (тег v8.0.0) | coolprop.org, страница Mixtures 8.0.0 | CI-workflow каталог читался через ветку master; сверка с тегом не выполнялась **(непроверено)** | MIT, LICENSE тега v8.0.0 (проверен) |
| Cantera | 3.2.0 | 4a8358eb80cfeb50474386b5f9ec0b3a83519889 (тег v3.2.0) | cantera.org /stable (3.2.0), заметки релиза 3.2.0 | test/kinetics по тегу v3.2.0 (kineticsFromScratch, kineticsFromYaml, pdep, rates) | BSD-3, License.txt тега v3.2.0 (проверен) |
| PHREEQC | 3.9.0-17591 (upstream, 13.05.2026); USGS downloads: 3.8.6-17100 | a4b1596bc0d4ec479a2493541f275af37e9f7349 (тег v3.9.0) | глава KINETICS: water.usgs.gov phreeqc3-24.htm + совпадающий по ключевым фрагментам файл HTMLversion/HTML/phreeqc3-24.htm в теге v3.9.0 | ctest.cmake, ctest.regression.cmake по тегу v3.9.0 | файла LICENSE нет; USGS provisional, дисклеймер README тега v3.9.0 (проверен); User Rights Notice **(непроверено)** |
| REBOUND | 5.2.2 | c34134716cd484ed9cdb9f7d54ef8d859bdf547d (тег 5.2.2) | rebound.hanno-rein.de, соответствие сборке 5.2.2 **(непроверено)** | examples/, ipython_examples/, python_examples/ по тегу 5.2.2 | GPL-3.0-only, pyproject.toml тега 5.2.2 (проверен); LICENSE: текст GPLv3; README: «or later» |
| VPLanet | v2.5.36 | 35472e7814cf98ea39c2fc7f035a10ee3bd98a62 (тег v2.5.36) | virtualplanetarylaboratory.github.io, обращение 2026-11-10 | examples/ по сайту документации и репозиторию | MIT, LICENSE тега v2.5.36 (проверен) |

Таблица фиксирует неизменяемые привязки: все commit SHA получены из GitHub по тегам релизов
в сессии корректирующей редакции 2026-11-11. Версии PHREEQC 3.8.6-17100 (USGS downloads page,
«Version 3 January 7, 2025») и 3.9.0-17591 (upstream-релиз тега v3.9.0) различаются: последней
upstream-версией является 3.9.0-17591, выводы настоящего документа привязаны к ней, если явно
не указано иное.

## 3. PROTEUS: подробный разбор

### 3.1 Идентификация и статус

Официальный сайт: https://proteus-framework.org/ (проверено: открывается, содержит описание
фреймворка и ссылку на документацию https://proteus-framework.org/PROTEUS/). Репозиторий:
https://github.com/FormingWorlds/PROTEUS. Лицензия: Apache-2.0, файл
https://raw.githubusercontent.com/FormingWorlds/PROTEUS/main/LICENSE.txt (текст Apache
License Version 2.0 проверен). Программная цитата: Zenodo concept DOI 10.5281/zenodo.21358380
(README). Базовая публикация модели: Lichtenberg et al. (2021), указана на странице
https://proteus-framework.org/PROTEUS/Explanations/model.html как основа, от которой код
существенно разросся. Последний релиз на дату исследования: `26.10.16` (16.10.2026), commit
e6c872f6205f2d3aa213a83136fc02e5fdace2d6 (получен по тегу релиза 26.10.16, GitHub).

Статус зрелости: PyPI-страница пакета fwl-proteus 26.10.16
(https://pypi.org/project/fwl-proteus/26.10.16/) указывает классификатор
«Development Status :: 3 - Alpha». Релизные заметки 26.10.16 сами содержат раздел
«Defaults that change the result of an unchanged config», перечисляющий ключи, значения
по умолчанию которых менялись между релизами. Вывод для EvoWars: PROTEUS не является
стабилизированной production-платформой, его интерфейсы и состав модулей могут меняться;
переносятся архитектурные решения (слоты, dummy, парные тесты, golden-файл), а не готовые
API. Именно эти решения устойчиво присутствуют в нескольких релизах, что и делает их
предметом ADAPT.

PROTEUS описывает себя как «modular Python framework that follows a rocky planet from a
molten magma ocean to a solid surface. It couples the interior, the atmosphere, the star
and the orbit of the planet in one time-stepping loop» (README,
https://raw.githubusercontent.com/FormingWorlds/PROTEUS/main/README.md).

### 3.2 Архитектура физических модулей: слоты и заменяемые реализации

Ключевое архитектурное решение: модуль это «слот» (slot), который заполняется конкретной
реализацией (model), и каждая реализация существует как самостоятельный пакет вне PROTEUS
(https://proteus-framework.org/PROTEUS/Explanations/model.html). Таблица слотов из
документации (там же):

| Слот | Реализации | Роль |
|---|---|---|
| Structure | Zalmoxis, dummy | структура недр (радиус, плотность, гравитация) |
| Interior | SPIDER, Aragog, boundary, dummy | тепловая эволюция мантии/ядра |
| Atmosphere (climate) | AGNI, JANUS, dummy | радиационно-конвективный профиль |
| Atmosphere (chemistry) | VULCAN, dummy | химическая кинетика |
| Star | MORS, dummy | эволюция звезды и спектр |
| Escape | ZEPHYRUS, dummy | уход атмосферы |
| Outgassing | CALLIOPE, atmodeller, dummy | обмен летучими между расплавом и атмосферой |
| Tides | Obliqua, Lovepy, dummy | приливный отклик (числа Лява, нагрев) |
| Orbit | внутренняя реализация | эволюция орбиты |
| Accretion | Morrigan, timeline, dummy | рост протопланеты гигантскими столкновениями |
| Observations | petitRADTRANS, none | синтетические спектры |

Исходное дерево подтверждает организацию: `src/proteus/` содержит подпакеты `accretion`,
`atmos_chem`, `atmos_clim`, `config`, `data`, `escape`, `grid`, `inference`,
`interior_energetics`, `interior_struct`, `observe`, `orbit`, `outgas`, `plot`, `star`,
`utils` плюс `proteus.py`, `cli.py`, `doctor.py`
(https://github.com/FormingWorlds/PROTEUS/tree/main/src/proteus, читалось через
изменяемую ветку main 2026-11-10; версия закреплена тегом 26.10.16, commit
e6c872f6205f2d3aa213a83136fc02e5fdace2d6: см. §2).

Реализации спроектированы как взаимные перекрёстные проверки одного физического слота:
SPIDER решает энтропийную (T-S) формулировку через PETSc, Aragog решает энергетическую
(T-P) формулировку через SUNDIALS CVODE с аналитическим якобианом, полученным JAX-автоматическим
дифференцированием; документация прямо называет SPIDER «an independent cross-check on
Aragog for the same physical problem formulated in a different thermodynamic variable»
(страница model.html). Это тот же принцип, что в EvoWars: независимый оракул для той же
задачи в другой формулировке.

### 3.3 Координатор вычислений и обмен граничными условиями

Координатор это единый цикл по coupling timestep. Из model.html: «At each coupling
timestep, the interior module passes the surface temperature and heat flux upward to the
atmosphere, which returns the outgoing longwave radiation; the outgassing module partitions
volatiles between the melt and the atmosphere based on the current temperature and melt
fraction; and the escape module removes mass from the top of the atmosphere driven by the
stellar XUV flux». Звезда и орбита задают внешнее форсирование (инселляция, XUV, приливный
нагрев).

Порядок обмена летучими зафиксирован явно и воспроизводится в документации как
пошаговая диаграмма (model.html, раздел «Volatile outgassing and rock vapourisation are
combined»): (1) сначала выполняется volatile outgassing (CALLIOPE/atmodeller/dummy) и
возвращает парциальные давления и массы газов; (2) затем шаг vapourisation (LavAtmos +
FastChem) переуравновешивает атмосферу вместе с породным паром; (3) комбинация выполняется
в фиксированном порядке с явными тождествами (`P_vap = Pbar − P_vol`, `P_surf = Pbar`,
`P_vol = P_surf − P_vap`). Документация отдельно предупреждает: «Pressures add,
compositions do not» (сложение составов двух шагов считало бы инвентарь дважды).

### 3.4 Dummy backends

Каждый слот имеет dummy-реализацию. Документация формулирует две цели dummy-модулей
(https://proteus-framework.org/PROTEUS/Explanations/dummy_modules.html):

1. «Testing and validation. Running all modules in dummy mode exercises the full coupling
   architecture (helpfile data bus, timestep control, convergence checks, output pipeline)
   without requiring external solvers, compiled code, or reference data. This makes it
   possible to write fast unit tests, verify that a new module slot is wired correctly, and
   diagnose coupling bugs in isolation from solver bugs.»
2. «Physics grounding. Simplified models provide analytical or semi-analytical end-member
   behaviour that the production modules must reproduce in the appropriate limits. When a
   full solver produces a result, comparing it against the dummy equivalent answers the
   question "does this output make sense at zeroth order?"»

При этом dummy-модули честно не являются наукой: «Dummy modules are not designed for
quantitatively meaningful science» (там же). Примеры: dummy-структура использует
аналитические скейлинги Noack & Lasbleis (2020); dummy-интерьер это одноузловая
теплоёмкостная ODE с заданными солидусом/ликвидусом; dummy-атмосфера это серое тело
`FOLR = σ[Tsurf(1−γ)]⁴` с фиксированным режимом потока для теста отклика интерьера на
заданное граничное условие.

### 3.5 Fail-closed поведение решателей

Atmodeller (outgassing) документирован с явным fail-closed поведением: «Each solve may
take up to `outgas.atmodeller.solver_multistart` attempts, a failed start being perturbed
and tried again; a solve in which no attempt converges stops the run with an error, rather
than writing the solver's start guess to the helpfile» (model.html). Несошедшийся решатель
не записывает своё начальное приближение как результат. Это прямая параллель правилу
EvoWars «неизвестное не подменяется числом» и семантике `numerical_failure` решателя
Radau IIA.

### 3.6 Честная фиксация границ сохранности

PROTEUS документирует собственное известное несохранение массы: при включённом
vapourisation породный пар добавляется в атмосферу без вычитания из недр («Whole-planet
mass is not conserved when vapourisation is enabled», model.html), и утилита
`utils.coupler.assert_mass_conservation` проверяет два раздельных условия с учётом этого.
Ограничение задокументировано, а не замаскировано. Паттерн «система ассертов сохранности +
честная документация исключений» переносим в InvariantAuditor EvoWars напрямую.

### 3.7 Орбита

Орбитальный модуль PROTEUS (внутренний) решает эволюцию независимых орбитальных параметров
(a, e, спин, прецессия) векторным подходом в коэффициентах Гансена, с угловым моментом,
сохраняемым во всех случаях, кроме резонанса эвекции (model.html, раздел «Orbital
evolution»). Для EvoWars это REFERENCE на далёкий этап 4.6+: аналитические модели
сочленены с явным перечнем случаев, где сохранение нарушается физически, а не численно.

### 3.8 Тесты, CI и проверка PR

Каталог `tests/` (https://github.com/FormingWorlds/PROTEUS/tree/main/tests, читался через
изменяемую ветку main 2026-11-10; посимвольная сверка с деревом тега 26.10.16 не
выполнялась, см. §2 и §15 п. 20) повторяет
структуру модулей: `accretion`, `atmos_chem`, `atmos_clim`, `config`, `data`, `escape`,
`grid`, `helpers`, `inference`, `integration`, `interior_energetics`, `interior_struct`,
`observe`, `orbit`, `outgas` (далее по дереву). Интеграционные тесты
(`tests/integration/`) построены как парные комбинации реализаций:
`test_integration_agni_aragog.py`, `test_integration_agni_atmodeller.py`,
`test_integration_agni_calliope.py`, `test_integration_agni_mors.py`,
`test_integration_agni_zephyrus.py`, `test_integration_aragog_atmodeller.py`,
`test_integration_aragog_calliope.py`, `test_integration_aragog_mors.py`,
`test_integration_aragog_zephyrus.py`, `test_integration_calliope_mors.py`,
`test_integration_calliope_multi_timestep.py` и другие; в каталоге лежит
`golden_run.tsv` (golden-регрессия целого прогона).
CI из README: workflow `coverage-baseline.yml` (бейдж «Unit Tests»), `ci-nightly.yml`
(бейдж «Integration Tests»), `docs.yaml` (сборка документации), плюс интеграция codecov
(https://raw.githubusercontent.com/FormingWorlds/PROTEUS/main/README.md). То есть:
быстрый unit-контур на каждый PR, тяжёлые интеграционные прогоны ночным контуром.

### 3.9 Область применимости и ограничения

Область: скалистые (экзо)планеты от магматического океана до твёрдой поверхности.
Ограничения, зафиксированные самой документацией: химия атмосферы (VULCAN) работает только
пост-процессингом снимков, связанная (online) химия не реализована («coupled (online)
chemistry is not yet implemented», model.html); SPIDER требует PETSc и является опциональным
компонентом установки; dummy-модули не дают количественной науки. Публикационная база
модулей: Lichtenberg et al. (2021) (базовая модель), Noack & Lasbleis (2020) (dummy-структура),
Wolf & Bower (2018) (EOS), Kimura et al. (2025) (Morrigan), все ссылки на странице model.html.

### 3.10 Сопоставление с EvoWars

| Аспект EvoWars | Как решено в PROTEUS | Перенос |
|---|---|---|
| Scheduler (4.2.3): операторы, подциклы, очередь событий, глубокий снимок CoreWorldState перед оператором | единый coupling-цикл с фиксированным порядком передачи величин между слотами | ADAPT: явная фиксация порядка обмена величинами на каждый шаг расписания, как в диаграмме outgassing |
| SolverBackend: capabilities, probe-валидация, честный пустой бэкенд, `planned` без реализаций | dummy-слоты с двумя целями (тест связности + физический ориентир), `none`/`dummy` как легальные значения слотов | ADAPT: ввести dummy-бэкенды для каждого физического слота EvoWars, включая конфигурацию «все dummy» для быстрых тестов связности |
| InvariantAuditor: аудиты перехода, статусы balanced/imbalanced/approximate/not_verifiable | `assert_mass_conservation` с двумя раздельными проверками и задокументированным исключением (vapourisation) | ADAPT: паттерн «ассерт + документированное исключение», раздельные инварианты на каждый поток |
| Парные интеграционные тесты | `tests/integration` перебирает комбинации реализаций | ADAPT: при появлении вторых реализаций слотов EvoWars тестировать пары явно |
| Регрессия целых прогонов | `golden_run.tsv` | ADAPT: расширить существующие golden-миры EvoWars файлом числового следа ключевых величин |
| CI | unit на PR + nightly integration + codecov | ADAPT: двухконтурная схема, см. §12 |

Различия, которые нельзя игнорировать: PROTEUS это Python/Julia/Fortran-стек для одиночных
многомиллиарднолетних прогонов; EvoWars это TS-ядро с WASM-планом и игровым слоем.
Переносить можно контракты, порядок обмена, тестовые паттерны и дисциплину честности, но
не стек. Реализации PROTEUS нельзя вызвать из браузерного рантайма EvoWars (Julia, Fortran,
PETSc): они REFERENCE/ADAPT, не ADOPT.

## 4. CoolProp: подробный разбор

### 4.1 Идентификация и статус

Репозиторий: https://github.com/CoolProp/CoolProp. Лицензия MIT, файл тега v8.0.0
https://raw.githubusercontent.com/CoolProp/CoolProp/v8.0.0/LICENSE («Copyright (c) 2012-2018
Ian H. Bell and other CoolProp developers», полный текст MIT проверен по тегу v8.0.0).
Актуальный релиз: CoolProp `8.0.0`, 28.06.2026, commit
ae81610e7d23efc57f9d051c8e70a4d66e87537f (получен по тегу v8.0.0, GitHub). Все цитаты
исходного кода и документации в этом разделе сверены с тегом v8.0.0; изменяемая ветка
master для выводов не используется. Основная публикация: Bell, Wronski, Quoilin, Lemort (2014),
«Pure and Pseudo-pure Fluid Thermophysical Property Evaluation and the Open-Source
Thermophysical Property Library CoolProp», Industrial & Engineering Chemistry Research,
DOI 10.1021/ie4033999 (https://pubs.acs.org/doi/10.1021/ie4033999).

Важно для EvoWars: репозиторий уже выполнял независимый benchmark CoolProp 8.0.0
(backend 'PR', custom-fluids EVW-* через `add_fluids_as_json`, второй оракул mpmath 1.3.0
на 50 знаков): 7 контрольных точек rtol 1e-3, mpmath rtol 5e-13, смеси rtol 2e-4, с
классификацией кратных корней кубики и фиксацией `solver_failures_justified` (см. ревизии
4.4.4.2.1 и 4.4.4.3.x в docs/science/DATA_PROVENANCE.md, разделы про CoolProp benchmark).
Настоящее исследование не повторяет этот benchmark, а дополняет его анализом алгоритмов
устойчивости.

### 4.2 Фазовая устойчивость и flash: двухэтапная процедура Михельсена в 8.0

Страница документации Mixtures (https://coolprop.org/fluid_properties/Mixtures.html,
документация версии 8.0.0) описывает реализованную с v8.0 двухэтапную «классическую»
процедуру Михельсена для PT-flash в Helmholtz- (HEOS) и кубических (SRK/PR) бэкендах.
Выбор алгоритма конфигурацией `MIXTURE_STABILITY_ALGORITHM`: `1` (по умолчанию с v8.0,
Михельсен) или `0` (легаси-алгоритм Gernert et al., единственный до v7.x включительно).

Этап 1, анализ устойчивости (по Michelsen 1982a):

- Критерий: фаза состава z устойчива, если TPD(Y) >= 0 для всех пробных составов Y, где
  `TPD(Y) = Σᵢ Yᵢ[ln Yᵢ + ln φ̂ᵢ(Y) − hᵢ]`, `hᵢ = ln zᵢ + ln φ̂ᵢ(z)`. Стационарная точка
  с TPD < 0 доказывает неустойчивость.
- Начальные K-факторы по корреляции Вильсона; формируются два пробных состава:
  vapour-like `Yᵢ = zᵢKᵢ` и liquid-like `Yᵢ = zᵢ/Kᵢ`.
- Для каждого пробного состава: последовательная подстановка (successive substitution)
  условия стационарности, до 4 раундов по 2 шага, с ускорением GDEM (Generalized Dominant
  Eigenvalue Method, оригинал Crowe & Nishio, AIChE 1975; применение к flash по Michelsen &
  Mollerup 2007), экстраполяция по доминирующему направлению ошибки с ограничением r < 0.95.
- Ранние выходы: TPD < -1e-7 (неустойчивость обнаружена, быстрый путь); сходимость по
  `max|Δln Yᵢ| < 1e-7`; тривиальное решение (состав совпал с feed, кривизна положительна).
- Если подстановка не дала вывода: минимизация TPD второго порядка в переменных
  `αᵢ = 2√Yᵢ` (преобразование снимает ограничение неотрицательности и улучшает
  обусловленность гессиана, который в идеальногазовом пределе стремится к единичной
  матрице), методом типа Hebden с ограниченным шагом (trust region, Hebden 1973); сходимость
  по норме градиента < 1e-7, максимум 20 итераций.

Этап 2, расщепление фаз (по Michelsen 1982b): уравнение Рэкфорда-Райса для доли пара β
решается Ньютоном с бисекционными защитами; K-факторы обновляются последовательной
подстановкой в log-пространстве ln K с тем же GDEM-ускорением (хранение в ln K предотвращает
переполнение для ширококипящих смесей); при отсутствии сходимости выполняется Ньютоновская
минимизация энергии Гиббса второго порядка (приведённые градиент и гессиан по Michelsen,
приложение B) с backtracking-поиском и масштабированием шага для допустимости (положительности
чисел молей); сходимость `max|gᵢ| < 1e-9`, максимум 30 итераций.

Легаси-алгоритм (Gernert et al. 2014, FPE): подстановка до 100 итераций без GDEM и без
минимизации второго порядка, затем одновременный Ньютон по остаткам изофугитивности и
баланса массы; документация рекомендует Михельсена как более робастный у критических
точек и для смесей с сильно разной летучестью компонентов.

Библиографические ключи проверены по файлу тега v8.0.0
https://raw.githubusercontent.com/CoolProp/CoolProp/v8.0.0/Web/fluid_properties/Mixtures.rst:
`Michelsen-FPE-1982a`, `Michelsen-FPE-1982b`, `Michelsen-BOOK-2007` (Michelsen & Mollerup,
Thermodynamic Models: Fundamentals and Computational Aspects), `Gernert-FPE-2014`,
`CroweNishio-AIChE-1975`, `Hebden-1973`, `RachfordRice-1952`. Точные страницы выпусков в
этой сессии не сверялись: **(непроверено)**, ссылки даны по библиографическим ключам
CoolProp.

### 4.3 Где это в исходном коде

- `src/Backends/Helmholtz/FlashRoutines.cpp`: PT-flash вызывает
  `StabilityRoutines::StabilityEvaluationClass stability_tester(HEOS)`,
  `do_twophase = !stability_tester.is_stable()`, далее расщепление с опцией
  `wilson_seeded`; диспетчеризация «Michelsen or Gernert based on config» (фрагменты файла
  прочитаны напрямую). Сверка цитаты о ложных «stable» вердиктах выполнена по файлу тега
  v8.0.0: https://github.com/CoolProp/CoolProp/blob/v8.0.0/src/Backends/Helmholtz/FlashRoutines.cpp;
- `src/Backends/Helmholtz/VLERoutines.cpp`: классы последовательной подстановки
  (`SaturationSolvers::successive_substitution`, см. doxygen-указатель
  http://www.coolprop.org/v4/_static/doxygen/html/class_successive_substitution_v_l_e.html);
  файл больше лимита выгрузки этой сессии, полный разбор не выполнялся: **(непроверено)**.
- Каталог бэкенда: `ChebensitySolver.cpp`, `FlashRoutines.cpp`, `HelmholtzEOSBackend.cpp`,
  `HelmholtzEOSMixtureBackend.cpp`, `MeltingCaloric.cpp`, `MixtureDerivatives.cpp`,
  `MixtureParameters.cpp`, `PhaseEnvelopeRoutines.cpp`, `ReducingFunctions.cpp`,
  `TransportRoutines.cpp`, `VLERoutines.cpp` (дерево каталога прочитано).

### 4.4 Какие гарантии алгоритм даёт, а какие нет

Это центральный вопрос задания. Ответ по первоисточникам:

1. Математически корректное достаточное условие: стационарная точка с TPD < 0 доказывает
   неустойчивость (Michelsen 1982a, документация Mixtures).
2. Глобальной гарантии нет: тест это поиск из двух начальных приближений (vapour-like и
   liquid-like) с локальной минимизацией; доказанной нижней грани TPD по всей области
   составов метод не строит.
3. CoolProp сам фиксирует ложные вердикты «stable» в исходном коде FlashRoutines.cpp
   (прочитано дословно): «the Michelsen stability test can report a false "stable" verdict
   near a phase boundary, its trial minimization can converge to the trivial (feed)
   solution (cubic mixtures at high vapor fraction) or fail to conclude at all, so a
   genuinely two-phase state gets mislabeled single-phase liquid. Cross-check a "stable"
   verdict against a cheap Wilson K-factor estimate and, if warranted, attempt a split
   seeded from it» (комментарий со ссылкой на CoolProp-zgpy issue #3174 и PR #2720).
   То есть даже зрелая реализация признаёт эвристичность вердикта «устойчиво» и добавляет
   перекрёстную проверку.

Вывод: алгоритм CoolProp не является математически сертифицированным глобальным методом
устойчивости, и CoolProp такого не заявляет. Для EvoWars это означает: (а) структуру
алгоритма можно переносить в подэтап 4.4.4.4.2 как реализацию поиска; (б) перенос не
снимает действующего правила: строгие вердикты `unstable_detected` /
`no_instability_found_within_search` требуют установленного `validatedErrorBound`, без
него результат `indeterminate` (TPD_SEARCH_DESIGN.md §6.5-6.6); (в) перекрёстная проверка
вердикта «устойчиво» дешёвым независимым средством (у CoolProp: Wilson K-фактор) это
переносимый приём.

### 4.5 EOS и численные ограничения

Модели смесей: многопараметрическая Helmholtz-энергия (GERG-2008, Kunz & Wagner; Lemmon
для сухого воздуха и хладагентов) и кубические бэкенды (SRK/PR) (страница Mixtures).
Оценочные схемы бинарных параметров (`linear`, `Lorentz-Berthelot`) документированы с
жёстким предупреждением «Use with caution!! For other mixtures this can give you entirely(!)
wrong predictions». Это подтверждает правило EvoWars: отсутствие kij в каталоге это fail-closed
состояние, а не «возьмём kij = 0».

### 4.6 Тесты и CI

Workflow CI: `_catch2.yml` (C++-тесты на Catch2), `_buildwheels.yml`/`_cibuildwheel.yml`
(сборка колес), `_checks.yml`, `_devdocs-run.yml` (перечень workflow каталога
`.github/workflows` прочитан). Сторонние лицензии: `THIRD_PARTY_NOTICES.md` в корне; при
`COOLPROP_VENDOR_THIRD_PARTY=ON` в пакет вшиваются pinned-заголовки Eigen и fmt вместе с
их лицензиями (README). Т.е. CoolProp моделирует ровно то, что требует §13 настоящего
документа: лицензия основного проекта не считается автоматически распространяющейся на
зависимости, для них ведётся отдельный реестр.

### 4.7 Сопоставление с EvoWars

| Аспект EvoWars | Как решено в CoolProp | Решение |
|---|---|---|
| PR чистые компоненты/смеси (4.4.4.1-4.4.4.3), Z/φ/фугитивность | HEOS + кубические бэкенды, разделение ветвей | REFERENCE: уже используется как офлайн-оракул (benchmark в DATA_PROVENANCE), продолжить |
| TPD поиск (4.4.4.4.2) | двухэтапный Михельсен: Wilson-инициализация с двух сторон, SS+GDEM, trust-region второго порядка в α-переменных | ADAPT: структура поиска; сертификация остаётся за validatedErrorBound |
| Вердикт «устойчиво» | is_stable() + перекрёстная проверка Wilson при «stable» | ADAPT: перекрёстная проверка дешёвым независимым критерием |
| Глобальная устойчивость | не предоставляется (ложные «stable» задокументированы) | REJECT как доказательство; позиция EvoWars подтверждена |
| kij/бинарные параметры | fail-closed у CoolProp: оценка только явной конфигурацией с предупреждением | совпадает с текущей позицией EvoWars, сохранить |

Различия условий: CoolProp работает с многопараметрическими Helmholtz-моделями и
промышленными флюидами; EvoWars работает с PURE PR и малым каталогом компонентов с
per-field provenance. Численная проблема, из-за которой в EvoWars зафиксирован NO-GO
непрерывной границы TPD (платформенные логарифмы lnPhi/log-ratio), у CoolProp не решена
и не заявлена как решённая: их lnφ считается платформенными логарифмами так же, что
дополнительно подтверждает честность NO-GO (TPD_CONTINUOUS_ERROR_BOUND.md), а не
«у других получилось, значит и нам можно».

## 5. Cantera: подробный разбор

### 5.1 Идентификация и статус

Репозиторий: https://github.com/Cantera/cantera. Лицензия: BSD 3-clause, файл тега v3.2.0
https://raw.githubusercontent.com/Cantera/cantera/v3.2.0/License.txt (Copyright (c) 2001-2009
California Institute of Technology; (c) 2009 Sandia Corporation; (c) 2011-2026 Cantera
Developers; текст BSD-3 проверен по тегу v3.2.0). Исследованная версия: 3.2.0, commit
4a8358eb80cfeb50474386b5f9ec0b3a83519889 (получен по тегу v3.2.0, GitHub; релиз 18.11.2025).
Ветка main находится на линии разработки 4.0.0a2 (селектор версий документации:
«4.0 (dev) | 3.2.0 (stable)» на https://cantera.org/stable/yaml/reactions.html) и для
выводов настоящего документа не используется. Заметки релиза 3.2.0:
https://cantera.org/3.2/reference/releasenotes/v3.2.html («nearly 1000 commits since 3.1.0,
released December 2024»).

### 5.2 Представление механизмов и контракты реакций

Реакции описываются декларативно (YAML). Типы реакций (страница
https://cantera.org/stable/yaml/reactions.html): `elementary`, `three-body`,
`Blowers-Masel`, `two-temperature-plasma`, `electron-collision-plasma`,
`electron-collisions`, `falloff`, `chemically-activated`, `pressure-dependent-Arrhenius`,
`Chebyshev`, `linear-Burke`; для поверхностей: `interface-Arrhenius`, `sticking-Arrhenius`,
`electrochemical`. Ключевые свойства контракта, важные EvoWars:

- Константа скорости несёт явные единицы в данных: `{A: 2.70E+13 cm^3/mol/s, b: 0,
  Ea: 355 cal/mol}`. Смешение единиц контролируется форматом.
- Третьи тела: явный партнёр или generic `M`; efficiencies задаются таблицей
  `efficiencies` с `default-efficiency` (по умолчанию 1.0). Реакции с явным третьим телом
  и соответствующая реакция с `M` требуют обнуления эффективности или пометки `duplicate`,
  иначе ошибка (с версии 3.1 по умолчанию warning, поведение управляется полем фазы).
  Полный двойной учёт третьего тела исключается контрактом, а не дисциплиной пользователя.
- Falloff: `(+M)` или `(+имя)` в уравнении; поля `high-P-rate-constant`,
  `low-P-rate-constant`, опционально `Troe: {A, T3, T1, [T2]}`, `SRI: {A, B, C, [D, E]}`,
  `Tsang: {A, [B]}`; без falloff-параметров реализуется форма Линдемана. Именованный
  третий тело `(+N2)` эквивалентен efficiency 1 для N2 и 0 для остальных.
- Диапазоны применимости декларируются в данных: у Chebyshev-реакций обязательны
  `temperature-range` и `pressure-range`; у pressure-dependent-Arrhenius точки привязаны
  к давлениям. Механизм сам несёт границы, вне которых он неприменим.

### 5.3 Реализация falloff: исходный код

Файл `src/kinetics/Falloff.cpp` (прочитан целиком, 14 КБ). В корректирующей редакции
файл перечитан и процитирован по тегу v3.2.0:
https://raw.githubusercontent.com/Cantera/cantera/v3.2.0/src/kinetics/Falloff.cpp.
Первая редакция ошибочно ссылалась на ветку main (линия разработки 4.0.0a2); все
анализируемые фрагменты (TroeRate::updateTemp с Fcent и SmallNumber, SriRate,
InputFileError в setFalloffCoeffs) совпадают в v3.2.0 по существу. Ключевые фрагменты:

- `TroeRate::updateTemp(T, work)`: `Fcent = (1.0 − m_a)·exp(−T·m_rt3) + m_a·exp(−T·m_rt1)`;
  при ненулевом `m_t2` добавляется `exp(−m_t2/T)`; затем `work[0] = log10(max(Fcent,
  SmallNumber))`. Сама функция `TroeRate::F(double pr, work)` реализует логарифмическую
  интерполяцию Трое по log10(Pr).
- `SriRate::updateTemp`: `work[0] = m_a·exp(−m_b/T) + exp(−T/m_c)`; `work[1] = m_d·T^m_e`;
  `SriRate::F` работает через `lpr = log10(max(pr, SmallNumber))`.
- Валидация входных данных: `setFalloffCoeffs` бросает `InputFileError` при неверном числе
  коэффициентов (например, Troe требует 3 или 4); невозможное значение не «чинится».
- Защитный `SmallNumber` под логарифмом: паттерн численной защиты, аналогичный
  гарантированной положительности reducedPressure в аудите fall-off EvoWars.

### 5.4 Реакторные сети и интеграторы

Раздел документации «How Time Integration of Reactor Networks Works»
(https://cantera.org/science/reactors/cvodes.html):

- `ReactorNet` сам не интегрирует: он собирает систему из реакторов и передаёт её
  полиморфному `Integrator`; фабрика `newIntegrator("CVODE")` создаёт `CVodesIntegrator`
  (ODE), `newIntegrator("IDA")` создаёт `IdasIntegrator` (DAE). `FlowReactor` задаёт DAE
  и использует IDAS, остальные типы ODE и используют CVODES из SUNDIALS.
- Продвижение времени: цикл одиночных шагов `CVode(..., CV_ONE_STEP)` до достижения
  `tout`, затем интерполяция состояния назад на запрошенное время через `CVodeGetDky`
  (код `CVodesIntegrator::integrate` приведён в документации дословно).
- Контроль ошибок: при ошибке CVODES выбрасывается исключение с кодом и перечнем
  «Components with largest weighted error estimates» (`getErrorInfo(10)`); превышение
  `m_maxsteps` это явная ошибка с диагностикой, а не молчаливое завершение. Уровни
  допусков задаются на `ReactorNet` (rtol/atol, атрибуты класса:
  https://cantera.org/3.1/cxx/d7/def/classCantera_1_1ReactorNet.html).
- Правые части: интерфейс `FuncEval` с `eval(t, y, ydot, p)`; `ReactorNet` наследует
  `FuncEval`; проверка `checkFinite` на входе и выходе eval.

### 5.5 Тесты

Каталог `test/kinetics` (дерево прочитано по тегу v3.2.0: подтверждены файлы
`kineticsFromScratch.cpp`, `kineticsFromYaml.cpp`, `pdep.cpp`, `rates.cpp`):
`kineticsFromYaml.cpp`, `pdep.cpp` (pressure-dependent реакции: falloff и его родня),
`rates.cpp` (rate-классы). C++-тесты на googletest; тесты 0D-реакторов в `test/zeroD`
(частичный перечень: точное имя файла не подтверждено: **(непроверено)**); Python-тесты
существуют, но их пути в этой сессии не перечислялись: **(непроверено)**.

### 5.6 Сопоставление с реакциями №89/№106 EvoWars

Что совпадает предметно: обе реакции EvoWars реализованы как fall-off с явным третьим
телом N2 (контракт 4.5.2, модель molecule/cm3, интегратор Radau IIA без изменения
численного контракта; см. ревизию 4.5.5 в CHEMISTRY_ARCHITECTURE.md). В Cantera точный
аналог: тип `falloff` с `(+N2)` и Troe-параметрами, интегрирование CVODES с контролем
rtol/atol. Сравнимые величины: эффективная константа k_eff(Pr) и профили концентраций.

Что переносимо (ADAPT, уровень контрактов, не данных):

- дисциплина единиц в константе скорости: у EvoWars она уже реализована строгой
  проверкой `cm3_per_molecule_per_s` для molecule_cm3-механизма №89/№106 (механизменная
  размерность независима от общего реестра единиц); контракт Cantera подтверждает
  правильность направления;
- декларирование диапазона применимости на уровне записи механизма (аналог
  temperature-range/pressure-range): в EvoWars применённый диапазон применимости уже
  пишется в снимки истории; контракт Cantera поддерживает хранение его в данных;
- семантика дублей и явных третьих тел (защита от двойного учёта N2);
- отчёт об ошибках интегрирования с перечнем компонент с наибольшими взвешенными
  ошибками: переносимо в диагностику Radau IIA (улучшение отчёта, не метода).

Что не переносимо (REJECT): любые коэффициенты Arrhenius/Troe из механизмов Cantera
(gri30 и другие) для реакций №89/№106. Происхождение параметров в EvoWars это KIDA/JPL с
per-record provenance; записи №1/№70/№72 остаются unknown/no_kinetic_data и не заполняются
посторонними данными. Cantera не является источником KIDA/JPL данных.

Дополнительные различия: Cantera работает в mol-based единицах (cm^3/mol/s) с внутренним
контролем размерностей; эксперимент EvoWars molecule/cm3. Сравнение требует явной
конверсии единиц в тестовом сценарии (см. BM-1/BM-2, §11). Продакшн-WASM-сборка Cantera
для встраивания: только STUDY; производство Rust/WASM заблокировано отдельным решением по
условиям EvoWars (ADR-P7 и границы этапа).

## 6. PHREEQC: подробный разбор

### 6.1 Идентификация и статус

Домашняя страница: https://www.usgs.gov/software/phreeqc-version-3. Версии различаются, и
в первой редакции они не были разведены; корректирующая редакция исправляет это:
страница загрузок USGS указывает сборку `3.8.6-17100` («Version 3 January 7, 2025»), тогда
как upstream-репозиторий https://github.com/phreeqc-dev/phreeqc3 публикует релиз
`3.9.0-17591` от мая 2026 (тег v3.9.0). Последней upstream-версией является 3.9.0-17591;
не называть 3.8.6-17100 последней upstream-версией. Исследование в корректирующей редакции
привязано к тегу v3.9.0, commit a4b1596bc0d4ec479a2493541f275af37e9f7349 (получен по тегу,
GitHub): по нему прочитаны README, ctest-скрипты и файл документации
HTMLversion/HTML/phreeqc3-24.htm (глава KINETICS), совпадающий по проверенным ключевым
фрагментам с https://water.usgs.gov/water-resources/software/PHREEQC/documentation/phreeqc3-html/phreeqc3-24.htm.
Смежный репозиторий https://github.com/usgs-coupled/phreeqc3 содержит тот же README; точное
отношение двух репозиториев (зеркало, перенос, архив) в этой сессии не устанавливалось:
**(непроверено)**. Выводы о KINETICS, IPhreeqc и PhreeqcRM ниже привязаны к 3.9.0, если явно
не указано иное. Основная публикация: Parkhurst, D.L., Appelo, C.A.J.
(2013), «Description of input and examples for PHREEQC version 3. A computer program for
speciation, batch-reaction, one-dimensional transport, and inverse geochemical
calculations», U.S. Geological Survey Techniques and Methods, book 6, chapter A43,
DOI 10.3133/tm6A43. Сопутствующий отчёт по резервуарному моделированию: Parkhurst &
Appelo 1999, Water-Resources Investigations Report 99-4259.

### 6.2 Возможности (по официальной документации)

Домашняя страница USGS перечисляет: специацию, batch-reaction, одномерный транспорт,
обратные геохимические вычисления; насыщение растворов по равновесию с фазами (saturation
indices), растворение и осаждение по кинетике, реакции exchangers (ионный обмен) и
surface complexation (включая CD-MUSIC), фиксированные давления/объёмы, твёрдые растворы,
инверсные модели. Опции активности: Debye-Hückel (bdot), Pitzer, SIT (на страницах
документации phreeqc3-24 и связанных). Базы данных (phreeqc.dat, pitzer.dat, llnl.dat и
др.) распространяются с собственными условиями использования: происхождение данных не
совпадает с происхождением кода (см. §13).

### 6.3 Кинетика: два интегратора и их границы

Раздел KINETICS документации (первоисточник:
https://water.usgs.gov/water-resources/software/PHREEQC/documentation/phreeqc3-html/phreeqc3-24.htm;
сверено с файлом HTMLversion/HTML/phreeqc3-24.htm в теге v3.9.0):

- PHREEQC предлагает ДВА варианта интегрирования кинетики, и выбор задаётся пользователем,
  а не алгоритмом. Явный метод Рунге-Кутты используется по умолчанию: «Default is false if
  -cvode is not included; Runge-Kutta method is used». Неявный CVODE (Cohen & Hindmarsh
  1996: BDF/Adams с адаптивными порядком и шагом) включается явным параметром `-cvode true`.
- Параметр `-runge_kutta (1, 2, 3, или 6)` управляет порядком явного метода; по умолчанию 3.
  Значение 6 задаёт исключительно вложенную схему Рунге-Кутты 5-го порядка; при значениях
  1/2/3 и невыполнении допуска интегратор автоматически возвращается к схеме 5-го порядка.
  Это возврат ВНУТРИ семейства явных методов Рунге-Кутты, а не переход на CVODE.
- `-bad_step_max` (по умолчанию 500) документирован как «maximum number of integration
  attempts»: для явного Рунге-Кутты это число повторных попыток с уменьшенным шагом, для
  CVODE число повторных вызовов CVODE на шаг интегрирования (с ним связаны `-cvode_steps`
  и `-cvode_order`, по умолчанию 5). При исчерпании лимита расчёт останавливается с
  ошибкой. В документации встречается и написание `-bad_steps_max` (обзорный абзац той же
  главы): внутренняя непоследовательность документации зафиксирована, каноническим
  считается написание из описания параметра: `-bad_step_max`.
- Про жёсткость документация даёт совет, а не автоматический механизм: CVODE «more robust
  for stiff sets of equations». Автоматического переключения RK5 → CVODE по признакам
  жёсткости в документации нет.

Исправления первой редакции (признание ошибок): в первой редакции утверждалось, что (а)
PHREEQC автоматически переключается с RK5 на CVODE, (б) документация рекомендует
«переключиться на CVODE после примерно 30 уменьшений шага», (в) явная схема это вариант
Cash-Karp. Ни одно из этих утверждений не подтверждается первоисточником: выбор метода
делает пользователь параметром `-cvode`, рекомендация «~30 шагов» в документации не
найдена (число 30 не относится к выбору RK5/CVODE и не переносится на него), упоминание
Cash-Karp в главе KINETICS отсутствует. Все три утверждения отозваны.

Параллель к выбору EvoWars остаётся умеренной: PHREEQC подтверждает, что зрелый
геохимический код считает неявный метод более робастным для жёстких систем, но выбор
метода остаётся решением пользователя. EvoWars фиксирует неявный L-устойчивый Radau IIA
(3 стадии, порядок 5, CORE_SCIENTIFIC_ENGINE §2.8, ревизия 4.5.3) в контракте, а не
переключается между методами по эвристике; это осознанное архитектурное решение, для
которого практика PHREEQC служит фоном, а не доказательством автоматической смены
метода.

### 6.4 Кинетические реакции: модель

RATES определяет скорость через Basic-скрипт на каждом шаге интегратора: пользователь
пишет кинетическое выражение (закон действия, насыщение, произвольные формулы), PHREEQC
интегрирует dM/dt с температурной и площадной зависимостью (KINETICS: `-m`, `-m0`,
`-parms`, `TOL`, `-step_divide`; `-cvode` в блоке KINETICS выбирает CVODE для конкретной
реакции, причём «If neither true nor false is entered, true is assumed»; без параметра
реакция интегрируется явным Рунге-Куттой). Ограничение по существу: скорости это
пользовательские функции, а не
декларативные контракты с provenance; структурой это противоположно подходу EvoWars
(kineticsCatalog с per-record provenance KIDA/JPL, реакции с unknown/no_kinetic_data
не исполняются вовсе).

### 6.5 Транспорт и интеграция: IPhreeqc и PhreeqcRM

Одномерный транспорт: реакция и перенос разделяются (operator splitting, явные/неявные
схемы с balance на каждом шаге). Для встраивания в сторонние коды:

- IPhreeqc: модуль C++ с COM-подобным интерфейсом (строки команд, обмен строками),
  страница https://water.usgs.gov/software/IPhreeqc (на домашней странице PHREEQC v3).
  Интеграция через строковый протокол, состояние внутри объекта IPhreeqc.
- PhreeqcRM: репозиторий https://github.com/usgs-coupled/phreeqrm, обёртка для
  реактивно-транспортных симуляторов: сетка ячеек, initial/boundary conditions,
  MPI/OpenMP-параллелизм, конверсии единиц (моль/килограммы раствора и др.), run_cells.
  Это самый близкий индустриальный аналог контракта SolverBackend «алгебраическое
  равновесие в ячейке с граничными условиями» из существующих у EvoWars сцен.

Релизные заметки 3.9.0-17591 уточняют границу интеграции PhreeqcRM: добавлены
Python-callbacks (set_basic_callback, использование CALLBACK в RATES и USER_PUNCH,
set_mpi_worker_callback для MPI) и MPI для Python через mpi4py; исправлен расчёт
GetDensityCalculated. Это подтверждает направление PhreeqcRM на встраивание в сторонние
симуляторы с параллелизмом, но Python-интерфейс остаётся обёрткой над тем же ядерным
контрактом run_cells, а не новой вычислительной моделью.

### 6.6 Тесты

В репозитории phreeqc3 (корень дерева тега v3.9.0): `ctest.cmake` (функциональные тесты по
скриптам), `ctest.regression.cmake` (регрессионные тесты, сравнение выводов с эталонными
файлами), `CTestConfig.cmake`, `cmemcheck`-скрипты и `valgrind.cmake` (контур проверки
памяти), `.gitlab-ci.yml` и jenkins-скрипты (внешние CI-контуры).
Паттерн: выходы фиксированных сценариев сравниваются с сохранёнными эталонами; у такого
подхода известный риск (эталон фиксирует и корректное, и ошибочное поведение), в PHREEQC
он компенсируется длинной историей сопоставления с опубликованными расчётами (Parkhurst &
Appelo 2013 содержит верификационные примеры).

### 6.7 Лицензия: важно и неудобно

Файла LICENSE в корне репозитория (проверено по дереву тега v3.9.0) не обнаружено. README
тега v3.9.0 содержит дословный USGS-дисклеймер: «This software is preliminary or
provisional and is subject to revision. It is being provided to meet the need for timely
best science. The software is on the standard USGS web site... No warranty, expressed or
implied, is made by the USGS or the U.S. Government as to the functionality of the
software...» (проверено; сокращения отмечены многоточием). Код USGS распространяется как
предварительное программное обеспечение, а не как классическое «public domain» без
условий: статус публичного достояния для производного использования не заявляется.
Точный действующий текст «User Rights Notice» конкретной поставки в этой сессии не
открыт: **(непроверено)**; для любого производного использования требуется прочитать
notice непосредственно в поставке. Не считать PHREEQC «общественным достоянием по
умолчанию»: условия надо фиксировать по факту.

### 6.8 Где применимость PHREEQC заканчивается

PHREEQC это водная геохимия (равновесная специация в водных растворах, низкие T/P,
активности по Pitzer/SIT для рассолов). Прямое расширение на условия EvoWars
ограничено принципиально:

- силикатные расплавы и планетарные недра (T > 1500 K, давление ГПа, не водные фазы):
  databases Pitzer/SIT/llln не применимы вне водных растворов; фазы магмы в стандартных
  базах отсутствуют;
- газовая фаза и высокие давления: ideal gas / Peng-Robinson (PHREEQC имеет опцию
  Peng-Robinson для газа с 2013 года, tm6A43) ограничена; сопоставление с PURE PR EvoWars
  возможно только на пересечении областей применимости;
- кинетика: произвольные пользовательские скорости без per-record provenance; прямая
  подмена kineticsCatalog недопустима.

Вывод: PHREEQC не равнозначен моделированию силикатных расплавов и недр; его роль для
EvoWars это REFERENCE-оракул уровня 3 по водно-минеральным циклам (этап 4.9,
`mineral saturation indices`, резервуары), не бэкенд недр.

### 6.9 Сопоставление с EvoWars и решения

| Аспект EvoWars | Как решено в PHREEQC | Решение |
|---|---|---|
| Минеральные резервуары, насыщение, растворение/осаждение (4.9) | SI, EQUILIBRIUM_PHASES, KINETICS+RATES | REFERENCE: офлайн-оракул для водных сцен; ADAPT концепции SI не требует его исполнения |
| Жёсткая кинетика | явный Рунге-Кутта по умолчанию; CVODE по явному выбору пользователя (`-cvode true`), автоматической смены метода нет | умерленная параллель: неявный метод для жёстких систем это выбор пользователя/проекта, что согласуется с фиксированным контрактом Radau IIA; PHREEQC не источник данных |
| Контракт ячейки с граничными условиями | PhreeqcRM run_cells | STUDY: граница интеграции через IPhreeqc/PhreeqcRM, отдельное решение |
| Недра/расплавы | неприменимо | REJECT |
| Provenance коэффициентов | отсутствует (пользовательские скрипты) | REJECT как источник данных; fail-closed сохраняется |

## 7. REBOUND: подробный разбор

### 7.1 Идентификация и статус

Репозиторий: https://github.com/hannorein/rebound. Исследованная версия (корректирующая
редакция): REBOUND `5.2.2`, релиз 5 октября 2026, commit
c34134716cd484ed9cdb9f7d54ef8d859bdf547d (получен по тегу 5.2.2, GitHub; страница
релизов https://github.com/hannorein/rebound/releases, PyPI
https://pypi.org/project/rebound/). Первая редакция исследовала 4.4.11 и не учитывала
релизы 5.x; в 5.2.2 перепроверены интеграторы, SimulationArchive, тесты и лицензия.

Лицензия 5.2.2: `pyproject.toml` тега 5.2.2 задаёт `license = "GPL-3.0-only"` и
классификатор «Development Status :: 5 - Production/Stable»; в этом документе лицензия
указывается как GPL-3.0-only по pyproject.toml. Зафиксирована неоднозначность текстов:
файл LICENSE тега 5.2.2 содержит стандартный текст GPLv3 (с «or later» в бойлерплейте),
а README тега 5.2.2 сохраняет формулировку «either version 3 of the License, or (at your
option) any later version». Лицензионное обозначение «GPL-3.0-or-later» первой редакции
(по версии 4.4.11) не переносится на 5.2.2.

Основные публикации: Rein & Liu 2012, «REBOUND: an open-source multi-purpose N-body code
for collisional dynamics», A&A 537, A128
(https://aanda.org/articles/aa/full_html/2012/01/aa18085-11/aa18085-11.html);
IAS15: Rein & Spiegel 2015, MNRAS 446, 1424 (заголовок `src/integrator_ias15.c` тега
5.2.2 ссылается на работу Rein & Spiegel); JANUS: Rein & Tamayo 2017, MNRAS 467, 2377
(https://arxiv.org/pdf/1701.07423).

### 7.2 Интеграторы и выбор под динамический режим

Состав интеграторов по дереву тега 5.2.2 (каталог src/: файлы integrator_bs.c,
integrator_eos.c, integrator_ias15.c, integrator_janus.c, integrator_leapfrog.c,
integrator_mercurius.c, integrator_saba.c, integrator_sei.c, integrator_trace.c,
integrator_whfast.c, integrator_whfast512.c и simulationarchive.c):

- IAS15 (по умолчанию): implicit Runge-Kutta 15-го порядка с адаптивным шагом и
  гауссово-Радау разбиением; заявленная точность до машинной точности; контроль ошибок
  через нелинейную компенсированную схему (Rein & Spiegel 2015); параметр epsilon
  (по умолчанию 1e-9; предупреждение документации: для столкновительных или сильно
  хаотических систем epsilon следует подбирать). Режимы адаптивного шага присутствуют в
  исходнике тега 5.2.2: PRS23 (рекомендован Pham, Rein et al. 2024), INDIVIDUAL, GLOBAL,
  AARSETH85; значение adaptive_mode по умолчанию именно в 5.2.2 не сверялось:
  **(непроверено)** (в документации 4.x по умолчанию был PRS23).
- Symplectic: WHFast, SABA, SEI, LEAPFROG, EOS; плюс WHFast512: SIMD-интегратор,
  переписанный на x86-ассемблер в 5.1.0 (координаты Якоби, симплектические корректоры,
  отслеживание сближений и выбросов; заявка релизных заметок: точность до 5 порядков
  лучше и Солнечная система 5 млрд лет за 8.7 часа), в 5.2.0 добавлен решатель задачи
  Кеплера для эксцентричных и гиперболических орбит и корректоры для WHFast+DHC.
- Гибридные/переключающие: MERCURIUS (symplectic/Bulirsch-Stoer для систем со
  сближениями), TRACE, JANUS (bitwise-reproducible симплектик, Rein & Tamayo 2017).

Существенные интерфейсные изменения 5.0.0: новый интерфейс выбора интегратора
(reb_simulation_set_integrator, в Python атрибуты без префикса ri_, например
sim.integrator.safe_mode), имена частиц вместо хэшей, структуры Python допускают только
реальные поля, частицы отсортированы. Соответствие страниц сайта rebound.hanno-rein.de
сборке 5.2.2 не проверялось: **(непроверено)**; описание интеграторов выше привязано к
дереву тега и релизным заметкам.

Выбор интегратора по режиму это одновременно урок и предупреждение: REBOUND не
предлагает «один лучший интегратор», а даёт матрицу «динамический режим → схема»
(гамильтоновы долгоживущие → симплектик; хаос/столкновения → IAS15 или гибрид;
bitwise-reproducibility → JANUS). Это прямой паттерн для существующей архитектуры
SolverBackend EvoWars с problemKinds и семантикой
`bitwise_same_environment|within_tolerance|platform_dependent`.

### 7.3 Энергия и момент импульса

Симплектические интеграторы сохраняют модифицированный гамильтониан: дрейф энергии
ограничен и не накапливается на длинных сериях, но ошибка на шаге не мала в обычном
смысле (задокументировано в литературе по WH; на сайте в разделах интеграторов).
IAS15 non-symplectic: плотный вывод, контроль локальной ошибки до машинной точности,
но без симплектической гарантии. Практика: в примерах REBOUND регулярно проверяются
отклонения энергии E/E0 и момента L/L0 на длинных прогонах. Для VALIDATION_PLAN EvoWars
(Уровень 1 инварианты, Уровень 3 Луна 27.32 d ± 0.5 %) это модель контура: инвариант
проверяется как физический тест, а не только как unit-assert.

### 7.4 SimulationArchive: воспроизводимость и её границы

Первоисточники корректирующей редакции: ноутбук ipython_examples/SimulationarchiveRestart.ipynb
в дереве тега 5.2.2 и релизные заметки 5.0.0-5.2.2 (https://github.com/hannorein/rebound/releases).

- SimulationArchive это бинарный формат снапшотов симуляции: сохраняет состояние,
  параметры интегратора и время; побитовый рестарт подтверждён ноутбуком тега 5.2.2:
  «REBOUND can restart simulation *exactly* (bit by bit)».
- Машинная независимость между операционными системами подтверждена ноутбуком тега
  5.2.2: «this will even work if the SA file was generated on a different computer with
  a different operating system».
- Кросс-версионная совместимость НЕ является свойством формата. Релиз 5.0.0 (15 мая
  2026, https://github.com/hannorein/rebound/releases/tag/v5.0.0) прямо заявляет breaking
  change: «The file format for the Simulationarchive has been changed. Note that you can
  not read Simulationsarchives that were saved with a previous version». Формат
  версионируется (changelog 4.4.2: вывод номера версии, создавшей архив, при несовпадении
  версий), история 4.x уже содержит удаление поддержки старых версий формата. Ноутбук
  5.2.2 при этом всё ещё содержит фразу «and even a different version of REBOUND»: это
  противоречит релизным заметкам 5.0.0, противоречие зафиксировано, и вывод сделан по
  более свежему и специфичному источнику (релизные заметки). Первая редакция ошибочно
  утверждала безусловную совместимость архивов между версиями: утверждение отозвано.
- Ограничения рестарта (ноутбук тега 5.2.2): (а) снапшоты пишутся на первом шаге ПОСЛЕ
  истечения интервала (не на точных границах), для точного воспроизведения финиша нужно
  exact_finish_time=0; (б) для WHFast с выключенным safe mode рестарт требует
  `sim.integrator.keep_unsynchronized = 1` (в 5.x атрибуты без префикса ri_*);
  (в) сериализация additional forces и function pointers в материалах тега 5.2.2 не
  найдена: известное по документации 4.x ограничение перенесено с пометкой **(непроверено)
  для 5.2.2**; при любом использовании рестартов это проверяется по факту.

Для EvoWars это самая ценная находка по воспроизводимости, обновлённая версией 5.2.2:
(а) REBOUND фактически декомпозирует «bitwise» на «та же платформа/среда» и
«машинно-независимый формат»: EvoWars уже имеет эквивалент в `bitwise_same_environment`
vs `within_tolerance` (CORE_SCIENTIFIC_ENGINE §2.8); (б) урок 5.0.0: смена формата снапшотов
это управляемый разрыв совместимости, он требует версионируемого формата и явной политики
миграции, а не молчаливого чтения чужих архивов; (в) паттерн «снапшот + рестарт-тесты»
переносим в контракт сохранения состояния 1.x: снимки истории запусков EvoWars уже хранят
всё для воспроизведения, но рестарт-тестов в VALIDATION_PLAN нет; (г) перечень
несохраняемого это чек-лист для аудита сериализации EvoWars (что делать с вычислителями,
callbacks, таймерами при продолжении).

Для EvoWars это самая ценная находка по воспроизводимости: (а) контраст с
`platform_dependent` семантикой SolverBackend: REBOUND фактически декомпозирует
«bitwise» на «та же платформа» и «машинно-независимый формат»: EvoWars уже имеет
эквивалент в `bitwise_same_environment` vs `within_tolerance` (CORE_SCIENTIFIC_ENGINE
§2.8); (б) паттерн «снапшот + шаг-дельта + рандомизированные интервалы» переносим в
контракт сохранения состояния 1.x без изменения текущей схемы: снимки истории запусков
EvoWars уже хранят всё для воспроизведения, но рестарт-тестов (продолжить с снимка,
сравнить побитово) в VALIDATION_PLAN нет; (в) перечень несохраняемого у REBOUND это
чек-лист для аудита сериализации EvoWars (что делать с вычислителями, callbacks,
гонщиками таймеров при продолжении).

### 7.5 Тесты

Тестовый паттерн REBOUND по дереву тега 5.2.2: каталог `examples/` с per-example
`problem.c`, где каждый пример это самопроверяющийся сценарий (проверен, например,
examples/shearing_sheet/problem.c), плюс `ipython_examples/` и `python_examples/`.
Каталога `unittests/` в дереве тега 5.2.2 нет: утверждение первой редакции о unit-каталоге
отозвано. Поведение интеграторов проверяется на аналитических задачах и на проблемах из
публикаций (IAS15: Rein & Spiegel 2015, секция тестов). Содержимое CI-контура (.github)
тега 5.2.2 и наличие энергосохраняющего прогона как отдельного workflow не проверялись:
**(непроверено)**.

### 7.6 GPL-3.0-only (по pyproject.toml 5.2.2): последствия для EvoWars

Лицензия 5.2.2 фиксируется как GPL-3.0-only по pyproject.toml; тексты LICENSE и README
содержат «or later» (неоднозначность зафиксирована в §7.1). Следствия формулируются
осторожно и не считаются юридическим заключением:

1. Встраивание кода REBOUND в распространяемый код EvoWars (linking в том смысле,
   который GPL применяет к производным произведениям) обязывало бы распространять
   это произведение по GPL-совместимой лицензии. Лицензия самого EvoWars и планы его
   распространения в этой сессии не проверялись. Пока отдельного лицензионного анализа
   нет: REJECT встраивание, REFERENCE офлайн.
2. Использование как внешний офлайн-оракул (запуск отдельным процессом, сравнение
   результатов по файлам) это текущая роль в VALIDATION_PLAN (таблица оракулов:
   REBOUND уровень 2, офлайн). При этом отсутствие GPL-обязательств при такой схеме НЕ
   заявляется гарантированным: окончательный вывод требует анализа конкретной схемы
   распространения EvoWars и взаимодействия компонентов (что именно распространяется,
   передаются ли производные произведения REBOUND, как лицензируются связки сценариев
   и данных). До этого анализа фиксируется только рабочая гипотеза, согласованная с
   действующей практикой репозитория.
3. Данные (архивы, конфиги), созданные запуском REBOUND, не подпадают под GPL как
   таковые, но паттерн «снапшот-формат» заимствуется как идея, не как код.

Отдельно: README тега 5.2.2 содержит явную политику против AI-generated code:
«AI-generated code conflicts with this project's license, since you cannot truly
release code for use if you didn't author it yourself» (проверено дословно). Для
настоящего исследования это означает: НЕ предлагать генерировать патчи в REBOUND и не
переносить код REBOUND дословно в любой AI-ассистированный репозиторий; заимствуются
только методы, форматы и архитектурные идеи, в соответствии с §13 и политикой
происхождения EvoWars.

### 7.7 Сопоставление с EvoWars и решения

| Аспект EvoWars | Как решено в REBOUND | Решение |
|---|---|---|
| Орбитальная динамика (4.6, ADR-P2: аналитический Кеплер по умолчанию, интеграторы подключаемые) | 11 интеграторов (integrator_*.c тега 5.2.2, включая WHFast512 и SABA), выбор по режиму | REFERENCE: офлайн-оракул (версия оракула фиксируется, включая SHA); ADAPT матрицу «режим → метод» для реестра бэкендов |
| Воспроизводимость (снапшоты истории 1.x, deterministic семантика) | SimulationArchive: бинарные снапшоты, bitwise рестарт, формат менялся в 5.0.0 (архивы предыдущих версий не читаются), честные ограничения | ADAPT: паттерн снапшотов + версионирование формата + рестарт-тесты; REJECT встраивание (GPL-3.0-only, без отдельного решения) |
| Проверка инвариантов | энергия/момент в examples как самоцель | ADAPT: инварианты в физическую валидацию Уровня 1/3 |
| Долгоживущие N-body ансамбли | WHFast/SABA/JANUS/WHFast512 symplectic (5.1-5.2) | STUDY: если EvoWars понадобится длинная орбитальная эволюция после 4.6, симплектические методы оправданы; текущий Кеплер-по-умолчанию не меняется |

## 8. VPLanet: подробный разбор

### 8.1 Идентификация и статус

Репозиторий: https://github.com/VirtualPlanetaryLaboratory/vplanet. Исследованная версия:
v2.5.36, тег v2.5.36, commit 35472e7814cf98ea39c2fc7f035a10ee3bd98a62 (релиз от 20.02.2026;
страница релизов https://github.com/VirtualPlanetaryLaboratory/vplanet/releases). Лицензия:
MIT, файл LICENSE по тегу v2.5.36
(https://raw.githubusercontent.com/VirtualPlanetaryLaboratory/vplanet/v2.5.36/LICENSE,
«Copyright (c) 2018 The VPLANET Team», текст MIT проверен); в корректирующей редакции
ссылки на исходники и тесты закреплены за тегом v2.5.36, а не за изменяемой веткой main.
Документация исследовалась на дату 2026-11-10. Основная публикация: Barnes, R. et al. 2020,
«VPLanet: The Virtual
Planet Simulation Platform», PASP 132, 024502 (ADS: 2020PASP..132b4502B; DOI
10.1088/1538-3873/ab3ce8; arXiv:1905.06367).

### 8.2 Архитектура физических модулей

Документация (https://virtualplanetarylaboratory.github.io/vplanet/) описывает систему
из ~13 физических модулей: AtmEsc (потеря атмосферы), Binary (двойные системы), DistOrb
(орбитальная эволюция, распределённые параметры), DistRot (приливное вращение), EqTide
(равновесные приливы), Flare (вспышки), GalHabit (галактическая обитаемость), MagmOc
(магматический океан), POISE (поверхностная энергобалансовая модель климата), RadHeat
(радиоактивный нагрев), SpiNBody (N-body/спин), Stellar (звёздная эволюция), ThermInt
(тепловая интериоризация). Модули подключаются per-body декларативно во входном файле:
система описывается телами с «FeO», «Mass», «Radius», планетой с модулями
(eqtide, radheat, atmesc), звездой с (stellar), и т.д.

Ключевые архитектурные черты:

- Один управляющий цикл интегрирует все включённые модули тел одновременно (coupled
  integration); модули это не отдельные программы, вкладчики правой части общего
  интегратора с общим состоянием тел.
- Порядок исполнения модулей фиксирован внутренним списком (порядок в исходном коде
  определяет последовательность операций на шаге). Точный порядок и механизм разрешения
  конфликтов за один шаг в этой сессии по help.html не проверены: **(непроверено)**;
  для переноса требуется отдельное чтение исходника.
- Инициализация: каждый модуль читает свои параметры из входного файла, вычисляет
  производные величины (все «Comp», computed параметры), проверяет согласованность
  (например, SanterneMSini, вычисляемое из множества модулей, обязано совпасть).
- Времена: общее время симуляции, модульное время (например, EqTide хранит собственное
  собственное дельта-t (dTide)), остановка по критериям (StopTime, StopFlux,
  RocheIntersects и т.д.).

Сопоставление с EvoWars: у EvoWars связывание подсистем уже реализовано иначе и
осознанно: Scheduler владеет шагом, глубокий снимок CoreWorldState перед оператором,
sub-cycling для быстрых процессов, обмен через явные контракты данных
(PHYSICS_ARCHITECTURE §4). Подход VPLanet (единый большой интегратор всех процессов
тела) даёт согласованность автоматом, но жертвует изоляцией: в VPLanet модуль имеет
прямой доступ к общему состоянию, тогда как в EvoWars операторы получают снимок и
возвращают дельту. Паттерн VPLanet переносить как замену Scheduler не нужно и нельзя
(это меняло бы ядро); переносима дисциплина «параметры, вычисляемые несколькими
модулями, обязаны совпасть при инициализации».

### 8.3 Сценарии и примеры: реестр эталонов

Каталог `examples/` (страница https://virtualplanetarylaboratory.github.io/vplanet/examples.html,
дерево репозитория): десятки сценариев, каждый привязан к публикации: ArnsheimAtmEsc,
BaraffeStar, BellStellarWinds, CatastropheMoonFormation, Chirons, ClimateStellar,
DayNightWeathering, EarthMoonTides, EscapeRegimeChart, ExoplanetEqs, HollandKite,
и другие (полный перечень на странице examples). Каждый пример имеет входной файл,
ожидаемые величины и ссылку на статью; воспроизведение проверяется сравнением с
опубликованными кривыми (графиками) с допусками, взятыми из разброса исходных данных.

Отдельно и показательно: раздел «Broken» в examples с честным списком неработающих
сценариев, помеченных и отключённых (страница examples: «These examples are
known to be broken»). Культурный урок: зрелый проект не скрывает сломанные тесты, а
ведёт их отдельным списком с указанием причины. Для EvoWars это паттерн для реестра
сценариев Уровня 3/4 VALIDATION_PLAN: статус не только pass/fail, но и
known-broken/excluded с причиной.

Мотивация проекта сформулирована в README дословно: «We can't claim we found life beyond
the Earth with closed-source or unreliable software!» Это ближайшая по духу позиция к
EvoWars: научная воспроизводимость как требование к инфраструктуре, а не приятный
побочный эффект.

### 8.4 Экосистема и воспроизводимость

- vspace: генерация сетей симуляций (параметрические развёртки);
- multi-planet: параллельный запуск сетей (mpirun);
- vplot: визуализация результатов;
- Big-Planet: база данных результатов для последующего анализа.

Воспроизводимость обеспечивается тем, что входной файл полностью детерминирует запуск
(все параметры явные), сценарии версионируются с кодом, и статьи дают эталонные
значения. Дополнительных механик побитовой воспроизводимости (типа SimulationArchive)
в VPLanet нет: рестарт это пере-инициализация с начального файла. Для EvoWars: сценарная
воспроизводимость «вход + версия кода → сравнение с эталоном» совместима с уже
принятым подходом снимков истории (полнота входа в снимке 1.1.0), без побитовых
гарантий, кроме задекларированных в deterministic семантике.

### 8.5 Тесты и CI

Интеграционные тесты это сами examples с ожидаемыми значениями; unit-уровень представлен
тестами парсера и вычислительных функций (в репозитории тестовый контур существует,
полный перечень файлов тестов не собирался: **(непроверено)**). CI: GitHub Actions на
push/PR с компиляцией и прогоном примеров (наличие workflow подтверждено деревом
`.github/workflows`; покрытие и пороги не проверялись: **(непроверено)**).

### 8.6 Сопоставление с EvoWars и решения

| Аспект EvoWars | Как решено в VPLanet | Решение |
|---|---|---|
| Реестр эталонных планетарных сценариев (VALIDATION_PLAN Уровень 3/4) | examples/: сценарий = вход + публикация + ожидаемые значения; статусы включая broken | ADAPT: система сценариев со статусами и ссылками на эталоны |
| Согласованность параметров, вычисляемых разными модулями | Comp-параметры обязаны совпасть при инициализации | ADAPT: перекрёстные проверки инициализации в InvariantAuditor-контуре |
| Позиция «открытая и надёжная наука» | README-манифест | совпадает с позицией EvoWars, укрепляет выбор fail-closed по умолчанию |
| Связывание подсистем | единый интегратор с прямым доступом к состоянию | REJECT как замена Scheduler (иная и уже принятая архитектура снимков/операторов) |

## 9. Сравнительная архитектурная матрица

Сводная матрица «аспект → проект»; клетка: краткое решение проекта и (в скобках) его
решение для EvoWars.

| Аспект | PROTEUS | CoolProp | Cantera | PHREEQC | REBOUND | VPLanet | EvoWars сейчас |
|---|---|---|---|---|---|---|---|
| Модульная архитектура | слоты + интерфейсы + dummy | единая библиотека, бэкенды HEOS/cubic | объектная модель фаз/реакторов | процедурное ядро + базы | библиотека интеграторов | модули тел в общем цикле | операторы + Scheduler + снимок состояния |
| Реестр заменяемых реализаций | да (getters по списку) | да (типы бэкендов) | частично (интеграторы) | нет (компилируемый сценарный язык) | да (integrator switch) | частично (модули per-body) | PlannedBackendDescriptor, пустые implementedMethods |
| Координатор вычислений | coupling loop, порядок фиксирован | нет (библиотека вызовов) | ReactorNet | transport loop | sim.integrate() | главный цикл тел | Scheduler: очередь, sub-cycling, Lie/Strang |
| Контракты данных | config + справочники | fluid JSON, units в данных | YAML с units/диапазонами | input-скрипты | SimulationArchive (бинарный) | входной файл тел | версии схемы 1.x, миграции fail-closed |
| ODE-интегрирование | внешние модули (SPIDER и др.) | нет | CVODES/IDAS (SUNDIALS) | явный Рунге-Кутта по умолчанию / CVODE по явному выбору пользователя (`-cvode true`) | IAS15/WHFast/SABA/WHFast512/JANUS/... (11 файлов integrator_*.c тега 5.2.2) | собственный RK-адаптивный (в главном цикле) | Radau IIA (ts-radau-iia), порядок 5, L-stable |
| Равновесие/flash | нет (физика модулей) | Михельсен 2 этапа, GDEM, trust region | нет (кинетика) | speciation Newton-Raphson | нет | нет | PURE PR + TPD-поиск (сертификация за validatedErrorBound) |
| Воспроизводимость | golden_run.tsv | не акцентирована | не акцентирована | ctest-регрессия | SimulationArchive, bitwise рестарт; формат менялся в 5.0.0 (архивы предыдущих версий не читаются) | вход+версия+публикация | deterministic семантика, снимки истории, SHA-256 траектории |
| Тестовая пирамида | unit + integration pairwise + golden | unit (Catch2) + smoke | unit (googletest) + 0D | функциональные + регрессионные ctest | examples как самопроверки | examples по публикациям + broken | 174+ теста, VALIDATION_PLAN 5 уровней |
| CI | coverage-baseline + nightly | Catch2 + колёса | CI matrix, googletest | ctest | Makefile/CI | GitHub Actions | verify: tsc + tests + lint + build |
| Лицензия | Apache-2.0 (LICENSE.txt@26.10.16) | MIT (LICENSE@v8.0.0) | BSD-3 (License.txt@v3.2.0) | USGS provisional (README@v3.9.0), notice (непроверено) | GPL-3.0-only (pyproject.toml@5.2.2) | MIT (LICENSE@v2.5.36) | (не проверялась в этой сессии) |
| Язык | Python (+Fortran/C-модули) | C++ | C++ (+Python) | C | C | C | TypeScript |
| Статус зрелости | Alpha (PyPI fwl-proteus 26.10.16) | (непроверено) | (непроверено) | provisional (README USGS) | Production/Stable (pyproject.toml@5.2.2) | (непроверено) | внутренний проект |

Ключевой вывод матрицы: EvoWars по структуре (координатор+снимки, версии схемы,
deterministic семантика, provenance) уже сопоставим со зрелыми проектами; главные
разрывы: (1) отсутствие интеграционных pairwise-тестов обмена между подсистемами;
(2) отсутствие golden-сценариев полного прогона; (3) отсутствие рестарт-тестов
воспроизводимости; (4) отсутствие реестра планетарных сценариев со статусами.
Все четыре закрываются паттернами PROTEUS/REBOUND/VPLanet без изменения ядра (§12).

## 10. Сопоставление с незакрытыми задачами EvoWars

Сводка по этапам дорожной карты (номера по IMPLEMENTATION_ROADMAP; статусы не
переоцениваются: исследование не закрывает этапы).

### 10.1 4.2.3: химия на Scheduler

Проблема: химические операторы в очереди Scheduler, согласованность sub-cycling,
инварианты обмена. Находки: PROTEUS решает аналогичную задачу координатором coupling loop
с фиксированным порядком вызовов и передачей граничных условий между модулями на каждом
шаге; Cantera решает сопряжение реакторов через ReactorNet с единым интегратором и
явными стенками (Wall) для переноса энергии/вещества; PHREEQC разделяет транспорт и
химию (operator splitting с балансом на каждом шаге). Для EvoWars: текущая архитектура
Scheduler (снимок → оператор → дельта, sub-cycling, Lie/Strang) покрывает все три
паттерна; переносить чужой координатор не нужно (REJECT), но нужен интеграционный тест
обмена веществом/энергией между двумя операторами (см. BM-6), которого нет.

### 10.2 4.4.4.x: PR/EOS и 4.4.4.4.x: TPD

Проблема: фазовая устойчивость смесей и сертификация численной ошибки TPD. Находки:
CoolProp (§4) даёт образец структуры поиска (Wilson-инициализация с двух сторон, SS+GDEM,
минимизация 2-го порядка в α-переменных, честный список отказов) и образец честности
(задокументированные ложные «stable» и перекрёстная проверка). Гарантий глобальной
устойчивости нет ни у CoolProp, ни у кого-либо из исследованных: это не «отставание
EvoWars», а состояние области. Переносимо: структура этапа 1 как future-расширение
поиска 4.4.4.4.2, перекрёстная проверка вердикта «устойчиво» дешёвым критерием.
Непереносимо: объявление устойчивости доказанной без validatedErrorBound (REJECT,
сохраняется правило indeterminate). NO-GO непрерывной границы (платформенные логарифмы)
подтверждается практикой CoolProp, где lnφ считается обычными платформенными
логарифмами без интервальной арифметики.

### 10.3 4.5.x: химическая кинетика

Проблема: контракты реакций, третьи тела, fall-off, единицы, интегрирование жёстких
систем. Находки: Cantera (§5) даёт референс контрактов: единицы в данных, явные
`(+N2)`, семантика дублей, диапазоны применимости в данных; Troe/SRI формулы в
`Falloff.cpp` с защитой SmallNumber. PHREEQC (§6.3) предлагает два метода интегрирования
кинетики, и выбор задаёт пользователь: явный Рунге-Кутта по умолчанию, неявный CVODE
включается явным параметром `-cvode true`; автоматической смены метода по признакам
жёсткости нет, документация лишь рекомендует CVODE как более робастный для жёстких
систем. Это фоновая параллель к фиксированному контракту Radau IIA, а не доказательство
автоматического выбора метода. Текущие контракты
EvoWars (механизменная размерность cm3_per_molecule_per_s, fall-off контракт 4.5.2,
Radau IIA) соответствуют отраслевой практике; коэффициенты не переносятся ни откуда,
кроме KIDA/JPL (REJECT подмена, сохраняется fail-closed для №1/№70/№72).

### 10.4 4.6: орбитальная динамика

Проблема: подключаемые интеграторы и их валидация. Находки: REBOUND 5.2.2 (§7; оракул
фиксируется версией и SHA c34134716cd484ed9cdb9f7d54ef8d859bdf547d) даёт матрицу
«режим → интегратор» (11 интеграторов, включая SIMD WHFast512) и офлайн-оракул IAS15
(уже числится в таблице оракулов VALIDATION_PLAN
уровень 2; для воспроизводимости сопоставлений версию оракула нужно фиксировать так же,
как фиксируются версии CoolProp 8.0.0 и Cantera 3.2.0 в DATA_PROVENANCE). Текущий
аналитический Кеплер (ADR-P2) не меняется; при появлении интеграторов
в реестре бэкендов референс-паттерн REBOUND по выбору схемы по режиму применим к
документации контрактов SolverBackend. Встраивание REBOUND: REJECT (GPL-3.0-only,
отдельное решение).

### 10.5 4.7: недра

Проблема: тепловой/химический перенос в недрах. Находки: PROTEUS использует внешние
бэкенды недр: Aragog (энергосбалансированная конвекция, современная замена SPIDER),
SPIDER (классический код Magma Ocean), Zalmoxis (недра сверхземель) (все
упоминаются в документации PROTEUS как альтернативные реализации слота interiors);
в PROTEUS слот недр заменяемый, dummy реализация позволяет гонять полный цикл без
физики недр. Для EvoWars: REFERENCE PROTEUS-паттерн «слот + dummy + реальная реализация
позже»; конкретные коды недр это STUDY вне рамок настоящего документа (их собственные
лицензии и научные контракты не исследовались: **(непроверено)**).

### 10.6 4.8: климат

Проблема: поверхностный энергобаланс. Находки: PROTEUS интегрирует AGNI (radiative-convective
многослойная модель, forward model и retrieval) и поддерживает JANUS legacy;
VPLanet имеет POISE (0D/1D EBM). Все три подхода к климату через заменяемые реализации
слота атмосферы. Для EvoWars: ADAPT паттерн слота (уже совместим с PlannedBackendDescriptor);
конкретная климатическая модель не выбирается в этом документе (STUDY).

### 10.7 4.9: геохимические циклы

Проблема: минеральные резервуары, насыщение, растворение/осаждение, замкнутые циклы.
Находки: PHREEQC 3.9.0-17591 (§6) это референс предметной области: SI, EQUILIBRIUM_PHASES, кинетика
растворения; IPhreeqc/PhreeqcRM как граница интеграции; применимость заканчивается на
водной геохимии. Для EvoWars: REFERENCE офлайн-оракул водных сцен; ADAPT концепции
SI/резервуаров в собственные контракты; REJECT PHREEQC для расплавов/недр. Критерий
замкнутости (углерод 1e-9 за 1000 шагов) не меняется; PHREEQC может служить вторым
независимым оракулом для отдельных водных под-сценариев после появления этапа 4.9.

### 10.8 Воспроизводимость и сохранение состояния

Находки: REBOUND SimulationArchive (bitwise-рестарт и машинная независимость между
операционными системами подтверждены по материалам тега 5.2.2; кросс-версионная
совместимость формата НЕ гарантируется: релиз 5.0.0 прямо заявляет нечитаемость архивов
предыдущих версий; честный список несериализуемого, рестарт-тесты); PROTEUS golden_run.tsv (золотые
полные прогоны); VPLanet сценарии-по-публикациям. Для EvoWars: текущая схема снимков
истории (полный вход в снимке 1.1.0, SHA-256 контрольной траектории, deterministic
семантика bitwise_same_environment|within_tolerance|platform_dependent) покрывает
полноту входа; разрыв в рестарт-тестах: нет теста «продолжить с сохранённого снимка и
получить ту же траекторию в рамках задекларированной семантики». ADAPT: добавить
рестарт-тесты как Уровень VALIDATION_PLAN (не в этом документе, отдельным пакетом).

## 11. Benchmark и independent validation plan

Общие правила для всех сценариев: одинаковые входные условия фиксируются в сценарии
репозитория; единицы явно; оракул запускается офлайн вне CI-тестов (CI проверяет только
зафиксированные эталонные значения или сами тесты-сценарии); расхождение с оракулом это
диагностика и `indeterminate`, не подгонка допусков под результат.

### BM-1. Fall-off функция (синтетическая, против Cantera)

- Вход: синтетические Troe-параметры (не KIDA/JPL: параметры генерируются как тестовые
  константы, происхождение «synthetic test vector»), сетка Pr от 1e-4 до 1e4, T = 300,
  500, 1000, 2000 K.
- Сравнение: F(Pr, T) из формулы Трое в реализации EvoWars против Cantera 3.2.0
  (`TroeRate::F` через Python API), а также Lindemann F как вырожденный случай.
- Допуск: оба кода вычисляют одну формулу в double; ожидаемое расхождение это несколько
  ULP на транслогарифмических операциях. Предварительная оценка порядка 1e-13
  относительная; это предположение о величине, не измерение: допуск будет обоснован
  фактическим ULP-анализом при создании сценария, до этого помечается как
  «предстоит определить».
- Критерий успеха: все точки в допуске; любое систематическое расхождение это дефект
  формулы, а не допуск.
- Ограничение: сценарий проверяет только формулу F, не данные. Коэффициенты №89/№106
  в сценарии не участвуют.

### BM-2. Интегрирование №89/№106 (против Cantera CVODES)

- Вход: механизм из двух реакций с фактическими KIDA/JPL параметрами №89/№106 в
  эквивалентном YAML Cantera (falloff с (+N2)), конверсия единиц molecule/cm3 ↔ mol/cm3
  выполняется в сценарии явно и документируется; начальные концентрации из снимка
  реального запуска EvoWars; изотермический реактор постоянного объёма.
- Сравнение: профили концентраций на сетке времён; эффективные k_eff(Pr) в точках.
- Допуск: предстоит определить. Способ обоснования при создании: исследование
  сходимости (dt → dt/2 → dt/4) обоих интеграторов и сравнение в области, где оба
  сошлись к своей асимптоте. Числа не выдумываются заранее.
- Критерий успеха: в области установленной сходимости профили совпадают в допуске;
  вне области сценарий честно возвращает indeterminate с указанием причины (жёсткость,
  граничные Pr).
- Особые случаи: температура вне диапазона применимости KIDA-записи → indeterminate.

### BM-3. EOS PR (против CoolProp): уже реализовано

Существующий benchmark CoolProp 8.0.0 (custom-fluids EVW-*, rtol 1e-3 чистые, 2e-4 смеси,
mpmath rtol 5e-13; DATA_PROVENANCE) закрывает этот пункт для чистых компонентов и смесей.
Расширение по итогам настоящего исследования: добавить точки в околокритической области
и смеси с компонентом, для которого kij отсутствует (ожидаемое поведение: fail-closed, не
результат). Допуски прежние, обоснование прежнее (детали в DATA_PROVENANCE).

### BM-4. TPD знак-согласие (против CoolProp Михельсен этап 1)

- Вход: binary/ternary смеси из каталога компонентов, сетка (T, P, z), включая точки
  вблизи фазовой границы.
- Сравнение: качественное: знак минимального найденного TPD (неустойчивость найдена или
  нет) у EvoWars (поиск 4.4.4.4.2, вердикты только при validatedErrorBound, иначе
  indeterminate) против CoolProp is_stable + Michelsen stage 1.
- Допуск: численный допуск на значение TPD не устанавливается (разные EOS-модели:
  PURE PR EvoWars против Helmholtz/PR CoolProp; согласие значений не ожидается).
  Критерий: согласие по знаку в точках, где оба метода сделали вывод.
- Случаи indeterminate (обязательные): расхождение знаков вблизи границы (оба метода
  локальны); отсутствие validatedErrorBound у вердикта EvoWars; ложный «stable»
  CoolProp-паттерн (§4.4) в подозрительных точках. Расхождение знака не «подгоняется»:
  оно фиксируется как материал для анализа, вердикт EvoWars остаётся indeterminate.

### BM-5. Орбитальная динамика (против аналитики и REBOUND)

- Вход: Земля-Луна (проверочный период 27.32 d), тестовая задача Хилла (потеря
  устойчивости), простой leapfrog на круговой орбите.
- Сравнение: период лунной орбиты (допуск ± 0.5 %, VALIDATION_PLAN Уровень 3), сфера
  Хилла (± 2 %), дрейф энергии leapfrog (порядок 1e-6 за прогон, как в существующих
  тестах), REBOUND 5.2.2 IAS15 (epsilon 1e-9; оракул фиксируется версией и commit SHA
  c34134716cd484ed9cdb9f7d54ef8d859bdf547d; oracle snapshot фиксирует и версию
  формата SimulationArchive, урок breaking change 5.0.0) как офлайн-оракул для
  нетривиальных траекторий (например, резонансная пара).
- Допуски: взяты из VALIDATION_PLAN и существующих тестов; новые допуски для IAS15-
  сравнений предстоит определить (исследование сходимости, аналогично BM-2).

### BM-6. Инварианты обмена модулей (PROTEUS-паттерн, против аналитики)

- Вход: минимальный мир из двух подсистем (например, фотохимия + резервуар), сценарий
  1000 шагов, замкнутый по углероду.
- Сравнение: полный углерод системы против начального; бюджет-таблица источников и
  стоков по операторам (как PROTEUS Budget).
- Допуск: 1e-9 за 1000 шагов (существующий критерий 4.9), обоснование: точность double
  на суммах 1e3 операций.
- Критерий успеха: инвариант в допуске при любых допустимых порядках исполнения
  операторов (проверка перестановками, PROTEUS pairwise-паттерн).

### BM-7. Целые планетарные сценарии (против публикаций)

- Вход: реестр сценариев Уровня 3 VALIDATION_PLAN (Земля: g 9.807 ± 0.3 %, T_eq 255 K
  ± 1 K, RCM 288 K ± 10 K; Луна 27.32 d ± 0.5 %; Хилл ± 2 %; Марс/Венера/Титан/Юпитер/Ио:
  порядок величин энергетических потоков 1e14 Вт).
- Сравнение: опубликованные значения (как VPLanet examples привязаны к статьям);
  источники эталонов фиксируются per-scenario.
- Допуски: из таблицы VALIDATION_PLAN; для новых сценариев допуск обосновывается
  разбросом исходных данных публикации, не назначается произвольно; при невозможности
  обосновать пишется «предстоит определить» и сценарий получает статус draft.
- Статусы: pass / fail / known-broken (с причиной, паттерн VPLanet) / excluded.

## 12. Предлагаемая система тестирования EvoWars

Наложение на существующие 5 уровней VALIDATION_PLAN (не замена, а конкретизация
механики; существующий контур verify в CI сохраняется):

- Уровень 0, smoke (PR-контур): tsc + unit + lint + build; полный объём unit-тестов
  остаётся в PR-контуре (репозиторий небольшой, время прогона не аргумент для
  сокращения); паттерн PROTEUS: быстрый обязательный контур + расширенный nightly.
- Уровень 1, инварианты на шаге: существующие unit-тесты инвариантов + BM-6
  (перестановки операторов); InvariantAuditor продолжает аудит только записей шага.
- Уровень 2, аналитика + оракулы: BM-1, BM-5; оракулы Cantera/CoolProp/REBOUND офлайн,
  эталонные значения фиксируются в репозитории с provenance оракула (версия, вход,
  дата), паттерн «oracle snapshot»: CI сравнивает с зафиксированным, не вызывает
  оракул.
- Уровень 3, эталонные планеты: реестр сценариев BM-7 со статусами pass/fail/
  known-broken/excluded (паттерн VPLanet broken-списка); таблица допусков уже есть в
  VALIDATION_PLAN, расширяется по правилу «допуск обоснован источником».
- Уровень 4, golden-прогоны: паттерн PROTEUS golden_run.tsv: фиксированный вход,
  зафиксированный SHA-256 сводки выхода; обновление эталона требует отдельного PR с
  обоснованием (не молчаливый rebase эталона).
- Уровень 5, чувствительность и сходимость: правило VALIDATION_PLAN (dt → dt/2 → dt/4)
  как генератор допусков для BM-2/BM-5; воспроизводимость рестартов: тест «продолжить
  с сохранённого снимка, траектория совпадает в пределах задекларированной
  deterministic семантики» (паттерн REBOUND SimulationArchive-тестов).

Почему тысячи unit-тестов не доказывают физическую согласованность: unit-тест проверяет
согласованность кода с собственными ожиданиями; CURRENT_SYSTEM_AUDIT фиксирует это
прямо: «Тесты и CI не считаются доказательством научной полноты, это только
доказательство согласованности кода с самим собой». Исследование подтверждает три
конкретных механизма, через которые зелёные unit-тесты соседствуют с физически ложным
поведением: (1) CoolProp: локальная невязка в TPD-минимизации сходится в тривиальную
точку и зрелая библиотека возвращает ложный «stable», что задокументировано в её же
исходнике; unit-тесты на компоненты этого не ловят, ловит только перекрёстная проверка
против независимого критерия; (2) PROTEUS: модульные тесты проходят у каждого модуля,
но согласованность обмена (масса между атмосферой и недрами) проверяется отдельным
уровнем pairwise-интеграционных тестов, потому что ошибки обмена не видны ни одному
из модульных тестов; (3) VPLanet: примеры честно классифицируются как broken, потому
что unit-уровень не может подтвердить совпадение с опубликованной кривой. Общий вывод:
физическая согласованность доказывается только сравнением с внешним эталоном
(публикация, оракул, инвариант), unit-тесты необходимы, но структурно не достаточны.

## 13. Лицензионный и provenance-аудит

| Проект | Версия исследована | Лицензия (проверено по файлу) | Зависимости с собственными лицензиями | Коммерческое использование | Встраивание в Rust/WASM-планы EvoWars |
|---|---|---|---|---|---|
| PROTEUS | 26.10.16 (тег 26.10.16, commit e6c872f6205f2d3aa213a83136fc02e5fdace2d6; PyPI: Development Status 3 - Alpha) | Apache-2.0 (LICENSE.txt тега 26.10.16, проверен) | модули-репозитории (Aragog, SPIDER, Zalmoxis, AGNI и др.) отдельные репозитории с собственными лицензиями: не проверены по отдельности (непроверено) | да (Apache-2.0) | нет планов; заимствуются паттерны, не код |
| CoolProp | 8.0.0 (тег v8.0.0, commit ae81610e7d23efc57f9d051c8e70a4d66e87537f) | MIT (LICENSE тега v8.0.0, проверен) | THIRD_PARTY_NOTICES.md; вендоримые pinned Eigen/fmt со своими лицензиями; данные флюидов с собственным происхождением, MIT кода НЕ покрывает данные | да (MIT) | нет; офлайн-оракул (уже используется) |
| Cantera | 3.2.0 (тег v3.2.0, commit 4a8358eb80cfeb50474386b5f9ec0b3a83519889) | BSD-3 (License.txt тега v3.2.0, проверен) | SUNDIALS (BSD), Boost и др.: лицензии зависимостей индивидуально не проверялись (непроверено) | да (BSD-3) | STUDY; производство Rust/WASM заблокировано отдельным решением |
| PHREEQC | 3.9.0-17591 (тег v3.9.0, commit a4b1596bc0d4ec479a2493541f275af37e9f7349); USGS downloads: 3.8.6-17100 | файла LICENSE в репо нет; README тега v3.9.0: USGS preliminary/provisional software (дисклеймер проверен дословно), User Rights Notice не открыт (непроверено) | базы данных с собственным происхождением (llnl.dat и др.) | не подтверждено до прочтения notice (непроверено) | нет; при интеграции только отдельный процесс (IPhreeqc/PhreeqcRM) |
| REBOUND | 5.2.2 (тег 5.2.2, commit c34134716cd484ed9cdb9f7d54ef8d859bdf547d) | GPL-3.0-only (pyproject.toml тега 5.2.2; LICENSE/README содержат «or later»: неоднозначность зафиксирована в §7.1) | ядро самодостаточно; расширения (reboundx и др.) отдельные репозитории (не проверены) | да, при GPL-условиях | REJECT встраивание (GPL-3.0-only); REFERENCE офлайн |
| VPLanet | v2.5.36 (тег v2.5.36, commit 35472e7814cf98ea39c2fc7f035a10ee3bd98a62) | MIT (LICENSE тега v2.5.36, проверен) | модульных зависимостей не выявлено в этой сессии (непроверено) | да (MIT) | нет планов; заимствуются паттерны |

Принципы, подтверждённые практикой исследованных проектов:

1. Лицензия основного проекта не распространяется автоматически на зависимости и
   данные. CoolProp ведёт THIRD_PARTY_NOTICES.md и вшивает лицензии вендоримых
   Eigen/fmt; EvoWars уже применяет эквивалентный принцип к CoolProp: «MIT пакета
   CoolProp НЕ трактуется как происхождение/условия его данных» (DATA_PROVENANCE).
2. Код и данные имеют разные условия: базы PHREEQC, флюидные данные CoolProp,
   механизмы Cantera (gri30 с собственными ограничениями происхождения) требуют
   отдельной фиксации provenance при любом использовании.
3. REBOUND (GPL-3.0-only по pyproject.toml 5.2.2) используется только как внешний
   офлайн-оракул; встраивание без отдельного лицензионного анализа запрещено; при этом
   отсутствие GPL-обязательств у схемы «отдельный процесс» не заявляется
   гарантированным: окончательный вывод требует анализа конкретной схемы
   распространения и взаимодействия компонентов (§7.6).
4. Для USGS-кода (PHREEQC) до любого использования читается User Rights Notice конкретной
   поставки (для исследованной 3.9.0-17591 он не открыт); «public domain» не
   предполагается автоматически.
5. Статус зрелости проекта фиксируется рядом с выводами: PROTEUS имеет PyPI-статус
   Alpha (26.10.16), REBOUND 5.2.2 Production/Stable (pyproject.toml), PHREEQC
   preliminary/provisional (README USGS); ссылка на «зрелость» любого проекта без
   сверки статуса по первоисточнику не допускается.

## 14. Приоритетный план адаптации

Все пункты требуют отдельных решений и отдельных пакетов изменений; настоящий документ
не является разрешением на реализацию и не закрывает этапы дорожной карты.

- P1 (ADAPT, PROTEUS): интеграционные pairwise-тесты обмена веществом/энергией между
  операторами и BM-6; dummy-паттерн уже совместим с честным пустым бэкендом EvoWars
  (PlannedBackendDescriptor с пустыми implementedMethods), новых механик не требует.
- P2 (ADAPT, Cantera): контрактные улучшения уровня данных: диапазоны применимости в
  записях механизма (уже частично есть в снимках), семантика явного третьего тела против
  generic M как контрактная документация; без изменения каталога и коэффициентов.
- P3 (REFERENCE, CoolProp): расширение офлайн-оракула на знак-проверки TPD (BM-4) по
  образцу существующего coolprop-benchmark контура; oracle snapshot с provenance.
- P4 (ADAPT, REBOUND): рестарт-тесты воспроизводимости на снимках истории (Уровень 5),
  согласование с существующей семантикой bitwise_same_environment|within_tolerance|
  platform_dependent; аудит сериализации по чек-листу «что не сохраняется»;
  версионирование формата снимков с явной политикой миграции (урок breaking change
  SimulationArchive в REBOUND 5.0.0: смена формата это управляемый разрыв
  совместимости, а не молчаливое чтение чужих архивов).
- P5 (ADAPT, VPLanet): реестр планетарных сценариев со статусами pass/fail/known-broken/
  excluded и привязкой к эталонам; основа: существующая таблица Уровня 3.
- P6 (STUDY, PHREEQC): граница интеграции IPhreeqc/PhreeqcRM для этапа 4.9 по версии
  3.9.0-17591 (тег v3.9.0); отдельное исследование применимости к каталогу
  компонентов EvoWars.
- REJECT (фиксация): встраивание REBOUND (GPL-3.0-only); подмена KIDA/JPL коэффициентов данными любых
  исследованных проектов; PHREEQC для расплавов/недр; объявление фазовой устойчивости
  доказанной без validatedErrorBound; объявление глобальной TPD-устойчивости без
  доказанной нижней границы; изменение NASA CEA, gameSpeedCoefficient, Radau IIA,
  PURE PR, статусов unknown/no_kinetic_data и fail-closed; расширение механизма реакций
  без отдельного согласования.

## 15. Нерешённые вопросы и риски

1. VLERoutines.cpp (CoolProp) полностью не разобран: классы successive_substitution
   прочитаны по doxygen-указателю, полный разбор не выполнялся (непроверено).
2. Точные страницы выпусков Michelsen 1982a/b не сверялись с оригиналами (непроверено);
   ссылки даны по библиографическим ключам CoolProp.
3. User Rights Notice PHREEQC для исследованной поставки 3.9.0-17591 не прочитан (README
   тега v3.9.0 содержит только дисклеймер preliminary/provisional); лицензионный статус
   для производного использования не подтверждён (непроверено).
4. Лицензии модульных репозиториев PROTEUS (Aragog, SPIDER, Zalmoxis, AGNI, JANUS) не
   проверены по отдельности (непроверено).
5. Лицензии зависимостей Cantera (SUNDIALS, Boost, fmt, Eigen и др.) не проверены
   индивидуально (непроверено).
6. Точные пути Python-тестов Cantera и полный состав test/zeroD не зафиксированы
   (непроверено).
7. CI-контур REBOUND: содержимое workflow тега 5.2.2 и наличие энергосохраняющего
   прогона как отдельного workflow не проверялись (непроверено).
8. Порядок исполнения модулей VPLanet внутри шага не проверен по исходнику (help.html
   не открыт в этой сессии) (непроверено).
9. Допуски BM-2 и BM-5-расширений «предстоит определить»: обоснование требует
   исследований сходимости, которые не выполнялись в рамках настоящего документа.
10. Допуск BM-1 (порядка 1e-13) это предварительная оценка, не измерение; при создании
    сценария выполняется фактический ULP-анализ.
11. Лицензия самого репозитория EvoWars в этой сессии не проверялась; выводы §7.6 о
    GPL-конфликте при встраивании REBOUND даны в общем виде и требуют сверки с
    фактической лицензией EvoWars перед любым решением.
12. Политика REBOUND против AI-generated code: формулировка проверена дословно по README
    тега 5.2.2; юридические следствия политики не анализировались.
13. Риск устаревания: версии зафиксированы на дату 2026-11-10 (первая редакция) и
    2026-11-11 (корректирующая редакция: SHA, PHREEQC 3.9.0-17591, REBOUND 5.2.2);
    проекты развиваются, перед реализацией P1-P6 версии перепроверяются.
14. Значение adaptive_mode по умолчанию в REBOUND 5.2.2 не сверялось (в документации 4.x
    по умолчанию PRS23); для сценариев BM-5 проверяется по исходнику тега
    (непроверено).
15. Сериализация additional forces в SimulationArchive 5.2.2: в материалах тега не
    найдена, ограничение перенесено из документации 4.x (непроверено для 5.2.2).
16. Соответствие страниц сайта rebound.hanno-rein.de сборке 5.2.2 не проверялось;
    описания интеграторов привязаны к дереву тега и релизным заметкам (непроверено).
17. Противоречие источников REBOUND: ноутбук 5.2.2 ещё содержит фразу «and even a
    different version of REBOUND», а релизные заметки 5.0.0 заявляют нечитаемость
    архивов предыдущих версий; вывод сделан по релизным заметкам как более свежему и
    специфичному источнику.
18. Отношение репозиториев phreeqc-dev/phreeqc3 (релиз 3.9.0-17591) и usgs-coupled/
    phreeqc3, usgs-coupled/phreeqrm не устанавливалось (непроверено).
19. PyPI-классификаторы зрелости CoolProp, Cantera и VPLanet не проверялись; статус
    зрелости этих проектов в матрице §9 помечен (непроверено).
20. Деревья тестов PROTEUS и CI-контур CoolProp читались через изменяемые ветки
    main/master (пометки в таблице §2); посимвольная сверка этих деревьев с тегами не
    выполнялась (непроверено).

## 16. Полный список источников

### EvoWars (внутренние документы, ревизии на дату исследования)

- docs/science/PHYSICS_ARCHITECTURE.md, IMPLEMENTATION_ROADMAP.md,
  CHEMISTRY_ARCHITECTURE.md, SCIENTIFIC_FOUNDATION.md, DATA_PROVENANCE.md,
  VALIDATION_PLAN.md, CURRENT_SYSTEM_AUDIT.md, CORE_SCIENTIFIC_ENGINE.md,
  SIMULATION_ENGINE.md, TPD_SEARCH_DESIGN.md, TPD_CONTINUOUS_ERROR_BOUND.md,
  TPD_NUMERICAL_ERROR_AUDIT.md (ветка stage-3-planetary-physics).

### PROTEUS

- https://proteus-framework.org/ и https://proteus-framework.org/PROTEUS/Explanations/model.html
- https://proteus-framework.org/PROTEUS/Explanations/dummy_modules.html
- https://github.com/FormingWorlds/PROTEUS (README, LICENSE.txt по тегу 26.10.16)
- https://github.com/FormingWorlds/PROTEUS/releases/tag/26.10.16
- https://github.com/FormingWorlds/PROTEUS/tree/26.10.16/tests и
  /tree/26.10.16/tests/integration (дерево также читалось через ветку main 2026-11-10:
  см. оговорку в §2)
- https://pypi.org/project/fwl-proteus/26.10.16/ (Development Status :: 3 - Alpha)
- Zenodo: DOI 10.5281/zenodo.21358380 (версия 26.10.16)

### CoolProp

- https://coolprop.org/fluid_properties/Mixtures.html (документация 8.0.0)
- https://github.com/CoolProp/CoolProp/releases/tag/v8.0.0 (28.06.2026)
- https://github.com/CoolProp/CoolProp/tree/v8.0.0/src/Backends/Helmholtz
  (FlashRoutines.cpp, VLERoutines.cpp по тегу v8.0.0)
- https://raw.githubusercontent.com/CoolProp/CoolProp/v8.0.0/LICENSE (MIT)
- https://raw.githubusercontent.com/CoolProp/CoolProp/v8.0.0/Web/fluid_properties/Mixtures.rst
- https://raw.githubusercontent.com/CoolProp/CoolProp/v8.0.0/THIRD_PARTY_NOTICES.md
- Bell et al. 2014, Ind. Eng. Chem. Res., DOI 10.1021/ie4033999:
  https://pubs.acs.org/doi/10.1021/ie4033999
- Michelsen 1982a/b (FPE), Michelsen & Mollerup 2007, Gernert et al. 2014,
  Crowe & Nishio 1975, Hebden 1973, Rachford & Rice 1952: по библиографическим ключам
  из Web/fluid_properties/Mixtures.rst

### Cantera

- https://cantera.org/stable/yaml/reactions.html
- https://cantera.org/science/reactors/cvodes.html
- https://cantera.org/3.1/cxx/d7/def/classCantera_1_1ReactorNet.html
- https://cantera.org/3.2/reference/releasenotes/v3.2.html
- https://github.com/Cantera/cantera/releases/tag/v3.2.0 (18.11.2025)
- https://github.com/Cantera/cantera/tree/v3.2.0/test/kinetics (rates.cpp, pdep.cpp,
  kineticsFromYaml.cpp, kineticsFromScratch.cpp по тегу v3.2.0)
- https://raw.githubusercontent.com/Cantera/cantera/v3.2.0/License.txt (BSD-3)
- https://raw.githubusercontent.com/Cantera/cantera/v3.2.0/src/kinetics/Falloff.cpp
  (анализировался файл тега v3.2.0; файл ветки main относится к линии разработки
  4.0.0a2 и для выводов не использовался)

### PHREEQC

- https://www.usgs.gov/software/phreeqc-version-3 (страница загрузок: сборка 3.8.6-17100)
- https://github.com/phreeqc-dev/phreeqc3 (upstream-репозиторий) и
  https://github.com/phreeqc-dev/phreeqc3/releases/tag/v3.9.0 (релиз 3.9.0-17591,
  май 2026)
- https://github.com/phreeqc-dev/phreeqc3/blob/v3.9.0/README.md (USGS-дисклеймер,
  проверен дословно)
- https://github.com/phreeqc-dev/phreeqc3/tree/v3.9.0 (ctest.cmake, ctest.regression.cmake,
  CTestConfig.cmake, valgrind.cmake, .gitlab-ci.yml)
- https://github.com/phreeqc-dev/phreeqc3/blob/v3.9.0/HTMLversion/HTML/phreeqc3-24.htm
  (глава KINETICS по тегу v3.9.0; сверена с онлайн-версией)
- https://water.usgs.gov/water-resources/software/PHREEQC/documentation/phreeqc3-html/phreeqc3-24.htm
  (первоисточник KINETICS: -cvode default false, -runge_kutta, -bad_step_max)
- Parkhurst & Appelo 2013, USGS Techniques and Methods 6-A43, DOI 10.3133/tm6A43
- https://github.com/usgs-coupled/phreeqc3 и https://github.com/usgs-coupled/phreeqrm
  (PhreeqcRM; смежные репозитории, отношение к upstream не устанавливалось)
- Cohen & Hindmarsh 1996, CVODE (цитируется по документации PHREEQC)

### REBOUND

- https://github.com/hannorein/rebound/releases (релизные заметки 5.0.0, 5.1.0, 5.2.0,
  5.2.1, 5.2.2; в т.ч. смена формата SimulationArchive и нечитаемость архивов
  предыдущих версий в 5.0.0, SIMD-интегратор WHFast512 в 5.1.0/5.2.0)
- https://github.com/hannorein/rebound/releases/tag/v5.2.2 (05.10.2026) и
  https://github.com/hannorein/rebound/tree/5.2.2 (src/integrator_*.c,
  simulationarchive.c, examples/, ipython_examples/, python_examples/)
- https://github.com/hannorein/rebound/blob/5.2.2/pyproject.toml (license =
  "GPL-3.0-only", Development Status :: 5 - Production/Stable)
- https://github.com/hannorein/rebound/blob/5.2.2/LICENSE и
  https://github.com/hannorein/rebound/blob/5.2.2/README.md (текст GPLv3 с «or later»;
  политика против AI-generated code)
- https://github.com/hannorein/rebound/blob/5.2.2/ipython_examples/SimulationarchiveRestart.ipynb
  (bitwise-рестарт, машинная независимость между ОС)
- https://github.com/hannorein/rebound/blob/5.2.2/src/integrator_ias15.c (заголовок,
  публикации)
- https://pypi.org/project/rebound/ (версия 5.2.2)
- https://rebound.hanno-rein.de/, /integrators/ias15/,
  /ipython_examples/SimulationarchiveRestart/ (соответствие сборке 5.2.2 не
  проверялось, см. §15 п. 16)
- Rein & Liu 2012, A&A 537, A128:
  https://aanda.org/articles/aa/full_html/2012/01/aa18085-11/aa18085-11.html
- Rein & Tamayo 2017 (JANUS): https://arxiv.org/pdf/1701.07423
- Rein & Spiegel 2015, MNRAS 446, 1424 (IAS15; по ссылкам документации REBOUND)

### VPLanet

- https://virtualplanetarylaboratory.github.io/vplanet/ и /examples.html
- https://github.com/VirtualPlanetaryLaboratory/vplanet/releases/tag/v2.5.36 (20.02.2026)
- https://github.com/VirtualPlanetaryLaboratory/vplanet/tree/v2.5.36 (README, examples/)
- https://raw.githubusercontent.com/VirtualPlanetaryLaboratory/vplanet/v2.5.36/LICENSE (MIT)
- Barnes et al. 2020, PASP 132, 024502: DOI 10.1088/1538-3873/ab3ce8,
  arXiv:1905.06367, ADS 2020PASP..132b4502B
