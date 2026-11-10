# PEER_ENGINEERING_REVIEW: сравнительное инженерное исследование зрелых open-source проектов

> Тип документа: исследовательский отчёт. Дата: 2026-11-10. Ветка: `stage-3-planetary-physics`,
> база: `a886c31d` (fast-forward поверх цепочки `9e2b7b7c` → `c572399b` → `5b8f525b`).
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
   Лицензия Apache-2.0 не ограничивает заимствование подхода. Категория: **ADAPT**.
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
5. **REBOUND даёт два готовых паттерна**: SimulationArchive (бинарные снапшоты с побитовым
   воспроизведением рестарта, машинно-независимые между ОС и версиями) и дисциплину
   интеграторов (IAS15 по умолчанию, критерии выбора). Лицензия GPL-3.0-or-later делает
   встраивание в распространяемый EvoWars проблемным без отдельного лицензионного решения;
   офлайн-оракул отдельным процессом допустим. Категория: **REFERENCE** (оракул) +
   **ADAPT** (паттерн снапшотов), встраивание: **REJECT** без отдельного решения.
6. **VPLanet показывает, как организовать эталонные планетарные сценарии**: около 40
   сценариев-примеров, каждый привязан к публикации и воспроизводит её результат, плюс
   публичный раздел «Broken» с честным списком сломанных примеров. Это прямой шаблон для
   Уровня 3/5 VALIDATION_PLAN EvoWars. Лицензия MIT. Категория: **ADAPT** (система сценариев)
   + **REFERENCE**.

Сводка лицензий (все проверены по официальным файлам лицензий в репозиториях):
PROTEUS Apache-2.0; CoolProp MIT; Cantera BSD-3 (Caltech/Sandia/Cantera Developers);
PHREEQC: явного файла открытой лицензии в репозитории не найдено, USGS распространяет как
provisional software (текст ниже, полный текст User Rights Notice **(непроверено)**);
REBOUND GPL-3.0-or-later; VPLanet MIT.

## 2. Методология исследования и версии проектов

Метод: для каждого проекта открывались официальный сайт и документация, репозиторий
исходного кода, конкретные файлы реализации, тестовые каталоги, файлы лицензий, страницы
релизов и библиография. Исходные файлы читались напрямую (raw-версии GitHub), страницы
документации открывались целиком. Дата обращения ко всем источникам: 2026-11-10.
Исследование велось по документации релизных версий и по веткам main/master репозиториев
на указанную дату; коммиты фиксируются косвенно датами обращения.

Ограничения метода: (1) чтение файлов через веб-интерфейс ограничено размером выгрузки,
поэтому для двух больших файлов CoolProp анализировались начала файлов и целевые фрагменты;
(2) локальный запуск проектов не выполнялся (задача исследования, не установки зависимостей);
(3) перечисленные в §15 вопросы помечены как непроверенные, а не домысленные.

| Проект | Актуальная стабильная версия | Что фактически исследовано | Репозиторий |
|---|---|---|---|
| PROTEUS | релиз `26.10.16` (16.10.2026, 11-й релиз) | документация на proteus-framework.org (страницы model, dummy_modules), дерево `src/proteus`, дерево `tests`, README, LICENSE.txt | https://github.com/FormingWorlds/PROTEUS |
| CoolProp | `8.0.0` (28.06.2026) | документация 8.0.0 (страница Mixtures), `src/Backends/Helmholtz/FlashRoutines.cpp` (фрагменты), дерево `src/Backends/Helmholtz`, `Web/fluid_properties/Mixtures.rst`, ключи BibTeX, LICENSE, страница релизов | https://github.com/CoolProp/CoolProp |
| Cantera | `3.2.0` (стабильная; ветка main: `4.0.0a2`) | документация `/stable/yaml/reactions.html`, `/science/reactors/cvodes.html`, `src/kinetics/Falloff.cpp` (целиком, 14 КБ), дерево `test/kinetics`, License.txt, заметки релиза 3.2.0 | https://github.com/Cantera/cantera |
| PHREEQC | `3.8.6-17100` (страница релиза USGS от 07.01.2025) | страница USGS, глава KINETICS документации, репозиторий `usgs-coupled/phreeqc3` (дерево, ctest-скрипты), отчёт Parkhurst & Appelo 2013 (библиографическая запись) | https://github.com/usgs-coupled/phreeqc3 |
| REBOUND | `4.4.11` (13.11.2025, PyPI) | страница интегратора IAS15, туториал SimulationarchiveRestart, `src/integrator_ias15.c`, `src/integrator_janus.c` (заголовки), LICENSE, README, публикации | https://github.com/hannorein/rebound |
| VPLanet | `v2.5.36` (20.02.2026) | README репозитория (полный список модулей), страница Examples документации, страница релизов, LICENSE, статья Barnes et al. 2020 (аннотация) | https://github.com/VirtualPlanetaryLaboratory/vplanet |

