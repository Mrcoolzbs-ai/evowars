#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Unit-тесты классификации результатов CoolProp-оракула (benchmark integrity).

Stage 4.4.4.3.1: не-конечные значения CoolProp (NaN/±Infinity) НЕ могут
маскироваться как PASS (сравнение NaN > rtol ложно), НЕ сериализуются
в JSON как NaN/Infinity и фиксируются с явным статусом
unavailable_nonfinite. Импорт модуля НЕ требует CoolProp/mpmath:
тестируются чистые функции классификации. Запуск (CI, workflow
peng-robinson-benchmark.yml): python -m unittest discover
-s scripts/benchmarks -p "test_*.py" -v
"""
import json
import math
import unittest

import peng_robinson_coolprop as prb


class CompareCoolPropFieldTests(unittest.TestCase):
    """compare_coolprop_field: конечность ДО вычисления ошибок."""

    RTOL = prb.RTOL_COOLPROP

    def test_finite_within_tolerance_pass(self):
        field = prb.compare_coolprop_field(1.0, 1.0 + 1e-5, self.RTOL)
        self.assertEqual(field["status"], prb.COOLPROP_STATUS_AVAILABLE)
        self.assertIs(field["pass"], True)
        self.assertIn("rel", field)
        self.assertLessEqual(field["rel"], self.RTOL)

    def test_finite_out_of_tolerance_fail(self):
        field = prb.compare_coolprop_field(1.0, 1.1, self.RTOL)
        self.assertEqual(field["status"], prb.COOLPROP_STATUS_AVAILABLE)
        self.assertIs(field["pass"], False)

    def test_nan_phi_never_pass(self):
        field = prb.compare_coolprop_field(1.002082625437986,
                                           float("nan"), self.RTOL)
        self.assertEqual(field["status"],
                         prb.COOLPROP_STATUS_UNAVAILABLE_NONFINITE)
        self.assertEqual(field["observed"], "NaN")
        self.assertIsNot(field["pass"], True)
        self.assertNotIn("rel", field)

    def test_nan_fugacity_never_pass(self):
        field = prb.compare_coolprop_field(1002082.625437986,
                                           float("nan"), self.RTOL)
        self.assertEqual(field["status"],
                         prb.COOLPROP_STATUS_UNAVAILABLE_NONFINITE)
        self.assertEqual(field["observed"], "NaN")
        self.assertIsNot(field["pass"], True)
        self.assertNotIn("abs", field)

    def test_infinity_z_never_pass(self):
        field = prb.compare_coolprop_field(1.0, float("inf"), self.RTOL)
        self.assertEqual(field["status"],
                         prb.COOLPROP_STATUS_UNAVAILABLE_NONFINITE)
        self.assertEqual(field["observed"], "+Infinity")
        self.assertIsNot(field["pass"], True)

    def test_negative_infinity_never_pass(self):
        field = prb.compare_coolprop_field(1.0, float("-inf"), self.RTOL)
        self.assertEqual(field["observed"], "-Infinity")
        self.assertIsNot(field["pass"], True)

    def test_none_value_is_missing_not_pass(self):
        field = prb.compare_coolprop_field(1.0, None, self.RTOL)
        self.assertEqual(field["status"], "missing")
        self.assertIsNot(field["pass"], True)


class ZeroLimitCoolPropStatusTests(unittest.TestCase):
    """zero_limit_coolprop_status: классификация точки целиком."""

    def _comparisons(self, z_cp, phi_cp, fugacity_cp, ts=(1.0, 1.0, 1.0)):
        return {
            "Z": prb.compare_coolprop_field(ts[0], z_cp, prb.RTOL_COOLPROP),
            "phi": prb.compare_coolprop_field(ts[1], phi_cp, prb.RTOL_COOLPROP),
            "fugacity": prb.compare_coolprop_field(ts[2], fugacity_cp,
                                                   prb.RTOL_COOLPROP),
        }

    def test_all_finite_ok_available_pass(self):
        comps = self._comparisons(1.00001, 1.00002, 1.00003)
        status = prb.zero_limit_coolprop_status(None, comps)
        self.assertEqual(status, prb.COOLPROP_POINT_AVAILABLE_PASS)

    def test_finite_out_of_tolerance_available_fail(self):
        comps = self._comparisons(1.5, 1.00002, 1.00003)
        status = prb.zero_limit_coolprop_status(None, comps)
        self.assertEqual(status, prb.COOLPROP_POINT_AVAILABLE_FAIL)

    def test_exception_unavailable_error(self):
        status = prb.zero_limit_coolprop_status(
            "ValueError: Cubic has three roots", {})
        self.assertEqual(status, prb.COOLPROP_STATUS_UNAVAILABLE_ERROR)

    def test_observed_near_zero_scenario(self):
        """Воспроизведение опубликованного прогона 42116866598:
        Z конечен (в допуске), phi и fugacity — NaN без исключения."""
        ts_z = 1.002082625437986
        cp_z = 1.0020825203404595
        comps = self._comparisons(
            cp_z, float("nan"), float("nan"),
            ts=(ts_z, 1.002085, 1002085.0))
        self.assertIs(comps["Z"]["pass"], True)  # частичный PASS сохранён
        self.assertEqual(comps["phi"]["status"],
                         prb.COOLPROP_STATUS_UNAVAILABLE_NONFINITE)
        self.assertEqual(comps["fugacity"]["status"],
                         prb.COOLPROP_STATUS_UNAVAILABLE_NONFINITE)
        status = prb.zero_limit_coolprop_status(None, comps)
        self.assertEqual(status, prb.COOLPROP_STATUS_UNAVAILABLE_NONFINITE)

    def test_all_nonfinite_unavailable_nonfinite(self):
        comps = self._comparisons(float("nan"), float("nan"), float("nan"))
        status = prb.zero_limit_coolprop_status(None, comps)
        self.assertEqual(status, prb.COOLPROP_STATUS_UNAVAILABLE_NONFINITE)


class ZeroLimitPointVerdictTests(unittest.TestCase):
    """zero_limit_point_verdict: правило итогового PASS точки."""

    def test_mpmath_ok_coolprop_pass(self):
        self.assertTrue(prb.zero_limit_point_verdict(
            True, prb.COOLPROP_POINT_AVAILABLE_PASS))

    def test_mpmath_fail_fails_even_if_coolprop_ok(self):
        self.assertFalse(prb.zero_limit_point_verdict(
            False, prb.COOLPROP_POINT_AVAILABLE_PASS))

    def test_coolprop_finite_wrong_fails_point(self):
        self.assertFalse(prb.zero_limit_point_verdict(
            True, prb.COOLPROP_POINT_AVAILABLE_FAIL))

    def test_coolprop_nonfinite_allowed_but_not_pass(self):
        """Недоступность CoolProp — не провал (главный оракул mpmath),
        но статус unavailable_nonfinite не обозначается как PASS."""
        self.assertTrue(prb.zero_limit_point_verdict(
            True, prb.COOLPROP_STATUS_UNAVAILABLE_NONFINITE))

    def test_coolprop_exception_allowed(self):
        self.assertTrue(prb.zero_limit_point_verdict(
            True, prb.COOLPROP_STATUS_UNAVAILABLE_ERROR))


class NormalizeCoolPropValsTests(unittest.TestCase):
    """normalize_coolprop_vals: NaN/±Infinity -> None (строгий JSON)."""

    def test_nonfinite_values_normalized_to_null(self):
        vals = {"Z": float("inf"), "phi": float("nan"),
                "fugacity": 1.5, "rhomolar": 100.0}
        nonfinite = prb.normalize_coolprop_vals(vals)
        self.assertEqual(sorted(nonfinite), ["Z", "phi"])
        self.assertIsNone(vals["Z"])
        self.assertIsNone(vals["phi"])
        self.assertEqual(vals["fugacity"], 1.5)

    def test_list_fields_normalized_per_element(self):
        vals = {"Z": 1.0, "phi": [0.9, float("nan"), 1.1],
                "fugacity": [9e5, float("-inf"), 1.1e6]}
        nonfinite = prb.normalize_coolprop_vals(vals)
        self.assertEqual(sorted(nonfinite), ["fugacity[1]", "phi[1]"])
        self.assertEqual(vals["phi"], [0.9, None, 1.1])
        self.assertEqual(vals["fugacity"], [9e5, None, 1.1e6])

    def test_all_finite_unchanged(self):
        vals = {"Z": 1.0, "phi": 1.1, "fugacity": 1.2, "rhomolar": 50.0}
        nonfinite = prb.normalize_coolprop_vals(vals)
        self.assertEqual(nonfinite, [])
        self.assertEqual(vals["Z"], 1.0)
        self.assertEqual(vals["phi"], 1.1)


class JsonSafetyTests(unittest.TestCase):
    """make_json_safe + allow_nan=False: в JSON нет NaN/Infinity."""

    def test_nonfinite_normalized_recursively(self):
        report = {"z": float("nan"), "list": [1.0, float("inf"), 2.0],
                  "nested": {"phi": float("-inf"), "ok": 1.5},
                  "text": "строка со словом NaN — валидный JSON"}
        safe, replaced = prb.make_json_safe(report)
        self.assertIsNone(safe["z"])
        self.assertEqual(safe["list"], [1.0, None, 2.0])
        self.assertIsNone(safe["nested"]["phi"])
        self.assertEqual(safe["nested"]["ok"], 1.5)
        self.assertEqual(len(replaced), 3)

    def test_strict_json_roundtrip(self):
        safe, _ = prb.make_json_safe(
            {"z": float("nan"), "phi": float("inf")})
        text = json.dumps(safe, ensure_ascii=False, allow_nan=False)
        self.assertNotIn("NaN", text)
        self.assertNotIn("Infinity", text)
        parsed = json.loads(text)
        self.assertIsNone(parsed["z"])
        self.assertIsNone(parsed["phi"])

    def test_raw_nan_rejected_by_strict_dump(self):
        with self.assertRaises(ValueError):
            json.dumps({"x": float("nan")}, allow_nan=False)

    def test_observed_token(self):
        self.assertEqual(prb.observed_token(float("nan")), "NaN")
        self.assertEqual(prb.observed_token(float("inf")), "+Infinity")
        self.assertEqual(prb.observed_token(float("-inf")), "-Infinity")

    def test_coolprop_value_status(self):
        self.assertEqual(prb.coolprop_value_status(1.5),
                         prb.COOLPROP_STATUS_AVAILABLE)
        self.assertEqual(prb.coolprop_value_status(float("nan")),
                         prb.COOLPROP_STATUS_UNAVAILABLE_NONFINITE)
        self.assertEqual(prb.coolprop_value_status(None), "missing")
        self.assertTrue(math.isfinite(1.5))


if __name__ == "__main__":
    unittest.main()
