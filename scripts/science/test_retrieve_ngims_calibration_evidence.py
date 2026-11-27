import importlib.util
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[2] / "scripts/science/retrieve-ngims-calibration-evidence.py"
SPEC = importlib.util.spec_from_file_location("ngims_retriever", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class RetrieverSafetyTests(unittest.TestCase):
    def test_extracts_only_explicit_file_locator_fields(self):
        payload = {
            "pds:Identification_Area": {"pds:logical_identifier": "urn:nasa:pds:example"},
            "ops:Data_File_Info": {"ops:file_name": "spectrum.tab"},
            "links": [{"href": "https://atmos.nmsu.edu/archive/label.xml"}],
            "description": "https://attacker.invalid/not-a-file.xml",
        }
        self.assertEqual(
            MODULE.extract_urls(payload),
            ["spectrum.tab", "https://atmos.nmsu.edu/archive/label.xml"],
        )

    def test_rejects_non_https_and_untrusted_hosts(self):
        with self.assertRaises(ValueError):
            MODULE.resolve_candidate_url("http://atmos.nmsu.edu/data.tab")
        with self.assertRaises(ValueError):
            MODULE.resolve_candidate_url("https://attacker.invalid/data.tab")

    def test_resolves_relative_locator_under_calibration_archive(self):
        result = MODULE.resolve_candidate_url("2012/2012-09-23/spectrum.tab")
        self.assertEqual(
            result,
            "https://atmos.nmsu.edu/PDS/data/PDS4/MAVEN/ngims_bundle/calibration/2012/2012-09-23/spectrum.tab",
        )

    def test_rejects_explicit_mismatched_lidvid(self):
        payload = {"pds:Identification_Area": {"pds:logical_identifier": "urn:nasa:pds:wrong::1.0"}}
        self.assertFalse(MODULE.response_matches_lidvid(payload, "urn:nasa:pds:right::1.0"))

    def test_accepts_exact_lidvid(self):
        lidvid = "urn:nasa:pds:example::1.0"
        payload = {"pds:Identification_Area": {"pds:lidvid": lidvid}}
        self.assertTrue(MODULE.response_matches_lidvid(payload, lidvid))


if __name__ == "__main__":
    unittest.main()
