#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Stage 4.4.4.2.2 / 4.4.4.3 — независимый benchmark Peng–Robinson:
чистые компоненты (4.4.4.2) и многокомпонентные смеси (4.4.4.3).

Оракулы (оба НЕ зависят от TypeScript-реализации):

1. CoolProp 8.0.0, backend 'PR' (НЕ HEOS): Z, phi, фугитивность на семи
   контрольных точках Stage 4.4.4.2. Чтобы гарантировать СОВПАДЕНИЕ
   входных параметров (Tc, pc, omega) с каталогом Stage 4.4.4.1, флюиды
   регистрируются в CoolProp через add_fluids_as_JSON с точными
   значениями каталога (EVWCO2/EVWN2/EVWCH4/EVWH2O/EVWAR); встроенные
   флюиды PR опрашиваются отдельно и фиксируются в отчёте, но для
   сравнения НЕ используются (никаких молчаливых замен параметров).
   Допуск: rtol 2e-4 — CoolProp вычисляет Ω_a/Ω_b аналитически
   (точные значения), тогда как наша реализация использует округлённые
   константы 0.45724/0.0778 textbook; фактические расхождения
   записываются в отчёт.

2. mpmath (50 значащих цифр): независимая ре-реализация классического
   PR (1976) с НАШИМИ округлёнными константами и решением кубики по
   Кардано в высокой точности. Допуск rtol 5e-13 — это ГЛАВНАЯ
   проверка самой реализации (сходится до предела двойной точности).

3. Граничный оракул: сетка A0±delta около нулевого дискриминанта
   кубики (B = 0.01980480623881198) плюс точный double-root fixture
   (A = 49/128, B = 1/16, корни 3/16 и 9/16) пересчитываются в mpmath
   по ТЕМ ЖЕ binary64-значениям A, что использовала TS-реализация:
   mpmath получает ТОЧНОЕ значение каждого float через
   float.as_integer_ratio() (целые numerator/denominator), БЕЗ
   промежуточного mpf(str(x)) — семантика double не теряется.
   Сравнение СТРОГОЕ: число действительных корней обязано совпадать,
   значения — в допусках (изолированный корень atol 1e-9, кластер
   у кратного корня atol 1e-6). Исключений для «полосы кратного
   корня» НЕТ: расхождение числа корней — провал точки. Точно
   кратные корни (D = 0) оракул классифицирует независимо по знаку
   дискриминанта.
   Near-threshold пара (B = 2^-20, соседние binary64-значения A) имеет
   НЕНУЛЕВОЙ точный дискриминант ВНУТРИ старой полосы порога: A+ —
   D > 0 (ровно один действительный корень), A- — D < 0 (три корня с
   парой, расщеплённой на ~2e-14). Строки дампа со статусом
   solverFailure — структурный отказ TS-решателя: оракул проверяет
   его обоснованность САМ (точный знак дискриминанта, число корней и
   минимальное расщепление против зеркала TS-дедупликации
   1e-8*max(1, |z|, B)); обоснованный отказ НЕ превращается в PASS
   молча — статус solver_failure фиксируется в отчёте явно, число
   обоснованных отказов выводится в аннотации.

4. Смесевой оракул (Stage 4.4.4.3, аргумент --mixtures): контрольные
   точки смесей из TS-дампа сверяются ДВУМЯ независимыми оракулами.
   CoolProp 8.0.0 backend 'PR' со смесями зарегистрированных флюидов
   (EVWCO2&EVWN2 и т.д.): КАТАЛОЖНЫЕ kij Stage 4.4.4.3 вводятся в
   CoolProp через документированный API
   set_binary_interaction_double(i, j, "kij", value) (документация
   Cubics: «CoolProp does not come with any values for the kij
   parameter» — встроенных значений НЕТ, ничего не переопределяется).
   ЧЕСТНАЯ СЕМАНТИКА: это ВАЛИДАЦИЯ РЕАЛИЗАЦИИ (правил смешения,
   кубики смеси, phi_i, f_i) при одинаковых kij; это НЕ независимое
   подтверждение ЗНАЧЕНИЙ kij — те остаются PARTIALLY_VERIFIED по
   provenance каталога (подгонки Okoro 2024 / Köster 2018). Второй
   оракул — mpmath (50 знаков): независимая ре-реализация классических
   правил смешения PR (a_ij = (1-kij)sqrt(a_i a_j), a_mix, b_mix,
   кубика, ln(phi_i)) с НАШИМИ округлёнными константами; допуск
   rtol 5e-13. Сравниваются Z, phi_i, f_i каждого компонента. Фаза
   CoolProp для смесей навязана по МАТЕМАТИЧЕСКОЙ ветви TS (gas для
   vapor): CoolProp без фазы может сам выполнить корневой выбор/flash
   и пометить состояние двухфазным (fugacity_coefficient откажет);
   flash/фазовое равновесие в объём 4.4.4.3 НЕ входят — сверяется
   выбранная ветвь той же кубики.

5. Точный нулевой предел a_mix (Stage 4.4.4.3.1, ключ дампа
   zeroAttractionLimit): N2 при T = 1388.2195230363366 K — alpha(T)
   вычисляется в binary64 РОВНО в 0 (a_i = a_mix = S_i = A_mix = 0);
   TS вычисляет ln(phi_i) ТОЧНОЙ предельной формой без члена
   притяжения; соседнее binary64-значение T = 1388.2195230363363 K
   (alpha = 1.232595164407831e-32) идёт общим путём (проверка
   отсутствия epsilon-переключения). Нулевой alpha — АРТЕФАКТ
   округления binary64 (точное значение нулю не равно), поэтому
   ГЛАВНЫЙ оракул предельного случая — mpmath с ТОЧНЫМИ binary64-
   входами: сходимость Z/ln(phi)/phi/f к значениям TS подтверждает,
   что предельная форма есть истинный предел; a_mix сверяется по
   АБСОЛЮТНОЙ близости к нулю (точный alpha — тот же порядок
   величины, что артефакт округления). CoolProp проверяет ту же
   ветвь gas одиночного флюида; если CoolProp точку дать не может,
   причина фиксируется ТОЧНО, результат НЕ подменяется собственным
   расчётом — проверкой предела остаётся mpmath.

   НЕ-КОНЕЧНЫЕ значения CoolProp (NaN/±Infinity) классифицируются
   ЯВНО (unavailable_nonfinite): относительная ошибка НЕ вычисляется
   (сравнение NaN > rtol ложно и ранее маскировало провал сверки),
   частичные конечные результаты (например, конечный Z при NaN phi)
   сохраняют собственный PASS, статус CoolProp и PASS mpmath
   указываются РАЗДЕЛЬНО; конечное, но неверное значение CoolProp
   проваливает benchmark. Отчёт сериализуется СТРОГИМ JSON
   (allow_nan=False) после нормализации NaN/Infinity -> null.

Числа из TS-дампа — выход СОБСТВЕННОЙ реализации (вход сравнения, НЕ
эталон). Неудачные точки НЕ скрываются: любая из них делает код
выхода ненулевым. Если CoolProp не может дать ветвь или параметр,
точка помечается failed с точной причиной и НЕ подменяется собственным
расчётом.

CoolProp и mpmath НЕ входят в runtime-зависимости TypeScript-приложения
(см. scripts/benchmarks/requirements.txt и отдельный workflow
.github/workflows/peng-robinson-benchmark.yml).

