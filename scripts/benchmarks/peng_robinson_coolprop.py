#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Stage 4.4.4.2.1 — независимый benchmark чистокомпонентного Peng–Robinson.

Оракулы (оба НЕ зависят от TypeScript-реализации):

1. CoolProp 8.0.0, backend 'PR' (НЕ HEOS): Z, phi, фугитивность на семи
   контрольных точках Stage 4.4.4.2. Чтобы гарантировать СОВПАДЕНИЕ
   входных параметров (Tc, pc, omega) с каталогом Stage 4.4.4.1, флюиды
   регистрируются в CoolProp через add_fluids_as_JSON с точными
   значениями каталога (EVWCO2/EVWN2/EVWCH4/EVWH2O/EVWAR); встроенные
   флюиды PR опрашиваются отдельно и фиксируются в отчёте, но для
   сравнения НЕ используются (никаких молчаливых замен параметров).
   Допуск: rtol 1e-3 — CoolProp вычисляет Ω_a/Ω_b аналитически
   (точные значения), тогда как наша реализация использует округлённые
   константы 0.45724/0.0778 textbook; фактические расхождения
   записываются в отчёт.

2. mpmath (50 значащих цифр): независимая ре-реализация классического
   PR (1976) с НАШИМИ округлёнными константами и решением кубики по
   Кардано в высокой точности. Допуск rtol 5e-13 — это ГЛАВНАЯ
   проверка самой реализации (сходится до предела двойной точности).

3. Граничный оракул: сетка A0±delta около двойного корня кубики
   (B = 0.01980480623881198) пересчитывается в mpmath по тем же
   значениям A, что использовала TS-реализация (значения A читаются
   из дампа); сравниваются число действительных корней и их значения.
   Случай A0 (полоса кратного корня, TS даёт 2 корня при
   математически одном + комплексной паре) — документированное
   поведение, проверяется отдельными критериями.

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
import json
import sys
from pathlib import Path

MPMATH_DPS = 50
RTOL_COOLPROP = 1e-3   # Ω: exact (CoolProp) против округлённых 0.45724/0.0778 (наша)
RTOL_MPMATH = 5e-13    # проверка реализации против 50-значной арифметики
BAND_REL_DISC_LIMIT = 1e-15  # «полоса кратного корня»: |disc|/scale ниже шума double
ATOL_ISOLATED_ROOT = 1e-9    # изолированный корень: двойная точность решателя
ATOL_NEAR_PAIR_ROOT = 1e-6  # корень вблизи кратного: обусловленность ~ sqrt(eps)
NEAR_PAIR_SPLIT = 1e-4      # порог «пары» (расщепление меньше — кластер)

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