## 3. PROTEUS: подробный разбор

### 3.1 Идентификация и статус

Официальный сайт: https://proteus-framework.org/ (проверено: открывается, содержит описание
фреймворка и ссылку на документацию https://proteus-framework.org/PROTEUS/). Репозиторий:
https://github.com/FormingWorlds/PROTEUS. Лицензия: Apache-2.0, файл
https://raw.githubusercontent.com/FormingWorlds/PROTEUS/main/LICENSE.txt (текст Apache
License Version 2.0 проверен). Программная цитата: Zenodo concept DOI 10.5281/zenodo.21358380
(README). Базовая публикация модели: Lichtenberg et al. (2021), указана на странице
https://proteus-framework.org/PROTEUS/Explanations/model.html как основа, от которой код
существенно разросся. Последний релиз на дату исследования: `26.10.16` (16.10.2026).

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
(https://github.com/FormingWorlds/PROTEUS/tree/main/src/proteus).

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

Каталог `tests/` (https://github.com/FormingWorlds/PROTEUS/tree/main/tests) повторяет
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

Репозиторий: https://github.com/CoolProp/CoolProp. Лицензия MIT, файл
https://raw.githubusercontent.com/CoolProp/CoolProp/master/LICENSE («Copyright (c) 2012-2018
Ian H. Bell and other CoolProp developers», полный текст MIT проверен). Актуальный релиз:
CoolProp `8.0.0` (страница релизов, дата 28.06; год 2026 подтверждён датами страницы на
дату исследования 2026-11-10). Основная публикация: Bell, Wronski, Quoilin, Lemort (2014),
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

Библиографические ключи проверены по https://raw.githubusercontent.com/CoolProp/CoolProp/master/Web/fluid_properties/Mixtures.rst:
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
  прочитаны напрямую, https://github.com/CoolProp/CoolProp/tree/master/src/Backends/Helmholtz).
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

Репозиторий: https://github.com/Cantera/cantera. Лицензия: BSD 3-clause, файл
https://raw.githubusercontent.com/Cantera/cantera/main/License.txt (Copyright (c) 2001-2009
California Institute of Technology; (c) 2009 Sandia Corporation; (c) 2011-2026 Cantera
Developers; текст BSD-3 проверен). Стабильная версия 3.2.0 (селектор версий документации:
«4.0 (dev) | 3.2.0 (stable)» на https://cantera.org/stable/yaml/reactions.html); ветка main
на 4.0.0a2 (README репозитория). Заметки релиза 3.2.0:
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

Файл `src/kinetics/Falloff.cpp` (прочитан целиком, 14 КБ,
https://raw.githubusercontent.com/Cantera/cantera/main/src/kinetics/Falloff.cpp).
Ключевые фрагменты:

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

Каталог `test/kinetics` (дерево прочитано): `kineticsFromScratch.cpp`,
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

Домашняя страница: https://www.usgs.gov/software/phreeqc-version-3. Репозиторий исходного
кода: https://github.com/usgs-coupled/phreeqc3 (зеркало USGS, ветка master). Исследованная
версия: 3.8.6, сборка 17100 («3.8.6-17100», идентификация в исходниках/релизах репозитория
на дату исследования 2026-11-10). Основная публикация: Parkhurst, D.L., Appelo, C.A.J.
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

Раздел KINETICS документации (https://water.usgs.gov/water-resources/software/PHREEQC/documentation/phreeqc3-html/phreeqc3-24.htm):

- `-bad_steps_max` управляет интеграторами. Для явного метода Рунге-Кутты 5-го порядка
  (RK5, по Cash-Karp вариант, реализация в PHREEQC): параметр ограничивает число
  уменьшений шага; слишком грубый допуск даёт больше уменьшений шага и при исчерпании
  лимита расчёт останавливается с ошибкой.
- Для неявного метода: CVODE (Cohen & Hindmarsh 1996, CVODE: Solver for ODE, статья
  описывает алгоритм: BDF/Adams с адаптивным порядком и шагом), параметр `-bad_steps_max`
  ограничивает число неудачных шагов CVODE, при исчерпании также остановка с ошибкой.
  Рекомендация документации: если RK5 требует более ~30 уменьшений шага, переключиться на
  CVODE (жёсткие системы).

Т.е. эвристика та же, что в зрелых решателях: явный адаптивный метод до признаков
жёсткости, неявный BDF для жёстких систем, оба с явными ошибками при исчерпании лимита
усилий. Прямая параллель к выбору EvoWars: жёсткая химическая кинетика №89/№106
обслуживается неявным L-устойчивым Radau IIA (3 стадии, порядок 5, CORE_SCIENTIFIC_ENGINE
§2.8, ревизия 4.5.3), а не явным методом.

### 6.4 Кинетические реакции: модель

RATES определяет скорость через Basic-скрипт на каждом шаге интегратора: пользователь
пишет кинетическое выражение (закон действия, насыщение, произвольные формулы), PHREEQC
интегрирует dM/dt с температурной и площадной зависимостью (KINETICS: `-m`, `-m0`,
`-parms`, `TOL`, `-step_divide`, `-cvode` как спецификатор интегратора для конкретной
реакции). Ограничение по существу: скорости это пользовательские функции, а не
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

### 6.6 Тесты

В репозитории phreeqc3: `ctest.cmake` (функциональные тесты по скриптам) и
`ctest.regression.cmake` (регрессионные тесты, сравнение выводов с эталонными файлами).
Паттерн: выходы фиксированных сценариев сравниваются с сохранёнными эталонами; у такого
подхода известный риск (эталон фиксирует и корректное, и ошибочное поведение), в PHREEQC
он компенсируется длинной историей сопоставления с опубликованными расчётами (Parkhurst &
Appelo 2013 содержит верификационные примеры).

### 6.7 Лицензия: важно и неудобно

Файла LICENSE в корне репозитория https://github.com/usgs-coupled/phreeqc3 при
исследовании не обнаружено. Код USGS распространяется как «public domain» в смысле
US-works-of-federal-employees, но с дисклеймером «This software is preliminary or
provisional and is subject to revision. It is being provided to meet the need for timely
best science... No warranty...» (формулировка видна на страницах USGS software).
Точный действующий текст «User Rights Notice» конкретной версии в этой сессии не открыт:
**(непроверено)**; для любого производного использования требуется прочитать notice
непосредственно в поставке. Не считать PHREEQC «общественным достоянием по умолчанию»:
условия надо фиксировать по факту.

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
| Жёсткая кинетика | RK5 явный до жёсткости, затем CVODE | параллель подтверждает выбор Radau IIA; PHREEQC не источник данных |
| Контракт ячейки с граничными условиями | PhreeqcRM run_cells | STUDY: граница интеграции через IPhreeqc/PhreeqcRM, отдельное решение |
| Недра/расплавы | неприменимо | REJECT |
| Provenance коэффициентов | отсутствует (пользовательские скрипты) | REJECT как источник данных; fail-closed сохраняется |

## 7. REBOUND: подробный разбор

### 7.1 Идентификация и статус

Репозиторий: https://github.com/hannorein/rebound. Лицензия: GPL-3.0-or-later, файл
https://raw.githubusercontent.com/hannorein/rebound/main/LICENSE (стандартный текст
GPL-3.0 с «or later», проверен). Заголовки исходников содержат копирайт Hanno Rein,
Daniel Tamayo и др. Актуальная версия: 4.4.11 (PyPI, https://pypi.org/project/rebound/,
дата выпуска 13.11.2025). Основные публикации: Rein & Liu 2012, «REBOUND: an open-source
multi-purpose N-body code for collisional dynamics», A&A 537, A128
(https://aanda.org/articles/aa/full_html/2012/01/aa18085-11/aa18085-11.html);
IAS15: Rein & Spiegel 2015, MNRAS 446, 1424; JANUS: Rein & Tamayo 2017, MNRAS 467, 2377
(https://arxiv.org/pdf/1701.07423).

### 7.2 Интеграторы и выбор под динамический режим

Список интеграторов (https://rebound.hanno-rein.de/, раздел Integrators):

- IAS15 (по умолчанию): implicit Runge-Kutta 15-го порядка с адаптивным шагом и
  гауссово-Радау разбиением; заявленная точность до машинной точности; контроль ошибок
  через нелинейную компенсированную схему (Rein & Spiegel 2015); параметр epsilon
  (по умолчанию 1e-9 для гармонических осцилляторов долгоживущих систем; на странице
  https://rebound.hanno-rein.de/integrators/ias15/ предупреждение: для столкновительных
  или сильно хаотических систем epsilon следует подбирать, слишком маленький epsilon
  может не сработать для сильно нелинейных траекторий). В версии 4.4 режимы адаптивного
  шага: `PRS23` (по умолчанию, рекомендован Pham, Rein et al. 2024, сохраняет
  динамически отдалённые взаимодействия), альтернативы `INDIVIDUAL`, `GLOBAL`, `AARSETH85`;
  параметр `min_dt` с предостережением о зависании для неплотных систем.
- Symplectic: WHFast (WH/WHD/WHCKL, Wisdom-Holman с коррекциями переменного шага для
  задач с малыми эксцентриситетами), SEI (специальный для задачи двух планет с
  эксцентриситетом до ~1), LEAPFROG (по умолчанию), EOS (high order explicit
  symplectic, с оптимизированными коэффициентами для задач с близкими сближениями).
- Гибридные/переключающие: JANUS (bitwise-reproducible симплектик с периодическим
  переключением между схемами, described in Rein & Tamayo 2017), MERCURIUS
  (Hybrid symplectic/Bulirsch-Stoer, для планетных систем со сближениями), TRACE
  (гибридный переключающийся интегратор).

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

Страница https://rebound.hanno-rein.de/ipython_examples/SimulationarchiveRestart/ и
README:

- SimulationArchive это бинарный формат снапшотов симуляции: сохраняет состояние,
  параметры интегратора и время; обеспечивает побитовый рестарт (bitwise identical)
  при продолжении с тем же снапшотом на той же платформе и позволяет побитовый
  повтор от точки снапшота.
- Заявленная машинно-независимый формат, совместимость между версиями и ОС: архивные файлы двоично совместимы между
  версиями REBOUND и операционными системами (README: архивы «can be shared between
  different versions of REBOUND, different operating systems»); формат версионируется
  и обратная совместимость поддерживается.
- Честные ограничения (README): (а) additional forces и function pointers (гравитационные
  потенциалы, радиационное давление, custom effects) не сериализуются: при рестарте их
  нужно переподключить вручную; (б) WHFast с выключенным safe mode: unsynchronized
  состояния требуют `sim.integrator = "WHFast"` и `sim.ri_whfast.keep_unsynchronized = 1`
  для корректного бинарного рестарта; (в) снапшоты пишутся не на точных интервалах, а
  на первом шаге после истечения интервала (время снапшота записывается фактическое).

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

Тестовый паттерн REBOUND: каталог `examples/` с per-example `problem.c`, где каждый
пример это самопроверяющийся сценарий (выход в `Makefile`-драйве, проверка границ
значений). Библиотека использует `unittests/` для unit-уровня; поведение интеграторов
проверяется на аналитических задачах и на проблемах из публикаций (IAS15: Rein &
Spiegel 2015 секция тестов). Энергосохраняющий CI-прогон как отдельный workflow не
подтверждён: **(непроверено)**.

### 7.6 GPL-3.0-or-later: последствия для EvoWars

REBOUND это GPL с опцией «or later». Следствия:

1. Встраивание кода REBOUND в производственный код EvoWars (не отдельный процесс, а
   linking в том же смысле, который GPL применяет к производным произведениям)
   обязывает распространять это произведение по GPL-совместимой лицензии. Текущая
   лицензия EvoWars и планы распространения в этой сессии не проверялись: решение
   требует отдельного анализа. Пока такого решения нет: REJECT встраивание,
   REFERENCE офлайн.
2. Использование как независимый внешний оракул (запуск отдельным процессом/средой,
   сравнение результатов по файлам) GPL-обязательств на EvoWars не создаёт: это
   ровно текущая роль в VALIDATION_PLAN (таблица оракулов: REBOUND уровень 2, офлайн).
3. Данные (архивы, конфиги), созданные REBOUND, не подпадают под GPL как таковые,
   но паттерн «снапшот-формат» заимствуется как идея, не как код.

Отдельно: README REBOUND (и PyPI-страница) содержит явное заявление о политике против
AI-generated code: «AI-generated code conflicts with this project's license and the
copyright of its contributors» (формулировка о непринятии вкладов, сгенерированных
LLM). Для настоящего исследования это означает: НЕ предлагать генерировать патчи в
REBOUND и не переносить код REBOUND дословно в любой AI-ассистированный репозиторий;
заимствуются только методы, форматы и архитектурные идеи, в соответствии с §13 и
политикой происхождения EvoWars.

### 7.7 Сопоставление с EvoWars и решения

| Аспект EvoWars | Как решено в REBOUND | Решение |
|---|---|---|
| Орбитальная динамика (4.6, ADR-P2: аналитический Кеплер по умолчанию, интеграторы подключаемые) | 4 семейства интеграторов, выбор по режиму | REFERENCE: офлайн-оракул; ADAPT матрицу «режим → метод» для реестра бэкендов |
| Воспроизводимость (снапшоты истории 1.x, deterministic семантика) | SimulationArchive: бинарные снапшоты, bitwise рестарт, честные ограничения | ADAPT: паттерн снапшотов + рестарт-тесты; REJECT встраивание (GPL, без отдельного решения) |
| Проверка инвариантов | энергия/момент в examples как самоцель | ADAPT: инварианты в физическую валидацию Уровня 1/3 |
| Долгоживущие N-body ансамбли | WHFast/JANUS symplectic | STUDY: если EvoWars понадобится длинная орбитальная эволюция после 4.6, симплектические методы оправданы; текущий Кеплер-по-умолчанию не меняется |

## 8. VPLanet: подробный разбор

### 8.1 Идентификация и статус

Репозиторий: https://github.com/VirtualPlanetaryLaboratory/vplanet. Лицензия: MIT, файл
https://raw.githubusercontent.com/VirtualPlanetaryLaboratory/vplanet/main/LICENSE
(«Copyright (c) 2018 The VPLANET Team», текст MIT проверен). Актуальная версия:
v2.5.36 (страница релизов, дата 20.02.2026; исследовалась документация и репозиторий на
дату 2026-11-10). Основная публикация: Barnes, R. et al. 2020, «VPLanet: The Virtual
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
| ODE-интегрирование | внешние модули (SPIDER и др.) | нет | CVODES/IDAS (SUNDIALS) | RK5 явный / CVODE | IAS15/WHFast/JANUS/... | собственный RK-адаптивный (в главном цикле) | Radau IIA (ts-radau-iia), порядок 5, L-stable |
| Равновесие/flash | нет (физика модулей) | Михельсен 2 этапа, GDEM, trust region | нет (кинетика) | speciation Newton-Raphson | нет | нет | PURE PR + TPD-поиск (сертификация за validatedErrorBound) |
| Воспроизводимость | golden_run.tsv | не акцентирована | не акцентирована | ctest-регрессия | SimulationArchive, bitwise рестарт | вход+версия+публикация | deterministic семантика, снимки истории, SHA-256 траектории |
| Тестовая пирамида | unit + integration pairwise + golden | unit (Catch2) + smoke | unit (googletest) + 0D | функциональные + регрессионные ctest | examples как самопроверки | examples по публикациям + broken | 174+ теста, VALIDATION_PLAN 5 уровней |
| CI | coverage-baseline + nightly | Catch2 + колёса | CI matrix, googletest | ctest | Makefile/CI | GitHub Actions | verify: tsc + tests + lint + build |
| Лицензия | Apache-2.0 | MIT | BSD-3 | USGS provisional, notice (непроверено) | GPL-3.0-or-later | MIT | (не проверялась в этой сессии) |
| Язык | Python (+Fortran/C-модули) | C++ | C++ (+Python) | C | C | C | TypeScript |

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
`Falloff.cpp` с защитой SmallNumber. PHREEQC (§6.3) подтверждает выбор неявного метода
для жёсткой кинетики (RK5 до признаков жёсткости, затем CVODE). Текущие контракты
EvoWars (механизменная размерность cm3_per_molecule_per_s, fall-off контракт 4.5.2,
Radau IIA) соответствуют отраслевой практике; коэффициенты не переносятся ни откуда,
кроме KIDA/JPL (REJECT подмена, сохраняется fail-closed для №1/№70/№72).

### 10.4 4.6: орбитальная динамика

Проблема: подключаемые интеграторы и их валидация. Находки: REBOUND (§7) даёт матрицу
«режим → интегратор» и офлайн-оракул IAS15 (уже числится в таблице оракулов VALIDATION_PLAN
уровень 2). Текущий аналитический Кеплер (ADR-P2) не меняется; при появлении интеграторов
в реестре бэкендов референс-паттерн REBOUND по выбору схемы по режиму применим к
документации контрактов SolverBackend. Встраивание REBOUND: REJECT (GPL, отдельное
решение).

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
Находки: PHREEQC (§6) это референс предметной области: SI, EQUILIBRIUM_PHASES, кинетика
растворения; IPhreeqc/PhreeqcRM как граница интеграции; применимость заканчивается на
водной геохимии. Для EvoWars: REFERENCE офлайн-оракул водных сцен; ADAPT концепции
SI/резервуаров в собственные контракты; REJECT PHREEQC для расплавов/недр. Критерий
замкнутости (углерод 1e-9 за 1000 шагов) не меняется; PHREEQC может служить вторым
независимым оракулом для отдельных водных под-сценариев после появления этапа 4.9.

### 10.8 Воспроизводимость и сохранение состояния

Находки: REBOUND SimulationArchive (битовая совместимость формата между версиями/ОС,
честный список несериализуемого, рестарт-тесты); PROTEUS golden_run.tsv (золотые
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
  тестах), REBOUND IAS15 (epsilon 1e-9) как офлайн-оракул для нетривиальных траекторий
  (например, резонансная пара).
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
| PROTEUS | 26.10.16 (Zenodo) | Apache-2.0 (LICENSE.txt, проверен) | модули-репозитории (Aragog, SPIDER, Zalmoxis, AGNI и др.) отдельные репозитории с собственными лицензиями: не проверены по отдельности (непроверено) | да (Apache-2.0) | нет планов; заимствуются паттерны, не код |
| CoolProp | 8.0.0 | MIT (LICENSE, проверен) | THIRD_PARTY_NOTICES.md; вендоримые pinned Eigen/fmt со своими лицензиями; данные флюидов с собственными происхождением, MIT кода НЕ покрывает данные | да (MIT) | нет; офлайн-оракул (уже используется) |
| Cantera | 3.2.0 | BSD-3 (License.txt, проверен) | SUNDIALS (BSD), Boost и др.: лицензии зависимостей индивидуально не проверялись (непроверено) | да (BSD-3) | STUDY; производство Rust/WASM заблокировано отдельным решением |
| PHREEQC | 3.8.6-17100 | файла LICENSE в репо нет; USGS preliminary/provisional software, User Rights Notice не открыт (непроверено) | базы данных с собственным происхождением (llnl.dat и др.) | не подтверждено до прочтения notice (непроверено) | нет; при интеграции только отдельный процесс (IPhreeqc/PhreeqcRM) |
| REBOUND | 4.4.11 | GPL-3.0-or-later (LICENSE, проверен) | ядро самодостаточно; расширения (reboundx и др.) отдельные репозитории (не проверены) | да, при GPL-условиях | REJECT встраивание (GPL); REFERENCE офлайн |
| VPLanet | v2.5.36 | MIT (LICENSE, проверен) | модульных зависимостей не выявлено в этой сессии (непроверено) | да (MIT) | нет планов; заимствуются паттерны |

Принципы, подтверждённые практикой исследованных проектов:

1. Лицензия основного проекта не распространяется автоматически на зависимости и
   данные. CoolProp ведёт THIRD_PARTY_NOTICES.md и вшивает лицензии вендоримых
   Eigen/fmt; EvoWars уже применяет эквивалентный принцип к CoolProp: «MIT пакета
   CoolProp НЕ трактуется как происхождение/условия его данных» (DATA_PROVENANCE).
2. Код и данные имеют разные условия: базы PHREEQC, флюидные данные CoolProp,
   механизмы Cantera (gri30 с собственными ограничениями происхождения) требуют
   отдельной фиксации provenance при любом использовании.
3. GPL-проект (REBOUND) используется только как отдельный процесс-оракул; встраивание
   без отдельного лицензионного анализа запрещено (§7.6).
4. Для USGS-кода (PHREEQC) до любого использования читается User Rights Notice конкретной
   поставки; «public domain» не предполагается автоматически.

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
  platform_dependent; аудит сериализации по чек-листу «что не сохраняется».
- P5 (ADAPT, VPLanet): реестр планетарных сценариев со статусами pass/fail/known-broken/
  excluded и привязкой к эталонам; основа: существующая таблица Уровня 3.
- P6 (STUDY, PHREEQC): граница интеграции IPhreeqc/PhreeqcRM для этапа 4.9; отдельное
  исследование применимости к каталогу компонентов EvoWars.
- REJECT (фиксация): встраивание REBOUND; подмена KIDA/JPL коэффициентов данными любых
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
3. User Rights Notice PHREEQC для версии 3.8.6-17100 не прочитан; лицензионный статус
   для производного использования не подтверждён (непроверено).
4. Лицензии модульных репозиториев PROTEUS (Aragog, SPIDER, Zalmoxis, AGNI, JANUS) не
   проверены по отдельности (непроверено).
5. Лицензии зависимостей Cantera (SUNDIALS, Boost, fmt, Eigen и др.) не проверены
   индивидуально (непроверено).
6. Точные пути Python-тестов Cantera и полный состав test/zeroD не зафиксированы
   (непроверено).
7. Энергосохраняющий CI-контур REBOUND: наличие отдельного workflow не подтверждено
   (непроверено).
8. Порядок исполнения модулей VPLanet внутри шага не проверен по исходнику (help.html
   не открыт в этой сессии) (непроверено).
9. Допуски BM-2 и BM-5-расширений «предстоит определить»: обоснование требует
   исследований сходимости, которые не выполнялись в рамках настоящего документа.
10. Допуск BM-1 (порядка 1e-13) это предварительная оценка, не измерение; при создании
    сценария выполняется фактический ULP-анализ.
11. Лицензия самого репозитория EvoWars в этой сессии не проверялась; выводы §7.6 о
    GPL-конфликте при встраивании REBOUND даны в общем виде и требуют сверки с
    фактической лицензией EvoWars перед любым решением.
12. Политика REBOUND против AI-generated code: формулировка зафиксирована по README;
    точный текущий текст политики и её юридические следствия не анализировались.
13. Риск устаревания: все версии зафиксированы на дату 2026-11-10; проекты развиваются,
    перед реализацией P1-P6 версии перепроверяются.

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
- https://github.com/FormingWorlds/PROTEUS (README, дерево src/proteus, LICENSE.txt)
- https://github.com/FormingWorlds/PROTEUS/tree/main/tests и /tree/main/tests/integration
- Zenodo: DOI 10.5281/zenodo.21358380 (версия 26.10.16)

### CoolProp

- https://coolprop.org/fluid_properties/Mixtures.html (документация 8.0.0)
- https://github.com/CoolProp/CoolProp (README, releases, дерево src/Backends/Helmholtz)
- https://raw.githubusercontent.com/CoolProp/CoolProp/master/src/Backends/Helmholtz/FlashRoutines.cpp
- https://raw.githubusercontent.com/CoolProp/CoolProp/master/LICENSE (MIT)
- https://raw.githubusercontent.com/CoolProp/CoolProp/master/Web/fluid_properties/Mixtures.rst
- https://raw.githubusercontent.com/CoolProp/CoolProp/master/THIRD_PARTY_NOTICES.md
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
- https://github.com/Cantera/cantera (License.txt, дерево test/kinetics)
- https://raw.githubusercontent.com/Cantera/cantera/main/src/kinetics/Falloff.cpp

### PHREEQC

- https://www.usgs.gov/software/phreeqc-version-3
- https://github.com/usgs-coupled/phreeqc3 (дерево, ctest.cmake, ctest.regression.cmake)
- https://water.usgs.gov/water-resources/software/PHREEQC/documentation/phreeqc3-html/phreeqc3-24.htm
  (KINETICS: RK5/CVODE, -bad_steps_max)
- Parkhurst & Appelo 2013, USGS Techniques and Methods 6-A43, DOI 10.3133/tm6A43
- https://github.com/usgs-coupled/phreeqrm (PhreeqcRM)
- Cohen & Hindmarsh 1996, CVODE (цитируется по документации PHREEQC)

### REBOUND

- https://rebound.hanno-rein.de/ (список интеграторов)
- https://rebound.hanno-rein.de/integrators/ias15/
- https://rebound.hanno-rein.de/ipython_examples/SimulationarchiveRestart/
- https://github.com/hannorein/rebound (README, LICENSE, заголовки исходников)
- https://raw.githubusercontent.com/hannorein/rebound/main/src/integrator_ias15.c,
  .../src/integrator_janus.c (заголовки, публикации)
- https://pypi.org/project/rebound/ (версия 4.4.11, дата 13.11.2025)
- Rein & Liu 2012, A&A 537, A128:
  https://aanda.org/articles/aa/full_html/2012/01/aa18085-11/aa18085-11.html
- Rein & Tamayo 2017 (JANUS): https://arxiv.org/pdf/1701.07423
- Rein & Spiegel 2015, MNRAS 446, 1424 (IAS15; по ссылкам документации REBOUND)

### VPLanet

- https://virtualplanetarylaboratory.github.io/vplanet/ и /examples.html
- https://github.com/VirtualPlanetaryLaboratory/vplanet (LICENSE, releases, README)
- Barnes et al. 2020, PASP 132, 024502: DOI 10.1088/1538-3873/ab3ce8,
  arXiv:1905.06367, ADS 2020PASP..132b4502B