Документация CoolProp: https://coolprop.org/coolprop/Cubics.html
"""

from __future__ import annotations

import argparse
import importlib.metadata
import json
import math
import sys
from pathlib import Path

MPMATH_DPS = 50
RTOL_COOLPROP = 2e-4   # Ω: exact (CoolProp) против округлённых 0.45724/0.0778 (наша);
                       # максимум наблюдённых rel-ошибок ~9.8e-5, запас ~2x
RTOL_MPMATH = 5e-13    # проверка реализации против 50-значной арифметики
ATOL_ISOLATED_ROOT = 1e-9    # изолированный корень: двойная точность решателя
ATOL_NEAR_PAIR_ROOT = 1e-6  # корень вблизи кратного: обусловленность ~ sqrt(eps)
NEAR_PAIR_SPLIT = 1e-4      # порог «пары» (расщепление меньше — кластер)
ZERO_LIMIT_AMIX_ATOL = 1e-30  # |mp a_mix − ts a_mix| для нулевого предела:
                             # точный alpha — артефакт округления binary64,
                             # сверка АБСОЛЮТНАЯ (относительная невозможна
                             # и не требуется: проверяется предельная форма)

# ============================================
# Каталог Stage 4.4.4.1 (значения — из src/modules/Data/eosParameters.ts)
# ============================================
# builtin — имя встроенного флюида CoolProp (только для опроса параметров,
# НЕ для сравнения); custom — имя, регистрируемое через add_fluids_as_JSON;
# cas — СИНТЕТИЧЕСКИЙ уникальный CAS (не реальный CAS вещества, выбран
# уникальным, чтобы не конфликтовать со встроенной библиотекой);
# molemass — из легаси src/modules/Data/gases.ts (г/моль / 1000); на Z/phi/f
# (молярные величины) молярная масса НЕ влияет и служит только обязательным
# полем схемы CoolProp.
CATALOG = {
    "co2": {"Tc": 304.1282, "pc": 7377300.0, "omega": 0.22394,
            "molemass": 0.04401, "builtin": "CarbonDioxide",
            "custom": "EVWCO2", "cas": "90000-00-1"},
    "n2": {"Tc": 126.192, "pc": 3395800.0, "omega": 0.0372,
           "molemass": 0.02802, "builtin": "Nitrogen",
           "custom": "EVWN2", "cas": "90000-00-2"},
    "ch4": {"Tc": 190.564, "pc": 4599200.0, "omega": 0.01142,
            "molemass": 0.01604, "builtin": "Methane",
            "custom": "EVWCH4", "cas": "90000-00-3"},
    "h2o": {"Tc": 647.096, "pc": 22064000.0, "omega": 0.3442920843,
            "molemass": 0.018015, "builtin": "Water",
            "custom": "EVWH2O", "cas": "90000-00-4"},
    "ar": {"Tc": 150.687, "pc": 4863000.0, "omega": -0.00219,
           "molemass": 0.039948, "builtin": "Argon",
           "custom": "EVWAR", "cas": "90000-00-5"},
}

OMEGA_A_ROUNDED_VALUE = "0.45724"  # textbook-константа нашей TS-реализации
OMEGA_B_ROUNDED_VALUE = "0.0778"

# ============================================
# Каталог kij Stage 4.4.4.3 (значения — из src/modules/Data/
# binaryInteractionParameters.ts; только available-пары).
# В ОРАКУЛЕ значения НЕ используются как эталон: CoolProp они только
# ВВОДЯТСЯ (та же цифра, что и в TS-реализации), mpmath получает их
# из TS-дампа точки. Происхождение — provenance каталога:
# Okoro et al. 2024, doi:10.1002/ghg.2300 (Таблица 1, Original BIP);
# Köster, Thol & Vrabec 2018, doi:10.1021/acs.jced.7b00706 (Таблица 4).
KIJ_CATALOG = {
    "ar|co2": 0.129219,
    "ar|n2": -0.0037,
    "ch4|co2": 0.09897,
    "co2|n2": -0.017,
    "h2o|n2": -0.0501,
}


# ============================================
# Классификация результатов CoolProp (Stage 4.4.4.3.1, benchmark
# integrity): не-конечные значения (NaN/±Infinity) НЕ могут
# маскироваться как PASS (сравнение NaN > rtol ложно), НЕ
# сериализуются в JSON как NaN/Infinity и фиксируются с явным
# статусом unavailable_nonfinite. Функции ЧИСТЫЕ (без CoolProp) и
# покрыты Python unit-тестами test_peng_robinson_coolprop.py.
# ============================================
COOLPROP_STATUS_AVAILABLE = "available"
COOLPROP_STATUS_UNAVAILABLE_NONFINITE = "unavailable_nonfinite"
COOLPROP_STATUS_UNAVAILABLE_ERROR = "unavailable_error"

COOLPROP_POINT_AVAILABLE_PASS = "available_pass"
COOLPROP_POINT_AVAILABLE_FAIL = "available_fail"


def coolprop_value_status(value):
    """Статус одного значения CoolProp: available / unavailable_nonfinite / missing."""
    if value is None:
        return "missing"
    if isinstance(value, (int, float)) and math.isfinite(value):
        return COOLPROP_STATUS_AVAILABLE
    return COOLPROP_STATUS_UNAVAILABLE_NONFINITE


def observed_token(value):
    """Токен наблюдаемого не-конечного значения: 'NaN' / '+Infinity' / '-Infinity'."""
    if isinstance(value, float) and math.isnan(value):
        return "NaN"
    return "+Infinity" if value > 0 else "-Infinity"


def compare_coolprop_field(ts_value, cp_value, rtol):
    """Одно сравнение CoolProp против TS с ЯВНОЙ классификацией конечности.

    Конечность проверяется ДО вычисления ошибок: не-конечное значение
    (NaN/±Infinity) не сравнивается относительно (NaN > rtol ложно и
    ранее маскировало провал сверки) — поле получает статус
    unavailable_nonfinite, pass=None (никогда не True); наблюдаемый
    токен фиксируется без догадки о внутреннем механизме CoolProp.
    """
    status = coolprop_value_status(cp_value)
    result = {"status": status, "tolerance": rtol}
    if status != COOLPROP_STATUS_AVAILABLE:
        result["pass"] = None
        result["observed"] = (observed_token(cp_value)
                              if cp_value is not None else None)
        result["note"] = ("CoolProp вернул не конечное значение без "
                          "исключения; относительная ошибка НЕ "
                          "вычисляется, сравнение недоступно и НЕ "
                          "засчитывается как PASS")
        return result
    abs_err = abs(cp_value - ts_value)
    rel_err = abs_err / abs(ts_value)
    result["abs"] = abs_err
    result["rel"] = rel_err
    result["pass"] = rel_err <= rtol
    return result


def normalize_coolprop_vals(coolprop_vals):
    """Нормализация не-конечных значений CoolProp для СТРОГОГО JSON.

    NaN/±Infinity -> None (сериализуются как null) с фиксацией полей,
    вернувших не-конечное значение. Вызывать ПОСЛЕ сравнений: класс
    сравнивается по сырому значению, сериализуется — по нормализованному.
    Возвращает список не-конечных полей (пустой, если все конечны).
    """
    nonfinite = []
    for name in ("Z", "phi", "fugacity", "rhomolar"):
        value = coolprop_vals.get(name)
        if value is None:
            continue
        if isinstance(value, list):
            for i, item in enumerate(value):
                if isinstance(item, float) and not math.isfinite(item):
                    nonfinite.append(f"{name}[{i}]")
                    value[i] = None
        elif isinstance(value, float) and not math.isfinite(value):
            nonfinite.append(name)
            coolprop_vals[name] = None
    coolprop_vals["nonfinite_fields"] = nonfinite
    return nonfinite


def make_json_safe(obj):
    """Рекурсивная нормализация: NaN/±Infinity -> None (строгий JSON).

    Возвращает (нормализованный объект, список (путь, токен) замен).
    Страховка поверх посекционной нормализации: итоговый отчёт
    сериализуется с allow_nan=False — невалидные NaN/Infinity в JSON
    невозможны.
    """
    replaced = []

    def walk(value, path):
        if isinstance(value, float) and not math.isfinite(value):
            replaced.append((path or "<root>", observed_token(value)))
            return None
        if isinstance(value, dict):
            return {key: walk(item, f"{path}.{key}" if path else str(key))
                    for key, item in value.items()}
        if isinstance(value, list):
            return [walk(item, f"{path}[{i}]" if path else f"[{i}]")
                    for i, item in enumerate(value)]
        return value

    return walk(obj, ""), replaced


def zero_limit_coolprop_status(exception, field_comparisons):
    """Итоговый статус CoolProp для zero-attraction точки.

    unavailable_error — исключение CoolProp; available_fail — конечное
    значение вне допуска (провал benchmark); unavailable_nonfinite —
    NaN/±Infinity хотя бы в одном поле (сравнение недоступно, НЕ PASS);
    available_pass — все поля конечны и в допуске.
    """
    if exception is not None:
        return COOLPROP_STATUS_UNAVAILABLE_ERROR
    if any(field.get("pass") is False for field in field_comparisons.values()):
        return COOLPROP_POINT_AVAILABLE_FAIL
    if any(field.get("status") == COOLPROP_STATUS_UNAVAILABLE_NONFINITE
           for field in field_comparisons.values()):
        return COOLPROP_STATUS_UNAVAILABLE_NONFINITE
    if field_comparisons and all(field.get("pass") is True
                                 for field in field_comparisons.values()):
        return COOLPROP_POINT_AVAILABLE_PASS
    return COOLPROP_POINT_AVAILABLE_FAIL


def zero_limit_point_verdict(mp_pass, coolprop_status):
    """Правило итогового PASS zero-attraction точки (Stage 4.4.4.3.1).

    mpmath — ГЛАВНЫЙ оракул предельного случая: его провал проваливает
    точку. Конечное, но неверное значение CoolProp проваливает точку.
    Не-конечный результат или исключение CoolProp — зарегистрированная
    недоступность соответствующего сравнения: НЕ PASS и НЕ провал
    (проверкой предела остаётся mpmath).
    """
    if not mp_pass:
        return False
    return coolprop_status != COOLPROP_POINT_AVAILABLE_FAIL


def main() -> int:
    parser = argparse.ArgumentParser(description="CoolProp PR benchmark (Stage 4.4.4.2.2 + смеси 4.4.4.3)")
    parser.add_argument("--dump", default="benchmark-artifacts/peng-robinson-ts-dump.json",
                        help="путь к TS-дампу контрольных точек")
    parser.add_argument("--mixtures", default=None,
                        help="путь к TS-дампу СМЕСЕВЫХ контрольных точек (Stage 4.4.4.3)")
    parser.add_argument("--report", default="benchmark-artifacts/peng-robinson-coolprop-report.json",
                        help="путь записи JSON-отчёта")
    parser.add_argument("--summary-md", default="benchmark-artifacts/benchmark-summary.md",
                        help="путь записи markdown-итога (для $GITHUB_STEP_SUMMARY)")
    args = parser.parse_args()

    dump_path = Path(args.dump)
    if not dump_path.is_file():
        print(f"ОШИБКА: TS-дамп не найден: {dump_path}", file=sys.stderr)
        return 2
    with dump_path.open("r", encoding="utf-8") as handle:
        dump = json.load(handle)

    # --- Импорт оракулов ---
    try:
        import CoolProp.CoolProp as CP
    except Exception as exc:  # noqa: BLE001 — честная диагностика
        print(f"ОШИБКА: CoolProp недоступен: {exc}", file=sys.stderr)
        return 2
    try:
        from mpmath import mp, mpf, findroot, nstr, sqrt as mp_sqrt, \
            cos as mp_cos, acos as mp_acos, pi as mp_pi, log as mp_log
    except Exception as exc:  # noqa: BLE001
        print(f"ОШИБКА: mpmath недоступен: {exc}", file=sys.stderr)
        return 2

    # ============================================
    # mpmath: точные Ω из условия ТРОЙНОГО корня в критической точке
    # ============================================
    # Для кубики PR в критической точке A_c = Ω_a, B_c = Ω_b и кубика обязана
    # иметь тройной корень Zc = (1-Ω_b)/3. Решение системы условий тройного
    # корня даёт АНАЛИТИЧЕСКИЕ (точные) значения Ω — ими пользуется CoolProp.
    mp.dps = MPMATH_DPS

    def mp_from_float(x):
        """Точное binary64-значение float x как mpf: num/den из as_integer_ratio.

        float.as_integer_ratio() даёт ТОЧНЫЕ целые числитель/знаменатель
        binary64-числа (знаменатель — степень двойки); mpmath строит
        точное отношение — семантика double НЕ теряется через
        промежуточную десятичную строку mpf(str(x)).
        """
        num, den = float(x).as_integer_ratio()
        return mpf(num) / mpf(den)

    def omega_system(oa, ob):
        return (oa - 3 * ob * ob - 2 * ob - (1 - ob) ** 2 / 3,
                oa * ob - ob * ob - ob ** 3 - (1 - ob) ** 3 / 27)

    omega_solution = findroot(omega_system, (mpf("0.45724"), mpf("0.0778")))
    omega_a_exact, omega_b_exact = mpf(omega_solution[0]), mpf(omega_solution[1])

    omega_a_rounded = mpf(OMEGA_A_ROUNDED_VALUE)
    omega_b_rounded = mpf(OMEGA_B_ROUNDED_VALUE)

    # ============================================
    # mpmath: независимая PR-кубика (Кардано, 50 знаков)
    # ============================================

    def real_cbrt(x):
        x = mpf(x)
        if x < 0:
            return -(-x) ** (mpf(1) / 3)
        return x ** (mpf(1) / 3)

    def cubic_real_roots_mp(c2, c1, c0):
        """Корни z^3 + c2 z^2 + c1 z + c0 = 0 в mp-точности.

        Возвращает (real_roots, complex_pair_center_or_None, disc, disc_scale).
        """
        p = c1 - c2 * c2 / 3
        q = 2 * c2 ** 3 / 27 - c1 * c2 / 3 + c0
        disc = q * q / 4 + p ** 3 / 27
        disc_scale = abs(q * q / 4) + abs(p ** 3 / 27)
        if disc > 0:
            sd = mp_sqrt(disc)
            u = real_cbrt(-q / 2 + sd)
            v = real_cbrt(-q / 2 - sd)
            y1 = u + v
            real = [y1 - c2 / 3]
            # центр комплексной пары: -(u+v)/2
            pair_center = (-(u + v) / 2) - c2 / 3
            return real, pair_center, disc, disc_scale
        if disc < 0:
            m3 = -p / 3  # mp = -p/3 > 0
            m = 2 * mp_sqrt(m3)
            arg = -q / (2 * m3 * mp_sqrt(m3))
            arg = max(mpf(-1), min(mpf(1), arg))
            real = []
            for k in range(3):
                t = mp_acos(arg) / 3 - 2 * mp_pi * k / 3
                real.append(m * mp_cos(t) - c2 / 3)
            return real, None, disc, disc_scale
        # disc == 0: кратный корень
        u = real_cbrt(-q / 2)
        real = [2 * u - c2 / 3, -u - c2 / 3]
        return real, None, disc, disc_scale

    def pr_mpmath(T, P, Tc, pc, omega, R, omega_a, omega_b):
        """Классический PR (1976) в mp-точности. Возвращает A, B, корни, lnphi."""
        T, P, Tc, pc, omega, R = (mpf(T), mpf(P), mpf(Tc), mpf(pc), mpf(omega), mpf(R))
        kappa = mpf("0.37464") + mpf("1.54226") * omega - mpf("0.26992") * omega * omega
        alpha = (1 + kappa * (1 - mp_sqrt(T / Tc))) ** 2
        a = omega_a * R * R * Tc * Tc / pc * alpha
        b = omega_b * R * Tc / pc
        A = a * P / (R * R * T * T)
        B = b * P / (R * T)
        c2 = -(1 - B)
        c1 = A - 3 * B * B - 2 * B
        c0 = -(A * B - B * B - B * B * B)
        roots, _pair, _disc, _scale = cubic_real_roots_mp(c2, c1, c0)
        physical = sorted(z for z in roots if z > B)

        def lnphi(z):
            return (z - 1 - mp_log(z - B)
                    - A / (2 * mp_sqrt(2) * B)
                    * mp_log((z + (1 + mp_sqrt(2)) * B) / (z + (1 - mp_sqrt(2)) * B)))

        return {"A": A, "B": B, "real": roots, "physical": physical, "lnphi": lnphi}

    # ============================================
    # CoolProp: версия, R, встроенные параметры, регистрация флюидов
    # ============================================
    coolprop_meta = {
        "version": None,
        "gitrevision": None,
        "backend": "PR",
        "r_universal": None,
        "r_source": None,
    }
    try:
        coolprop_meta["version"] = importlib.metadata.version("CoolProp")
    except Exception as exc:  # noqa: BLE001 — честная фиксация, НЕ подмена
        coolprop_meta["version"] = f"не определена: {exc}"
    # CoolProp не экспортирует git revision (getattr по __gitrevision__
    # возвращал None) — фиксируем явный null с пояснением, SHA не выдумываем.
    coolprop_meta["gitrevision"] = None
    coolprop_meta["gitrevision_note"] = (
        "CoolProp не экспортирует git revision; поле null, SHA не "
        "реконструируется")
    try:
        coolprop_meta["mpmath_version"] = importlib.metadata.version("mpmath")
    except Exception as exc:  # noqa: BLE001
        coolprop_meta["mpmath_version"] = f"не определена: {exc}"
    try:
        coolprop_meta["r_universal"] = float(CP.gas_constant())
        coolprop_meta["r_source"] = "CP.gas_constant()"
    except Exception:  # noqa: BLE001 — диагностика в отчёт
        try:
            coolprop_meta["r_universal"] = float(CP.get_global_param_double("gas_constant"))
            coolprop_meta["r_source"] = "CP.get_global_param_double('gas_constant')"
        except Exception as exc:  # noqa: BLE001
            coolprop_meta["r_source"] = f"недоступно: {exc}"

    # Опрос встроенных PR-флюидов (только фиксация в отчёте, НЕ сравнение)
    builtin_parameters = {}
    for gas_id, info in CATALOG.items():
        entry = {"name": info["builtin"], "Tc": None, "pc": None,
                 "acentric": None, "molemass": None, "error": None}
        for key, prop in (("Tc", "Tcrit"), ("pc", "Pcrit"),
                          ("acentric", "acentric"), ("molemass", "molemass")):
            try:
                entry[key] = float(CP.PropsSI(prop, f"PR::{info['builtin']}"))
            except Exception as exc:  # noqa: BLE001
                entry["error"] = f"PropsSI('{prop}') failed: {exc}"
                break
        builtin_parameters[gas_id] = entry

    # Регистрация флюидов с ТОЧНЫМИ параметрами каталога (никаких замен)
    fluids_json = [
        {"CAS": info["cas"], "Tc": info["Tc"], "Tc_units": "K",
         "acentric": info["omega"], "aliases": [],
         "molemass": info["molemass"], "molemass_units": "kg/mol",
         "name": info["custom"], "pc": info["pc"], "pc_units": "Pa"}
        for info in CATALOG.values()
    ]
    add_result = None
    add_error = None
    try:
        add_result = bool(CP.add_fluids_as_JSON("PR", json.dumps(fluids_json)))
    except Exception as exc:  # noqa: BLE001
        add_error = str(exc)

    custom_fluids = {
        "add_fluids_as_JSON_return": add_result,
        "add_fluids_as_JSON_error": add_error,
        "note": ("CAS синтетические (уникальные), молекулярная масса из легаси "
                 "gases.ts; на Z/phi/f (молярные величины) molemass не влияет"),
        "fluids": {},
    }
    if add_error is not None:
        print(f"ОШИБКА: add_fluids_as_JSON: {add_error}", file=sys.stderr)
    for gas_id, info in CATALOG.items():
        match = {"name": info["custom"], "parameter_match": {}, "error": None}
        for key, expected, prop in (("Tc", info["Tc"], "Tcrit"),
                                    ("pc", info["pc"], "Pcrit"),
                                    ("acentric", info["omega"], "acentric"),
                                    ("molemass", info["molemass"], "molemass")):
            try:
                got = float(CP.PropsSI(prop, f"PR::{info['custom']}"))
                match["parameter_match"][key] = {
                    "catalog": expected, "coolprop": got,
                    "equal": got == float(expected),
                }
            except Exception as exc:  # noqa: BLE001
                match["error"] = f"PropsSI('{prop}', 'PR::{info['custom']}') failed: {exc}"
                break
        custom_fluids["fluids"][gas_id] = match

    # ============================================
    # Точки: CoolProp против TS
    # ============================================
    points = []
    for row in dump.get("points", []):
        gas_id = row["gasId"]
        info = CATALOG[gas_id]
        phase_specified = None
        coolprop_vals = {"Z": None, "Z_source": None, "phi": None,
                         "fugacity": None, "rhomolar": None, "error": None}
        if add_error is None and custom_fluids["fluids"][gas_id]["error"] is None:
            try:
                state = CP.AbstractState("PR", info["custom"])
                # Ветвь задаётся когда у TS есть различимые ветви (T < Tc);
                # если же CoolProp сам выбрать корень не может (кубика с
                # тремя действительными корнями без фазы) — ветвь TS
                # навязывается ниже, при повторе update.
                if len(row["physicalRoots"]) >= 2:
                    phase_specified = "gas" if row["root"] == "vapor" else "liquid"
                    state.specify_phase(
                        CP.iphase_gas if row["root"] == "vapor" else CP.iphase_liquid)
                try:
                    state.update(CP.PT_INPUTS, row["pressurePa"], row["temperatureK"])
                except ValueError as exc:
                    # CoolProp отказывается сам выбирать корень, если у
                    # кубики ТРИ действительных корня и фаза не задана
                    # ("Cubic has three roots, but phase not imposed and
                    # guess density not provided"). У TS в такой точке
                    # один ФИЗИЧЕСКИЙ корень (Z > B); остальные корни
                    # кубики лежат вне физической области. Навязываем
                    # ветвь TS и повторяем update; деталь честно
                    # фиксируется в отчёте точки.
                    msg = str(exc)
                    if phase_specified is not None or not (
                            "phase not imposed" in msg or "guess density" in msg):
                        raise
                    phase_specified = "gas" if row["root"] == "vapor" else "liquid"
                    state.specify_phase(
                        CP.iphase_gas if row["root"] == "vapor" else CP.iphase_liquid)
                    coolprop_vals["phase_imposed_after_refusal"] = (
                        f"update(PT) отказал ({msg}); фаза "
                        f"'{phase_specified}' навязана по ветви TS, update повторён")
                    state.update(CP.PT_INPUTS, row["pressurePa"], row["temperatureK"])
                rho = float(state.rhomolar())
                coolprop_vals["rhomolar"] = rho
                try:
                    coolprop_vals["Z"] = float(state.keyed_output(CP.iZ))
                    coolprop_vals["Z_source"] = "AS.keyed_output(CP.iZ)"
                except Exception:  # noqa: BLE001 — документированный fallback
                    r_coolprop = coolprop_meta["r_universal"]
                    if r_coolprop is None:
                        r_coolprop = dump["universalGasConstantJPerMolK"]
                    coolprop_vals["Z"] = (row["pressurePa"]
                                           / (rho * r_coolprop * row["temperatureK"]))
                    coolprop_vals["Z_source"] = "P/(rhomolar*R*T), R CoolProp"
                coolprop_vals["phi"] = float(state.fugacity_coefficient(0))
                coolprop_vals["fugacity"] = float(state.fugacity(0))
            except Exception as exc:  # noqa: BLE001 — точная причина, НЕ подмена
                coolprop_vals["error"] = f"{type(exc).__name__}: {exc}"

        comparisons = {}
        point_pass = coolprop_vals["error"] is None
        for name, ts_value, cp_value in (
                ("Z", row["Z"], coolprop_vals["Z"]),
                ("phi", row["phi"], coolprop_vals["phi"]),
                ("fugacity", row["fugacityPa"], coolprop_vals["fugacity"])):
            if cp_value is None or ts_value is None or ts_value == 0:
                comparisons[name] = None
                point_pass = False
                continue
            # Конечность ДО ошибок: NaN/±Infinity не сравниваются
            # относительно (NaN > rtol ложно и маскировал провал) —
            # точка честно проваливается с явным статусом.
            field = compare_coolprop_field(ts_value, cp_value, RTOL_COOLPROP)
            comparisons[name] = field
            if field["pass"] is not True:
                point_pass = False
        # Нормализация NaN/±Infinity -> null для строгого JSON
        normalize_coolprop_vals(coolprop_vals)

        points.append({
            "id": row["id"], "gasId": gas_id,
            "temperatureK": row["temperatureK"], "pressurePa": row["pressurePa"],
            "root": row["root"], "phase_specified": phase_specified,
            "oracle_parameters": {
                "Tc": info["Tc"], "pc": info["pc"], "omega": info["omega"],
                "molemass": info["molemass"], "name": info["custom"],
                "source": "каталог Stage 4.4.4.1 через add_fluids_as_JSON",
            },
            "coolprop": coolprop_vals,
            "typescript": {k: row[k] for k in
                           ("Z", "phi", "fugacityPa", "lnPhi", "dimensionlessA",
                            "dimensionlessB", "rhoMolar", "physicalRoots")},
            "comparison": comparisons,
            "pass": point_pass,
        })

    # ============================================
    # mpmath: независимая реализация с НАШИМИ константами против TS
    # ============================================
    R_TS = mp_from_float(dump["universalGasConstantJPerMolK"])
    mpmath_points = []
    for row in dump.get("points", []):
        info = CATALOG[row["gasId"]]
        calc = pr_mpmath(row["temperatureK"], row["pressurePa"], info["Tc"],
                         info["pc"], info["omega"], R_TS,
                         omega_a_rounded, omega_b_rounded)
        physical = calc["physical"]
        if not physical:
            mpmath_points.append({"id": row["id"], "error": "нет физических корней", "pass": False})
            continue
        z_sel = (physical[-1] if row["root"] == "vapor" else physical[0])
        lnphi = float(calc["lnphi"](z_sel))
        phi = float(mp.exp(calc["lnphi"](z_sel)))
        fugacity = phi * row["pressurePa"]
        entry = {"id": row["id"], "dps": MPMATH_DPS,
                 "Z": float(z_sel), "lnPhi": lnphi, "phi": phi, "fugacity": fugacity,
                 "physicalRootCount": len(physical), "pass": True, "comparison": {}}
        for name, ts_value, mp_value in (("Z", row["Z"], float(z_sel)),
                                         ("phi", row["phi"], phi),
                                         ("fugacity", row["fugacityPa"], fugacity)):
            rel_err = abs(mp_value - ts_value) / abs(ts_value)
            entry["comparison"][name] = {"abs": abs(mp_value - ts_value),
                                         "rel": rel_err, "tolerance": RTOL_MPMATH,
                                         "pass": rel_err <= RTOL_MPMATH}
            if rel_err > RTOL_MPMATH:
                entry["pass"] = False
        # контроль: TS lnPhi против mp lnPhi (отдельно, допуск по phi)
        entry["lnPhi_ts"] = row["lnPhi"]
        entry["lnPhi_rel"] = abs(lnphi - row["lnPhi"]) / max(abs(row["lnPhi"]), 1e-12)
        mpmath_points.append(entry)

    # ============================================
    # Зонд Ω: какая вариация констант ближе к CoolProp
    # ============================================
    omega_probe = {"omega_a_rounded": str(omega_a_rounded),
                   "omega_b_rounded": str(omega_b_rounded),
                   "omega_a_exact": nstr(omega_a_exact, 30),
                   "omega_b_exact": nstr(omega_b_exact, 30),
                   "per_point_max_rel": []}
    rounded_wins = 0
    exact_wins = 0
    for row, point in zip(dump.get("points", []), points):
        if point["coolprop"]["phi"] is None:
            continue
        info = CATALOG[row["gasId"]]
        worst = {"id": row["id"], "rounded": None, "exact": None, "closer": None}
        for variant, (oa, ob) in (("rounded", (omega_a_rounded, omega_b_rounded)),
                                  ("exact", (omega_a_exact, omega_b_exact))):
            calc = pr_mpmath(row["temperatureK"], row["pressurePa"], info["Tc"],
                             info["pc"], info["omega"], R_TS, oa, ob)
            if not calc["physical"]:
                continue
            z_sel = (calc["physical"][-1] if row["root"] == "vapor" else calc["physical"][0])
            phi = float(mp.exp(calc["lnphi"](z_sel)))
            worst[variant] = abs(phi - point["coolprop"]["phi"]) / abs(point["coolprop"]["phi"])
        if worst["rounded"] is not None and worst["exact"] is not None:
            worst["closer"] = ("rounded" if worst["rounded"] < worst["exact"] else "exact")
            if worst["closer"] == "rounded":
                rounded_wins += 1
            else:
                exact_wins += 1
        omega_probe["per_point_max_rel"].append(worst)
    omega_probe["rounded_wins"] = rounded_wins
    omega_probe["exact_wins"] = exact_wins
    omega_probe["conclusion"] = ("CoolProp ближе к ТОЧНЫМ Ω (аналитическим)"
                                 if exact_wins > rounded_wins else
                                 "CoolProp ближе к ОКРУГЛЁННЫМ textbook Ω"
                                 if rounded_wins > exact_wins else "неопределённо")

    # ============================================
    # Граничный оракул: A0±delta и double-root fixture против TS
    # ============================================
    boundary = []
    for case in dump.get("boundary", {}).get("cases", []):
        A = mp_from_float(case["A"])
        B = mp_from_float(case["B"])
        c2 = -(1 - B)
        c1 = A - 3 * B * B - 2 * B
        c0 = -(A * B - B * B - B * B * B)
        real, pair_center, disc, disc_scale = cubic_real_roots_mp(c2, c1, c0)
        rel_disc = float(abs(disc) / disc_scale) if disc_scale != 0 else 0.0
        ts_roots = case["roots"]
        solver_failure = bool(case.get("solverFailure", False))
        disc_sign = ("positive" if disc > 0 else "negative" if disc < 0 else "zero")
        if solver_failure:
            # TS дал структурный отказ (solverFailure в дампе). Оракул
            # классифицирует случай САМ, по mpmath: отказ обоснован
            # <=> точный дискриминант ОТРИЦАТЕЛЕН (математически ТРИ
            # действительных корня) И минимальное расщепление соседних
            # корней МЕНЬШЕ зеркала TS-дедупликации 1e-8*max(1,|z|,B)
            # (пара неразличима в double). Молчаливый PASS запрещён:
            # статус solver_failure фиксируется явно, все числа — в
            # отчёте; необоснованный отказ — провал точки.
            sorted_real = sorted(real)
            splits = [float(sorted_real[i + 1] - sorted_real[i])
                      for i in range(len(sorted_real) - 1)]
            min_split = min(splits) if splits else None
            ts_dedup_mirror = float(
                1e-8 * max([mpf(1)] + [abs(z) for z in sorted_real] + [abs(B)]))
            justified = bool(disc < 0 and len(real) == 3
                             and min_split is not None
                             and min_split < ts_dedup_mirror)
            boundary.append({
                "label": case["label"], "A": case["A"], "B": case["B"],
                "mp_real_root_count": len(real),
                "mp_real_roots": [nstr(z, 20) for z in sorted_real],
                "mp_min_pair_split": min_split,
                "ts_dedup_mirror": ts_dedup_mirror,
                "mp_complex_pair_center": (nstr(pair_center, 20)
                                            if pair_center is not None else None),
                "disc_sign": disc_sign,
                "disc_rel": rel_disc,
                "ts_status": "solver_failure",
                "ts_refusal_reason": case.get("reason"),
                "ts_root_count": 0, "ts_roots": ts_roots,
                "justified": justified,
                "pass": justified,
            })
            continue
        entry = {"label": case["label"], "A": case["A"], "B": case["B"],
                 "mp_real_root_count": len(real),
                 "mp_real_roots": [nstr(z, 20) for z in sorted(real)],
                 "mp_complex_pair_center": (nstr(pair_center, 20)
                                             if pair_center is not None else None),
                 "disc_sign": disc_sign,
                 "disc_rel": rel_disc,
                 "ts_status": "ok",
                 "ts_root_count": len(ts_roots), "ts_roots": ts_roots,
                 "match": None, "pass": False}
        if len(real) == len(ts_roots):
            match = match_root_lists(ts_roots, [float(z) for z in sorted(real)])
        else:
            # Строгая сверка числа действительных корней: расхождение —
            # провал точки. Исключение «полосы кратного корня» из 4.4.4.2.1
            # УДАЛЕНО: TS-решатель 4.4.4.2.2 классифицирует знак
            # дискриминанта double-double арифметикой и возвращает
            # математически корректное число корней либо отказ —
            # критическая точка производной больше не выдаётся за корень.
            entry["match"] = {"error": (f"разное число действительных корней: "
                                        f"mp={len(real)}, ts={len(ts_roots)}")}
            boundary.append(entry)
            continue
        entry["match"] = match
        entry["pass"] = bool(match["pass"])
        boundary.append(entry)

    # ============================================
    # Смесевой оракул (Stage 4.4.4.3): CoolProp PR с каталожными kij
    # и независимая mpmath-реализация правил смешения
    # ============================================
    # ЧЕСТНАЯ СЕМАНТИКА: CoolProp НЕ содержит собственных значений kij
    # (документация Cubics: «CoolProp does not come with any values for
    # the kij parameter»), поэтому каталожные kij Stage 4.4.4.3 ВВОДЯТСЯ
    # в CoolProp через set_binary_interaction_double(i, j, "kij", v).
    # Оракул ВАЛИДИРУЕТ РЕАЛИЗАЦИЮ (правила смешения, кубику, phi_i)
    # при одинаковых kij; он НЕ является независимым подтверждением
    # ЗНАЧЕНИЙ kij — те остаются PARTIALLY_VERIFIED по provenance
    # каталога (подгонки Okoro 2024 / Köster 2018).
    mixtures_data = None
    if args.mixtures is not None:
        mixtures_path = Path(args.mixtures)
        if not mixtures_path.is_file():
            print(f"ОШИБКА: TS-дамп смесей не найден: {mixtures_path}", file=sys.stderr)
            return 2
        with mixtures_path.open("r", encoding="utf-8") as handle:
            mixtures_data = json.load(handle)

    mixture_coolprop_points = []
    mixture_mpmath_points = []

    def pr_mixture_mpmath(T, P, comp_ids, fractions, kij_map, R, omega_a, omega_b):
        """Классические правила смешения PR в mp-точности.

        Независимая ре-реализация (НЕ код TS): a_ij = (1-kij)sqrt(a_i a_j),
        a_mix = sum_i sum_j x_i x_j a_ij, b_mix = sum_i x_i b_i, та же
        кубика, ln(phi_i) с S_i = sum_j x_j a_ij. Все binary64-входы —
        через as_integer_ratio (точная семантика double).
        """
        T = mp_from_float(T)
        P = mp_from_float(P)
        a_list = []
        b_list = []
        for gas_id in comp_ids:
            info = CATALOG[gas_id]
            Tc = mp_from_float(info["Tc"])
            pc = mp_from_float(info["pc"])
            omega = mp_from_float(info["omega"])
            kappa = mpf("0.37464") + mpf("1.54226") * omega - mpf("0.26992") * omega * omega
            alpha = (1 + kappa * (1 - mp_sqrt(T / Tc))) ** 2
            a_list.append(omega_a * R * R * Tc * Tc / pc * alpha)
            b_list.append(omega_b * R * Tc / pc)
        n = len(comp_ids)
        aij = [[None] * n for _ in range(n)]
        for i in range(n):
            for j in range(n):
                if i == j:
                    aij[i][j] = a_list[i]
                else:
                    key = "|".join(sorted((comp_ids[i], comp_ids[j])))
                    kij = mp_from_float(kij_map[key])
                    aij[i][j] = (1 - kij) * mp_sqrt(a_list[i] * a_list[j])
        x = [mp_from_float(f) for f in fractions]
        a_mix = sum(x[i] * x[j] * aij[i][j] for i in range(n) for j in range(n))
        b_mix = sum(x[i] * b_list[i] for i in range(n))
        A = a_mix * P / (R * R * T * T)
        B = b_mix * P / (R * T)
        c2 = -(1 - B)
        c1 = A - 3 * B * B - 2 * B
        c0 = -(A * B - B * B - B * B * B)
        roots, _pair, _disc, _scale = cubic_real_roots_mp(c2, c1, c0)
        physical = sorted(z for z in roots if z > B)
        s_list = [sum(x[j] * aij[i][j] for j in range(n)) for i in range(n)]

        def lnphi_i(i, z):
            return ((b_list[i] / b_mix) * (z - 1)
                    - mp_log(z - B)
                    - A / (2 * mp_sqrt(2) * B)
                    * (2 * s_list[i] / a_mix - b_list[i] / b_mix)
                    * mp_log((z + (1 + mp_sqrt(2)) * B)
                             / (z + (1 - mp_sqrt(2)) * B)))

        return {"A": A, "B": B, "physical": physical, "lnphi_i": lnphi_i,
                "a_mix": a_mix, "b_mix": b_mix}

    if mixtures_data is not None:
        for row in mixtures_data.get("points", []):
            comp_ids = [c["gasId"] for c in row["composition"]]
            fractions = [float(c["moleFraction"]) for c in row["composition"]]
            index_of = {c["gasId"]: i for i, c in enumerate(row["composition"])}
            kij_map = {p["pairKey"]: float(p["kij"]) for p in row["kijUsed"]}

            # --- CoolProp: смесь зарегистрированных флюидов + kij каталога ---
            phase_specified = None
            coolprop_vals = {"Z": None, "Z_source": None, "phi": [],
                             "fugacity": [], "rhomolar": None, "error": None}
            fluid_errors = [custom_fluids["fluids"][g]["error"] for g in comp_ids]
            if add_error is not None or any(e is not None for e in fluid_errors):
                coolprop_vals["error"] = (
                    f"add_fluids_as_JSON error: {add_error}; "
                    f"per-fluid: {fluid_errors}")
            else:
                try:
                    names = [CATALOG[g]["custom"] for g in comp_ids]
                    state = CP.AbstractState("PR", "&".join(names))
                    # Каталожные kij вводятся ДО update; значения — из
                    # TS-дампа точки (те же цифры, что использует TS).
                    for pair in row["kijUsed"]:
                        a, b = pair["pairKey"].split("|")
                        state.set_binary_interaction_double(
                            index_of[a], index_of[b], "kij", float(pair["kij"]))
                        # Симметрично (j, i): матрица взаимодействия в CoolProp
                        # хранится по направлениям; каталожный kij симметричен.
                        state.set_binary_interaction_double(
                            index_of[b], index_of[a], "kij", float(pair["kij"]))
                    state.set_mole_fractions(fractions)
                    # Для смесей фаза навязывается ВСЕГДА по математической
                    # ветви TS (gas для vapor / liquid для liquid). При
                    # (P, T, x) без навязанной фазы CoolProp может сам
                    # выполнить корневой выбор/flash и пометить состояние
                    # двухфазным — тогда fugacity_coefficient отказывает
                    # («not well-defined in the two-phase region»).
                    # Flash/фазовое равновесие в объём 4.4.4.3 НЕ входят:
                    # оракул проверяет выбранную TS МАТЕМАТИЧЕСКУЮ ветвь
                    # той же кубики (правила смешения, корни, phi_i).
                    phase_specified = "gas" if row["root"] == "vapor" else "liquid"
                    state.specify_phase(
                        CP.iphase_gas if row["root"] == "vapor" else CP.iphase_liquid)
                    try:
                        state.update(CP.PT_INPUTS, row["pressurePa"], row["temperatureK"])
                    except ValueError as exc:
                        msg = str(exc)
                        if phase_specified is not None or not (
                                "phase not imposed" in msg or "guess density" in msg):
                            raise
                        phase_specified = "gas" if row["root"] == "vapor" else "liquid"
                        state.specify_phase(
                            CP.iphase_gas if row["root"] == "vapor" else CP.iphase_liquid)
                        coolprop_vals["phase_imposed_after_refusal"] = (
                            f"update(PT) отказал ({msg}); фаза "
                            f"'{phase_specified}' навязана по ветви TS, update повторён")
                        state.update(CP.PT_INPUTS, row["pressurePa"], row["temperatureK"])
                    rho = float(state.rhomolar())
                    coolprop_vals["rhomolar"] = rho
                    try:
                        coolprop_vals["Z"] = float(state.keyed_output(CP.iZ))
                        coolprop_vals["Z_source"] = "AS.keyed_output(CP.iZ)"
                    except Exception:  # noqa: BLE001 — документированный fallback
                        r_coolprop = coolprop_meta["r_universal"]
                        if r_coolprop is None:
                            r_coolprop = mixtures_data["universalGasConstantJPerMolK"]
                        coolprop_vals["Z"] = (row["pressurePa"]
                                              / (rho * r_coolprop * row["temperatureK"]))
                        coolprop_vals["Z_source"] = "P/(rhomolar*R*T), R CoolProp"
                    for i in range(len(comp_ids)):
                        coolprop_vals["phi"].append(float(state.fugacity_coefficient(i)))
                        coolprop_vals["fugacity"].append(float(state.fugacity(i)))
                except Exception as exc:  # noqa: BLE001 — точная причина, НЕ подмена
                    coolprop_vals["error"] = f"{type(exc).__name__}: {exc}"

            comparisons = {"Z": None, "components": []}
            point_pass = coolprop_vals["error"] is None
            if coolprop_vals["error"] is None:
                # Конечность ДО ошибок: NaN/±Infinity не сравниваются
                # относительно (NaN > rtol ложно и маскировал провал).
                z_field = compare_coolprop_field(row["Z"], coolprop_vals["Z"],
                                                 RTOL_COOLPROP)
                comparisons["Z"] = z_field
                if z_field["pass"] is not True:
                    point_pass = False
                for i, comp in enumerate(row["components"]):
                    comp_entry = {"component": comp["component"],
                                  "phi": None, "fugacity": None}
                    for name, ts_value, cp_value in (
                            ("phi", comp["phi"], coolprop_vals["phi"][i]),
                            ("fugacity", comp["fugacityPa"],
                             coolprop_vals["fugacity"][i])):
                        field = compare_coolprop_field(ts_value, cp_value,
                                                        RTOL_COOLPROP)
                        comp_entry[name] = field
                        if field["pass"] is not True:
                            point_pass = False
                    comparisons["components"].append(comp_entry)
                # Нормализация NaN/±Infinity -> null для строгого JSON
                normalize_coolprop_vals(coolprop_vals)
            mixture_coolprop_points.append({
                "id": row["id"],
                "composition": row["composition"],
                "kijUsed": row["kijUsed"],
                "temperatureK": row["temperatureK"],
                "pressurePa": row["pressurePa"],
                "root": row["root"],
                "phase_specified": phase_specified,
                "semantics": ("ВАЛИДАЦИЯ РЕАЛИЗАЦИИ при одинаковых kij "
                              "(введены в CoolProp через "
                              "set_binary_interaction_double); НЕ независимое "
                              "подтверждение значений kij (PARTIALLY_VERIFIED)"),
                "coolprop": coolprop_vals,
                "typescript": {"Z": row["Z"],
                                "dimensionlessA": row["dimensionlessA"],
                                "dimensionlessB": row["dimensionlessB"],
                                "aMix": row["aMixPaM6PerMol2"],
                                "bMix": row["bMixM3PerMol"],
                                "components": row["components"]},
                "comparison": comparisons,
                "pass": point_pass,
            })

            # --- mpmath: независимая реализация правил смешения против TS ---
            calc = pr_mixture_mpmath(row["temperatureK"], row["pressurePa"],
                                     comp_ids, fractions, kij_map, R_TS,
                                     omega_a_rounded, omega_b_rounded)
            physical = calc["physical"]
            entry = {"id": row["id"], "dps": MPMATH_DPS, "pass": True,
                     "comparison": {}}
            if not physical:
                entry["error"] = "нет физических корней"
                entry["pass"] = False
            else:
                z_sel = (physical[-1] if row["root"] == "vapor" else physical[0])
                entry["Z"] = float(z_sel)
                entry["physicalRootCount"] = len(physical)
                for name, ts_value, mp_value in (
                        ("Z", row["Z"], float(z_sel)),
                        ("aMix", row["aMixPaM6PerMol2"], float(calc["a_mix"])),
                        ("bMix", row["bMixM3PerMol"], float(calc["b_mix"]))):
                    rel_err = abs(mp_value - ts_value) / abs(ts_value)
                    entry["comparison"][name] = {
                        "abs": abs(mp_value - ts_value), "rel": rel_err,
                        "tolerance": RTOL_MPMATH,
                        "pass": rel_err <= RTOL_MPMATH}
                    if rel_err > RTOL_MPMATH:
                        entry["pass"] = False
                entry["components"] = []
                for i, comp in enumerate(row["components"]):
                    lnphi = calc["lnphi_i"](i, z_sel)
                    phi = float(mp.exp(lnphi))
                    fugacity = float(mp_from_float(comp["moleFraction"])
                                     * mp.exp(lnphi) * mp_from_float(row["pressurePa"]))
                    comp_entry = {"component": comp["component"],
                                  "lnPhi": float(lnphi), "phi": phi,
                                  "fugacity": fugacity, "comparison": {}}
                    for name, ts_value, mp_value in (
                            ("phi", comp["phi"], phi),
                            ("fugacity", comp["fugacityPa"], fugacity)):
                        rel_err = abs(mp_value - ts_value) / abs(ts_value)
                        comp_entry["comparison"][name] = {
                            "abs": abs(mp_value - ts_value), "rel": rel_err,
                            "tolerance": RTOL_MPMATH,
                            "pass": rel_err <= RTOL_MPMATH}
                        if rel_err > RTOL_MPMATH:
                            entry["pass"] = False
                    entry["components"].append(comp_entry)
            mixture_mpmath_points.append(entry)

    # ============================================
    # Точный нулевой предел a_mix (Stage 4.4.4.3.1)
    # ============================================
    # Фикстуры TS-дампа (однокомпонентная «смесь» N2, 1 МПа):
    #   T = 1388.2195230363366 K — alpha(T) в binary64 РОВНО 0
    #     (a_i = a_mix = S_i = A_mix = 0, b_mix > 0): TS вычисляет
    #     ln(phi_i) ТОЧНОЙ предельной формой без члена притяжения;
    #   T = 1388.2195230363363 K (соседнее binary64-значение, 1 ulp
    #     ниже): alpha = 1.232595164407831e-32 — общий путь, проверка
    #     отсутствия epsilon-переключения.
    # СЕМАНТИКА: нулевой alpha — АРТЕФАКТ округления binary64 (точное
    # значение нулю не равно), поэтому ГЛАВНЫЙ оракул предельного
    # случая — mpmath с ТОЧНЫМИ binary64-входами: сходимость
    # Z/ln(phi)/phi/f к значениям TS подтверждает, что предельная
    # форма есть истинный предел. a_mix НЕ сравнивается относительно
    # (точный alpha — тот же порядок величины, что артефакт округления):
    # проверяется АБСОЛЮТНАЯ близость |mp a_mix − ts a_mix| <= 1e-30.
    # CoolProp проверяет ту же ветвь gas одиночного флюида; если
    # CoolProp точку дать не может, причина фиксируется ТОЧНО,
    # результат НЕ подменяется собственным расчётом — проверкой
    # предела остаётся mpmath.
    zero_limit_cases = []
    if mixtures_data is not None:
        zero_limit_cases = (mixtures_data.get("zeroAttractionLimit", {})
                            .get("cases", []))
    zero_limit_points = []
    for case in zero_limit_cases:
        comp_ids = [c["gasId"] for c in case["composition"]]
        fractions = [float(c["moleFraction"]) for c in case["composition"]]
        gas_id = comp_ids[0]
        info = CATALOG[gas_id]

        # --- CoolProp: одиночный флюид, ветвь gas (ветвь TS) ---
        coolprop_vals = {"Z": None, "Z_source": None, "phi": None,
                         "fugacity": None, "rhomolar": None, "error": None,
                         "phase_specified": "gas"}
        if add_error is not None or custom_fluids["fluids"][gas_id]["error"] is not None:
            coolprop_vals["error"] = "флюид не зарегистрирован (add_fluids_as_JSON)"
        else:
            try:
                state = CP.AbstractState("PR", info["custom"])
                state.specify_phase(CP.iphase_gas)
                state.update(CP.PT_INPUTS, case["pressurePa"], case["temperatureK"])
                coolprop_vals["rhomolar"] = float(state.rhomolar())
                try:
                    coolprop_vals["Z"] = float(state.keyed_output(CP.iZ))
                    coolprop_vals["Z_source"] = "AS.keyed_output(CP.iZ)"
                except Exception:  # noqa: BLE001 — документированный fallback
                    r_coolprop = coolprop_meta["r_universal"]
                    if r_coolprop is None:
                        r_coolprop = mixtures_data["universalGasConstantJPerMolK"]
                    coolprop_vals["Z"] = (case["pressurePa"]
                                          / (coolprop_vals["rhomolar"] * r_coolprop
                                             * case["temperatureK"]))
                    coolprop_vals["Z_source"] = "P/(rhomolar*R*T), R CoolProp"
                coolprop_vals["phi"] = float(state.fugacity_coefficient(0))
                coolprop_vals["fugacity"] = float(state.fugacity(0))
            except Exception as exc:  # noqa: BLE001 — точная причина, НЕ подмена
                coolprop_vals["error"] = f"{type(exc).__name__}: {exc}"

        ts_comp = case["components"][0]
        # Исключение CoolProp (если было) — отдельно от не-конечных
        # значений: недоступность сравнения классифицируется ПО-РАЗНОМУ
        # (unavailable_error против unavailable_nonfinite).
        coolprop_exception = coolprop_vals["error"]
        entry = {
            "id": case["id"], "gasId": gas_id,
            "temperatureK": case["temperatureK"], "pressurePa": case["pressurePa"],
            "note": case.get("note"),
            "semantics": ("точный нулевой предел a_mix (Stage 4.4.4.3.1); "
                          "главный оракул — mpmath с точными binary64-"
                          "входами; CoolProp — та же ветвь gas, статус "
                          "классифицируется явно (available_pass / "
                          "available_fail / unavailable_nonfinite / "
                          "unavailable_error) и указывается РАЗДЕЛЬНО от "
                          "PASS mpmath; не-конечные значения CoolProp "
                          "сравнением НЕ засчитываются"),
            "coolprop": coolprop_vals,
            "typescript": {"Z": case["Z"], "aMix": case["aMixPaM6PerMol2"],
                           "bMix": case["bMixM3PerMol"],
                           "dimensionlessA": case["dimensionlessA"],
                           "dimensionlessB": case["dimensionlessB"],
                           "lnPhi": ts_comp["lnPhi"], "phi": ts_comp["phi"],
                           "fugacityPa": ts_comp["fugacityPa"]},
            "coolprop_comparison": {}, "mpmath": {}, "pass": True,
        }

        # --- CoolProp: классификация результата и сверка rtol 2e-4 ---
        # Конечность каждого значения проверяется ДО вычисления ошибок:
        # NaN/±Infinity не сравниваются относительно (NaN > rtol ложно и
        # ранее маскировал провал сверки: точка ошибочно объявлялась ok).
        if coolprop_exception is None:
            for name, ts_value, cp_value in (
                    ("Z", case["Z"], coolprop_vals["Z"]),
                    ("phi", ts_comp["phi"], coolprop_vals["phi"]),
                    ("fugacity", ts_comp["fugacityPa"], coolprop_vals["fugacity"])):
                entry["coolprop_comparison"][name] = compare_coolprop_field(
                    ts_value, cp_value, RTOL_COOLPROP)
            nonfinite_fields = [
                name for name, field in entry["coolprop_comparison"].items()
                if field["status"] == COOLPROP_STATUS_UNAVAILABLE_NONFINITE]
            if nonfinite_fields:
                observed = ", ".join(
                    f"{name}={observed_token(coolprop_vals[name])}"
                    for name in nonfinite_fields)
                # Внутреннюю причину поведения CoolProp НЕ выдумываем:
                # библиотека не сообщила исключение — фиксируется ТОЧНО
                # наблюдаемое состояние (какие вызовы вернули не-конечное
                # значение после успешного update(PT) с specify_phase(gas)).
                field_sources = {"Z": "keyed_output(CP.iZ) или P/(rhomolar*R*T)",
                                 "phi": "fugacity_coefficient(0)",
                                 "fugacity": "fugacity(0)"}
                coolprop_vals["error"] = (
                    f"non-finite output без исключения: {observed} "
                    f"(после успешного update(PT) с specify_phase(gas)); "
                    f"сравнение этих полей недоступно и НЕ засчитывается "
                    f"как PASS")
                coolprop_vals["observed_state"] = (
                    "update(PT) с specify_phase(gas) выполнен без "
                    "исключения; "
                    + "; ".join(
                        f"{field_sources[name]} -> {observed_token(coolprop_vals[name])}"
                        for name in nonfinite_fields)
                    + " — причина библиотекой НЕ сообщена (не исключение), "
                    "внутренний механизм не реконструируется")
                # Частичные конечные результаты сохраняются: конечное
                # поле имеет собственный PASS в coolprop_comparison.
                normalize_coolprop_vals(coolprop_vals)
        coolprop_status = zero_limit_coolprop_status(
            coolprop_exception, entry["coolprop_comparison"])
        entry["coolprop_status"] = coolprop_status

        # --- mpmath: точный предел при точных binary64-входах ---
        calc = pr_mixture_mpmath(case["temperatureK"], case["pressurePa"],
                                comp_ids, fractions, {}, R_TS,
                                omega_a_rounded, omega_b_rounded)
        physical = calc["physical"]
        mp_entry = {"dps": MPMATH_DPS, "comparison": {}, "pass": True}
        if not physical:
            mp_entry["error"] = "нет физических корней"
            mp_entry["pass"] = False
        else:
            z_sel = physical[-1]  # vapor — наибольший физический корень
            lnphi_mp = calc["lnphi_i"](0, z_sel)
            phi_mp = float(mp.exp(lnphi_mp))
            fugacity_mp = phi_mp * case["pressurePa"]
            for name, ts_value, mp_value in (
                    ("Z", case["Z"], float(z_sel)),
                    ("lnPhi", ts_comp["lnPhi"], float(lnphi_mp)),
                    ("phi", ts_comp["phi"], phi_mp),
                    ("fugacity", ts_comp["fugacityPa"], fugacity_mp)):
                abs_err = abs(mp_value - ts_value)
                rel_err = abs_err / abs(ts_value)
                mp_entry["comparison"][name] = {
                    "abs": abs_err, "rel": rel_err,
                    "tolerance": RTOL_MPMATH,
                    "pass": rel_err <= RTOL_MPMATH}
                if rel_err > RTOL_MPMATH:
                    mp_entry["pass"] = False
            # a_mix: АБСОЛЮТНАЯ близость (точный alpha — тот же порядок
            # величины, что артефакт округления binary64; относительная
            # сверка невозможна и НЕ требуется — проверяется предельная
            # форма, а не точное значение крошечного a_mix).
            a_mix_mp = float(calc["a_mix"])
            mp_entry["a_mix_mp"] = a_mix_mp
            mp_entry["a_mix_ts"] = case["aMixPaM6PerMol2"]
            mp_entry["a_mix_abs_diff"] = abs(a_mix_mp - case["aMixPaM6PerMol2"])
            mp_entry["a_mix_abs_tolerance"] = ZERO_LIMIT_AMIX_ATOL
            mp_entry["a_mix_semantics"] = (
                "точный alpha нулю не равен (артефакт округления "
                "binary64); сверка АБСОЛЮТНАЯ: |mp a_mix − ts a_mix| <= "
                "1e-30")
            if mp_entry["a_mix_abs_diff"] > ZERO_LIMIT_AMIX_ATOL:
                mp_entry["pass"] = False
        entry["mpmath"] = mp_entry
        # Итоговый вердикт точки: mpmath (главный оракул) обязан пройти;
        # конечное, но неверное значение CoolProp проваливает точку;
        # не-конечный результат/исключение CoolProp — зарегистрированная
        # недоступность сравнения (НЕ PASS и НЕ провал).
        entry["pass"] = zero_limit_point_verdict(mp_entry["pass"], coolprop_status)
        zero_limit_points.append(entry)

    zero_limit_pass = all(p["pass"] for p in zero_limit_points)
    zero_limit_mpmath_pass = all(p["mpmath"]["pass"] for p in zero_limit_points)
    zero_limit_available = mixtures_data is not None and bool(zero_limit_cases)

    # ============================================
    # Итоги
    # ============================================
    coolprop_pass = all(p["pass"] for p in points)
    mpmath_pass = all(p["pass"] for p in mpmath_points)
    boundary_pass = all(p["pass"] for p in boundary)
    mixture_coolprop_pass = all(p["pass"] for p in mixture_coolprop_points)
    mixture_mpmath_pass = all(p["pass"] for p in mixture_mpmath_points)
    all_pass = (coolprop_pass and mpmath_pass and boundary_pass
                and mixture_coolprop_pass and mixture_mpmath_pass
                and zero_limit_pass
                and add_error is None)

    report = {
        "stage": "4.4.4.2.2 + 4.4.4.3 (смеси)",
        "coolprop": coolprop_meta,
        "builtin_pr_parameters": builtin_parameters,
        "custom_fluids": custom_fluids,
        "points": points,
        "mpmath_independent": mpmath_points,
        "omega_probe": omega_probe,
        "boundary": boundary,
        "mixtures": {
            "stage": "4.4.4.3",
            "available": mixtures_data is not None,
            "coolprop_points": mixture_coolprop_points,
            "mpmath_independent": mixture_mpmath_points,
            "semantics": ("CoolProp получает каталожные kij через "
                          "set_binary_interaction_double (собственных значений "
                          "kij в CoolProp PR нет): сверка ВАЛИДИРУЕТ "
                          "РЕАЛИЗАЦИЮ правил смешения/кубики/phi_i, а НЕ "
                          "подтверждает значения kij — они остаются "
                          "PARTIALLY_VERIFIED по provenance каталога. "
                          "Фаза CoolProp навязана по математической ветви "
                          "TS (gas для vapor): flash/фазовое равновесие "
                          "в объём 4.4.4.3 НЕ входят. Точка n2-h2o — "
                          "НЕ проверка растворимости N2 в воде: "
                          "постоянный (температурно-независимый) BIP "
                          "классического PR качественно НЕ воспроизводит "
                          "константы Генри газов (H2, N2, O2, Ar) в воде "
                          "(Köster, Thol & Vrabec 2018, Supplementary "
                          "Section 4)"),
        },
        "zeroAttractionLimit": {
            "stage": "4.4.4.3.1",
            "available": zero_limit_available,
            "points": zero_limit_points,
            "semantics": ("точный нулевой предел a_mix (alpha = 0 РОВНО в "
                          "binary64 для N2 при T = 1388.2195230363366 K): "
                          "ln(phi_i) предельной формой (b_i/b_mix)(Z-1) - "
                          "ln(Z-B_mix); вырожденная компенсация (a_mix = 0 "
                          "при ненулевых a_i) — отказ "
                          "degenerate_attraction_limit; epsilon-порог НЕ "
                          "вводится. Главный оракул предела — mpmath с "
                          "точными binary64-входами (в точной арифметике "
                          "alpha нулю не равен; сходимость Z/ln(phi)/phi/f "
                          "подтверждает предельную форму; a_mix — "
                          "АБСОЛЮТНАЯ сверка <= 1e-30). CoolProp — та же "
                          "ветвь gas; отказ CoolProp фиксируется с "
                          "причиной и НЕ подменяется собственным расчётом"),
            "coolprop_semantics": (
                "статус CoolProp классифицируется ЯВНО и указывается "
                "РАЗДЕЛЬНО от PASS mpmath: available_pass — все значения "
                "конечны и в допуске 2e-4; available_fail — конечное "
                "значение вне допуска (провал benchmark); "
                "unavailable_nonfinite — CoolProp вернул NaN/±Infinity "
                "(конечность проверяется ДО вычисления ошибок: NaN > rtol "
                "ложно и ранее маскировал провал; частичные конечные "
                "результаты сохраняют собственный PASS; причина "
                "библиотекой не сообщена — фиксируется наблюдаемое "
                "состояние, внутренний механизм НЕ реконструируется); "
                "unavailable_error — исключение CoolProp. Не-конечное "
                "значение и исключение НЕ засчитываются как CoolProp "
                "PASS; проверкой предельного случая остаётся mpmath"),
        },
        "tolerances": {
            "coolprop_rtol": RTOL_COOLPROP,
            "coolprop_rtol_justification": (
                "CoolProp вычисляет Ω аналитически (точные значения), наша "
                "реализация использует textbook 0.45724/0.0778; расхождение "
                "параметров ~5e-5 отн. по b. Допуск ужесточён с 1e-3 до 2e-4: "
                "максимальная наблюдённая rel-ошибка прогона ~9.8e-5 (запас "
                "~2x); фактические ошибки — в comparison"),
            "mpmath_rtol": RTOL_MPMATH,
            "mpmath_dps": MPMATH_DPS,
            "boundary_atol_isolated": ATOL_ISOLATED_ROOT,
            "boundary_atol_near_pair": ATOL_NEAR_PAIR_ROOT,
            "boundary_ts_dedup_mirror": (
                "1e-8*max(1, |z|, B) — зеркало допуска дедупликации "
                "TS-решателя (Core/pengRobinson.ts): структурный отказ TS "
                "при доказанных mpmath ТРЁХ корнях обоснован, если "
                "расщепление пары меньше этого зеркала (пара неразличима "
                "в double); статус фиксируется явно (solver_failure), "
                "молчаливый PASS запрещён"),
        },
        "summary": {
            "coolprop": coolprop_pass,
            "mpmath": mpmath_pass,
            "boundary": boundary_pass,
            "mixtures_available": mixtures_data is not None,
            "mixtures_coolprop": mixture_coolprop_pass,
            "mixtures_mpmath": mixture_mpmath_pass,
            "zero_attraction_limit": zero_limit_pass,
            "zero_attraction_limit_available": zero_limit_available,
            "zero_attraction_limit_mpmath": zero_limit_mpmath_pass,
            "zero_attraction_limit_coolprop": {
                p["id"]: p["coolprop_status"] for p in zero_limit_points},
            "all": all_pass,
        },
    }

    # СТРОГИЙ JSON: нормализация NaN/±Infinity -> null (страховка поверх
    # посекционной нормализации) и allow_nan=False — невалидные
    # JSON-значения NaN/Infinity в отчёте невозможны.
    report, nonfinite_replaced = make_json_safe(report)
    if nonfinite_replaced:
        print("ВНИМАНИЕ: нормализованы не-конечные значения, пропущенные "
              f"посекционной нормализацией: {nonfinite_replaced}", file=sys.stderr)

    report_path = Path(args.report)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    with report_path.open("w", encoding="utf-8") as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2, allow_nan=False)
        handle.write("\n")

    # Полный отчёт — в stdout (логи GitHub Actions), чтобы числа были
    # доступны без скачивания артефактов.
    print(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False))

    # Markdown-итог для $GITHUB_STEP_SUMMARY.
    summary_md = build_summary_md(report)
    summary_path = Path(args.summary_md)
    summary_path.parent.mkdir(parents=True, exist_ok=True)
    summary_path.write_text(summary_md, encoding="utf-8")

    # Аннотации GitHub (видны без входа в аккаунт).
    verdict = "PASS" if all_pass else "FAIL"
    cp_pts = ", ".join(
        f"{p['id']}={'ok' if p['pass'] else 'FAIL'}" for p in points)
    justified_refusals = sum(
        1 for e in boundary
        if e.get("ts_status") == "solver_failure" and e["pass"])
    mix_pts = ", ".join(
        f"{p['id']}={'ok' if p['pass'] else 'FAIL'}"
        for p in mixture_coolprop_points)
    zl_pts = ", ".join(
        f"{p['id']}: mpmath={'ok' if p['mpmath']['pass'] else 'FAIL'}, "
        f"CoolProp={p['coolprop_status']}"
        + (f" (non-finite: {', '.join(p['coolprop']['nonfinite_fields'])}; "
           f"конечные поля сохраняют собственный PASS)"
           if p["coolprop"].get("nonfinite_fields") else "")
        + (" (исключение; причина в отчёте)"
           if p["coolprop_status"] == COOLPROP_STATUS_UNAVAILABLE_ERROR else "")
        for p in zero_limit_points)
    print(f"::notice title=Peng-Robinson benchmark::{verdict} "
          f"(CoolProp {coolprop_meta['version']}): точки [{cp_pts}]; "
          f"mpmath={'ok' if mpmath_pass else 'FAIL'}; "
          f"boundary={'ok' if boundary_pass else 'FAIL'}; "
          f"смеси [{mix_pts}] "
          f"CoolProp={'ok' if mixture_coolprop_pass else 'FAIL'}, "
          f"mpmath={'ok' if mixture_mpmath_pass else 'FAIL'} "
          f"(валидация реализации, kij из каталога); "
          f"нулевой предел a_mix [{zl_pts}] "
          f"mpmath={'ok' if zero_limit_mpmath_pass else 'FAIL'} "
          f"(главный оракул предела; статусы CoolProp указаны раздельно "
          f"и НЕ засчитываются как PASS при non-finite/исключении); "
          f"solver_failures_justified={justified_refusals}")
    if not all_pass:
        for point in points:
            if not point["pass"]:
                detail = point["coolprop"]["error"] or json.dumps(
                    point["comparison"], ensure_ascii=False)
                print(f"::error title=Peng-Robinson benchmark {point['id']}::{detail}")
        for entry in mpmath_points:
            if not entry["pass"]:
                print(f"::error title=Peng-Robinson mpmath {entry['id']}::"
                       f"{json.dumps(entry, ensure_ascii=False)[:800]}")
        for entry in boundary:
            if not entry["pass"]:
                print(f"::error title=Peng-Robinson boundary {entry['label']}::"
                       f"{json.dumps(entry, ensure_ascii=False)[:800]}")
        for point in mixture_coolprop_points:
            if not point["pass"]:
                detail = point["coolprop"]["error"] or json.dumps(
                    point["comparison"], ensure_ascii=False)
                print(f"::error title=Peng-Robinson mixture {point['id']}::{detail}")
        for entry in mixture_mpmath_points:
            if not entry["pass"]:
                print(f"::error title=Peng-Robinson mixture mpmath {entry['id']}::"
                       f"{json.dumps(entry, ensure_ascii=False)[:800]}")
        for entry in zero_limit_points:
            if not entry["pass"]:
                print(f"::error title=Peng-Robinson zero-limit {entry['id']}::"
                       f"{json.dumps(entry, ensure_ascii=False)[:800]}")

    print(f"\nИТОГ Stage 4.4.4.2.2/4.4.4.3/4.4.4.3.1 benchmark: {'ПРОЙДЕН' if all_pass else 'ПРОВАЛЕН'}")
    return 0 if all_pass else 1


def match_root_lists(ts_roots, mp_roots):
    """Попарное сравнение отсортированных корней TS и mpmath."""
    if len(ts_roots) != len(mp_roots):
        return {"pass": False,
                "error": f"разное число корней: ts={len(ts_roots)}, mp={len(mp_roots)}"}
    pairs = []
    passed = True
    for ts_z, mp_z in zip(ts_roots, mp_roots):
        atol = ATOL_NEAR_PAIR_ROOT if has_near_neighbor(ts_z, ts_roots) else ATOL_ISOLATED_ROOT
        err = abs(ts_z - mp_z)
        ok = err <= atol
        passed = passed and ok
        pairs.append({"ts": ts_z, "mp": mp_z, "atol": atol, "abs_err": err, "pass": ok})
    return {"pairs": pairs, "pass": passed}


def has_near_neighbor(z, roots):
    return any(other is not z and abs(z - other) < NEAR_PAIR_SPLIT
               for other in roots)


def build_summary_md(report):
    cp = report["coolprop"]
    gitrev = (f"`{cp['gitrevision']}`" if cp.get("gitrevision")
              else "не экспортируется (null)")
    lines = [
        "# Stage 4.4.4.2.2/4.4.4.3 — Peng-Robinson benchmark (чистые + смеси)",
        "",
        f"CoolProp `{cp['version']}` (gitrev {gitrev}), backend `PR`; "
        f"mpmath `{cp.get('mpmath_version')}` ({MPMATH_DPS} знаков).",
        "",
        "## Контрольные точки (CoolProp vs TS, rtol 2e-4)",
        "",
        "| точка | ветвь | Z (rel) | phi (rel) | f (rel) | итог |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    for point in report["points"]:
        if point["coolprop"]["error"] is not None:
            lines.append(f"| {point['id']} | {point['root']} | ошибка | ошибка | ошибка | FAIL |")
            continue
        comp = point["comparison"]
        def rel(name):
            value = comp.get(name)
            if not isinstance(value, dict) or "rel" not in value:
                return "—"
            return f"{value['rel']:.2e}"
        lines.append(
            f"| {point['id']} | {point['root']} | {rel('Z')} | {rel('phi')} | "
            f"{rel('fugacity')} | {'ok' if point['pass'] else 'FAIL'} |")
    lines += [
        "",
        "## mpmath (50 знаков, наши константы) vs TS, rtol 5e-13",
        "",
        "| точка | Z (rel) | phi (rel) | f (rel) | итог |",
        "| --- | --- | --- | --- | --- |",
    ]
    for entry in report["mpmath_independent"]:
        comp = entry.get("comparison", {})
        def rel2(name):
            value = comp.get(name)
            return "—" if value is None else f"{value['rel']:.2e}"
        lines.append(f"| {entry['id']} | {rel2('Z')} | {rel2('phi')} | "
                     f"{rel2('fugacity')} | {'ok' if entry['pass'] else 'FAIL'} |")
    lines += [
        "",
        "## Граница нулевого дискриминанта (mpmath vs TS)",
        "",
        "| случай | mp корней | TS корней | статус TS | disc (отн.) | знак disc | итог |",
        "| --- | --- | --- | --- | --- | --- | --- |",
    ]
    for entry in report["boundary"]:
        lines.append(
            f"| {entry['label']} | {entry['mp_real_root_count']} | {entry['ts_root_count']} "
            f"| {entry.get('ts_status', 'ok')} | {entry['disc_rel']:.2e} | {entry['disc_sign']} "
            f"| {'ok' if entry['pass'] else 'FAIL'} |")
    if report.get("mixtures", {}).get("available"):
        lines += [
            "",
            "## Смеси 4.4.4.3: CoolProp PR (те же каталожные kij) vs TS, rtol 2e-4",
            "",
            "Валидация РЕАЛИЗАЦИИ при одинаковых kij "
            "(set_binary_interaction_double); НЕ подтверждение значений kij.",
            "",
            "| смесь | ветвь | Z (rel) | max phi_i (rel) | итог |",
            "| --- | --- | --- | --- | --- |",
        ]
        for point in report["mixtures"]["coolprop_points"]:
            if point["coolprop"]["error"] is not None:
                lines.append(f"| {point['id']} | {point['root']} | ошибка | ошибка | FAIL |")
                continue
            comp = point["comparison"]
            z_value = comp.get("Z")
            z_rel = z_value.get("rel") if isinstance(z_value, dict) else None
            phi_rels = [c["phi"]["rel"] for c in comp["components"]
                        if isinstance(c.get("phi"), dict) and "rel" in c["phi"]]
            max_phi = max(phi_rels) if phi_rels else None
            lines.append(
                f"| {point['id']} | {point['root']} | "
                f"{'—' if z_rel is None else f'{z_rel:.2e}'} | "
                f"{'—' if max_phi is None else f'{max_phi:.2e}'} | "
                f"{'ok' if point['pass'] else 'FAIL'} |")
        lines += [
            "",
            "## Смеси 4.4.4.3: mpmath (50 знаков, наши константы) vs TS, rtol 5e-13",
            "",
            "| смесь | Z (rel) | a_mix (rel) | b_mix (rel) | max phi_i (rel) | итог |",
            "| --- | --- | --- | --- | --- | --- |",
        ]
        for entry in report["mixtures"]["mpmath_independent"]:
            comp = entry.get("comparison", {})
            def mrel(table, name):
                value = table.get(name)
                return "—" if value is None else f"{value['rel']:.2e}"
            phi_rels = [c["comparison"]["phi"]["rel"]
                        for c in entry.get("components", [])
                        if c.get("comparison", {}).get("phi")]
            max_phi = max(phi_rels) if phi_rels else None
            lines.append(
                f"| {entry['id']} | {mrel(comp, 'Z')} | {mrel(comp, 'aMix')} "
                f"| {mrel(comp, 'bMix')} | "
                f"{'—' if max_phi is None else f'{max_phi:.2e}'} | "
                f"{'ok' if entry['pass'] else 'FAIL'} |")
    if report.get("zeroAttractionLimit", {}).get("available"):
        lines += [
            "",
            "## Точный нулевой предел a_mix (4.4.4.3.1)",
            "",
            "alpha = 0 РОВНО в binary64 (N2, T = 1388.2195230363366 K): "
            "ln(phi_i) предельной формой (b_i/b_mix)(Z-1) - ln(Z-B_mix); "
            "главный оракул предела — mpmath с точными binary64-входами "
            "(rtol 5e-13); a_mix — АБСОЛЮТНАЯ сверка <= 1e-30. CoolProp — "
            "та же ветвь gas (rtol 2e-4): статус указывается РАЗДЕЛЬНО "
            "от mpmath; не-конечные значения CoolProp (NaN/±Infinity) — "
            "unavailable_nonfinite: сравнение недоступно и НЕ "
            "засчитывается как PASS (частичные конечные результаты "
            "сохраняют собственный PASS); конечное, но неверное "
            "значение проваливает benchmark; причина non-finite "
            "возвращения библиотекой не сообщена — фиксируется "
            "наблюдаемое состояние без догадки о внутреннем механизме.",
            "",
            "| точка | mpmath Z (rel) | mpmath phi (rel) | mpmath f (rel) "
            "| |mp a_mix − ts a_mix| | mpmath | CoolProp | итог |",
            "| --- | --- | --- | --- | --- | --- | --- | --- |",
        ]
        for entry in report["zeroAttractionLimit"]["points"]:
            mpm = entry.get("mpmath", {})
            comp = mpm.get("comparison", {})
            def zrel(name):
                value = comp.get(name)
                if not isinstance(value, dict) or "rel" not in value:
                    return "—"
                return f"{value['rel']:.2e}"
            adiff = mpm.get("a_mix_abs_diff")
            status = entry.get("coolprop_status", "—")
            cp_comp = entry.get("coolprop_comparison", {})
            if status == "available_pass":
                cp_state = "available_pass"
            elif status == "available_fail":
                cp_state = "available_fail (конечное значение вне допуска)"
            elif status == "unavailable_nonfinite":
                finite_ok = [name for name, field in cp_comp.items()
                             if field.get("pass") is True]
                nonfinite = ", ".join(entry["coolprop"].get("nonfinite_fields", []))
                cp_state = (f"unavailable_nonfinite (ок: "
                            f"{', '.join(finite_ok) if finite_ok else '—'}; "
                            f"non-finite: {nonfinite})")
            elif status == "unavailable_error":
                cp_state = "unavailable_error (причина в отчёте)"
            else:
                cp_state = "—"
            lines.append(
                f"| {entry['id']} | {zrel('Z')} | {zrel('phi')} | "
                f"{zrel('fugacity')} | "
                f"{'—' if adiff is None else f'{adiff:.2e}'} | "
                f"{'ok' if mpm.get('pass') else 'FAIL'} | {cp_state} | "
                f"{'ok' if entry['pass'] else 'FAIL'} |")
    verdict = "PASS" if report["summary"]["all"] else "FAIL"
    zl_coolprop_md = ", ".join(
        f"{key}={value}"
        for key, value in report["summary"]
        .get("zero_attraction_limit_coolprop", {}).items()) or "—"
    lines += [
        "",
        f"**Итог: {verdict}** (CoolProp: {'ok' if report['summary']['coolprop'] else 'FAIL'}; "
        f"mpmath: {'ok' if report['summary']['mpmath'] else 'FAIL'}; "
        f"boundary: {'ok' if report['summary']['boundary'] else 'FAIL'}; "
        f"смеси CoolProp: {'ok' if report['summary']['mixtures_coolprop'] else 'FAIL'}; "
        f"смеси mpmath: {'ok' if report['summary']['mixtures_mpmath'] else 'FAIL'}; "
        f"нулевой предел a_mix: {'ok' if report['summary']['zero_attraction_limit'] else 'FAIL'} "
        f"(mpmath: {'ok' if report['summary']['zero_attraction_limit_mpmath'] else 'FAIL'}; "
        f"CoolProp по точкам: {zl_coolprop_md}))",
        "",
    ]
    return "\n".join(lines)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except BaseException:  # noqa: BLE001 — диагностика крэша в аннотации
        import traceback
        tb = traceback.format_exc()
        safe = tb.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")[:3500]
        print(f"::error title=Peng-Robinson benchmark CRASH::{safe}", flush=True)
        print(tb, file=sys.stderr, flush=True)
        sys.exit(3)