def main() -> int:
    parser = argparse.ArgumentParser(description="CoolProp PR benchmark (Stage 4.4.4.2.1)")
    parser.add_argument("--dump", default="benchmark-artifacts/peng-robinson-ts-dump.json",
                        help="путь к TS-дампу контрольных точек")
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
    coolprop_meta["version"] = str(getattr(CP, "__version__", None))
    coolprop_meta["gitrevision"] = str(getattr(CP, "__gitrevision__", None))
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
            abs_err = abs(cp_value - ts_value)
            rel_err = abs_err / abs(ts_value)
            comparisons[name] = {"abs": abs_err, "rel": rel_err,
                                 "tolerance": RTOL_COOLPROP,
                                 "pass": rel_err <= RTOL_COOLPROP}
            if rel_err > RTOL_COOLPROP:
                point_pass = False

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
    R_TS = mpf(str(dump["universalGasConstantJPerMolK"]))
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
    # Граничный оракул: A0±delta против TS
    # ============================================
    boundary = []
    for case in dump.get("boundary", {}).get("cases", []):
        A = mpf(str(case["A"]))
        B = mpf(str(case["B"]))
        c2 = -(1 - B)
        c1 = A - 3 * B * B - 2 * B
        c0 = -(A * B - B * B - B * B * B)
        real, pair_center, disc, disc_scale = cubic_real_roots_mp(c2, c1, c0)
        rel_disc = float(abs(disc) / disc_scale) if disc_scale != 0 else 0.0
        ts_roots = case["roots"]
        entry = {"label": case["label"], "A": case["A"], "B": case["B"],
                 "mp_real_root_count": len(real),
                 "mp_real_roots": [nstr(z, 20) for z in sorted(real)],
                 "mp_complex_pair_center": (nstr(pair_center, 20)
                                             if pair_center is not None else None),
                 "disc_sign": ("positive" if disc > 0 else "negative" if disc < 0 else "zero"),
                 "disc_rel": rel_disc,
                 "ts_root_count": len(ts_roots), "ts_roots": ts_roots,
                 "documented_band_behavior": False, "match": None, "pass": False}
        if len(real) == len(ts_roots):
            match = match_root_lists(ts_roots, [float(z) for z in sorted(real)])
        elif len(real) == 1 and len(ts_roots) == 2 and pair_center is not None:
            # Полоса кратного корня: математически один корень + комплексная
            # пара; TS-решатель возвращает ДВА различимых корня (документировано
            # в 4.4.4.2.1). Проверяем: (1) знак дискриминанта ниже шума double,
            # (2) изолированный TS-корень = mp-корню, (3) второй TS-корень =
            # центру комплексной пары.
            isolated_ok = abs(ts_roots[1] - float(real[0])) <= ATOL_ISOLATED_ROOT
            band_ok = abs(ts_roots[0] - float(pair_center)) <= ATOL_NEAR_PAIR_ROOT
            entry["documented_band_behavior"] = True
            match = {
                "isolated_root_atol": abs(ts_roots[1] - float(real[0])),
                "band_root_vs_pair_center_atol": abs(ts_roots[0] - float(pair_center)),
                "isolated_pass": isolated_ok, "band_pass": band_ok,
                "rel_disc_below_double_noise": rel_disc < BAND_REL_DISC_LIMIT,
            }
            entry["pass"] = bool(isolated_ok and band_ok
                                 and rel_disc < BAND_REL_DISC_LIMIT)
            boundary.append(entry)
            continue
        else:
            entry["match"] = {"error": (f"несогласованное число корней: mp={len(real)}, "
                                        f"ts={len(ts_roots)}")}
            boundary.append(entry)
            continue
        entry["match"] = match
        entry["pass"] = bool(match["pass"])
        boundary.append(entry)

    # ============================================
    # Итоги
    # ============================================
    coolprop_pass = all(p["pass"] for p in points)
    mpmath_pass = all(p["pass"] for p in mpmath_points)
    boundary_pass = all(p["pass"] for p in boundary)
    all_pass = coolprop_pass and mpmath_pass and boundary_pass and add_error is None

    report = {
        "stage": "4.4.4.2.1",
        "coolprop": coolprop_meta,
        "builtin_pr_parameters": builtin_parameters,
        "custom_fluids": custom_fluids,
        "points": points,
        "mpmath_independent": mpmath_points,
        "omega_probe": omega_probe,
        "boundary": boundary,
        "tolerances": {
            "coolprop_rtol": RTOL_COOLPROP,
            "coolprop_rtol_justification": (
                "CoolProp вычисляет Ω аналитически (точные значения), наша "
                "реализация использует textbook 0.45724/0.0778; расхождение "
                "параметров ~5e-5 отн. по b; фактические ошибки — в comparison"),
            "mpmath_rtol": RTOL_MPMATH,
            "mpmath_dps": MPMATH_DPS,
            "boundary_atol_isolated": ATOL_ISOLATED_ROOT,
            "boundary_atol_near_pair": ATOL_NEAR_PAIR_ROOT,
        },
        "summary": {
            "coolprop": coolprop_pass,
            "mpmath": mpmath_pass,
            "boundary": boundary_pass,
            "all": all_pass,
        },
    }

    report_path = Path(args.report)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    with report_path.open("w", encoding="utf-8") as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2)
        handle.write("\n")

    # Полный отчёт — в stdout (логи GitHub Actions), чтобы числа были
    # доступны без скачивания артефактов.
    print(json.dumps(report, ensure_ascii=False, indent=2))

    # Markdown-итог для $GITHUB_STEP_SUMMARY.
    summary_md = build_summary_md(report)
    summary_path = Path(args.summary_md)
    summary_path.parent.mkdir(parents=True, exist_ok=True)
    summary_path.write_text(summary_md, encoding="utf-8")

    # Аннотации GitHub (видны без входа в аккаунт).
    verdict = "PASS" if all_pass else "FAIL"
    cp_pts = ", ".join(
        f"{p['id']}={'ok' if p['pass'] else 'FAIL'}" for p in points)
    print(f"::notice title=Peng-Robinson benchmark::{verdict} "
          f"(CoolProp {coolprop_meta['version']}): точки [{cp_pts}]; "
          f"mpmath={'ok' if mpmath_pass else 'FAIL'}; "
          f"boundary={'ok' if boundary_pass else 'FAIL'}")
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

    print(f"\nИТОГ Stage 4.4.4.2.1 benchmark: {'ПРОЙДЕН' if all_pass else 'ПРОВАЛЕН'}")
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
    lines = [
        "# Stage 4.4.4.2.1 — Peng-Robinson benchmark",
        "",
        f"CoolProp `{report['coolprop']['version']}` (gitrev "
        f"`{report['coolprop']['gitrevision']}`), backend `PR`; "
        f"mpmath {MPMATH_DPS} знаков.",
        "",
        "## Контрольные точки (CoolProp vs TS, rtol 1e-3)",
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
            return "—" if value is None else f"{value['rel']:.2e}"
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
        "## Граница кратного корня (mpmath vs TS)",
        "",
        "| случай | mp корней | TS корней | disc (отн.) | поведение | итог |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    for entry in report["boundary"]:
        lines.append(
            f"| {entry['label']} | {entry['mp_real_root_count']} | {entry['ts_root_count']} "
            f"| {entry['disc_rel']:.2e} "
            f"| {'полоса (документировано)' if entry['documented_band_behavior'] else '—'} "
            f"| {'ok' if entry['pass'] else 'FAIL'} |")
    verdict = "PASS" if report["summary"]["all"] else "FAIL"
    lines += [
        "",
        f"**Итог: {verdict}** (CoolProp: {'ok' if report['summary']['coolprop'] else 'FAIL'}; "
        f"mpmath: {'ok' if report['summary']['mpmath'] else 'FAIL'}; "
        f"boundary: {'ok' if report['summary']['boundary'] else 'FAIL'})",
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
