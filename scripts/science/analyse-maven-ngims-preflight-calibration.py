#!/usr/bin/env python3
"""Retrieve and audit selected MAVEN NGIMS pre-flight calibration products.

The script preserves product hashes and label metadata, streams the large
science CSV files, and reports raw mass-channel evidence. It does not derive
absolute sensitivity or C_EN because the chamber gas number density and
complete calibration chain are not independently validated here.
"""
from __future__ import annotations
import csv
import hashlib
import io
import json
import re
import sys
import tempfile
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

BASES = (
    "https://atmos.nmsu.edu/PDS/data/PDS4/MAVEN/ngims_bundle/calibration/2012/09/",
    "https://pds-atmospheres.nmsu.edu/PDS/data/PDS4/MAVEN/ngims_bundle/calibration/2012/09/",
)
PDS_NS = "http://pds.nasa.gov/pds4/pds/v1"
OUTPUT = Path("src/modules/Data/mavenNgimsL1bCalibrationArchive/preflight-calibration-products.json")
USER_AGENT = "EvoWars-NGIMS-Preflight-Calibration-Audit/1.0"
MAX_BYTES = 100_000_000
TIDS = (
    {"tid": "010191", "timestamp": "20120923T081945", "sisDesignation": "Argon calibration"},
    {"tid": "010194", "timestamp": "20120923T174216", "sisDesignation": "Krypton calibration"},
)
PRODUCT_KINDS = {
    "gnd-sci": "csv",
    "gnd-msg": "txt",
    "gnd-mkr": "csv",
}
TARGET_MASSES = (14, 16, 19, 28, 40, 44, 84, 86)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def request_to_file(url: str, destination: Path) -> dict[str, Any]:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "application/xml,text/csv,text/plain,*/*",
            "Accept-Encoding": "identity",
        },
    )
    digest = hashlib.sha256()
    total = 0
    with urllib.request.urlopen(request, timeout=180) as response:
        with destination.open("wb") as output:
            while True:
                block = response.read(1024 * 1024)
                if not block:
                    break
                total += len(block)
                if total > MAX_BYTES:
                    raise RuntimeError("payload exceeds configured limit: " + url)
                digest.update(block)
                output.write(block)
        return {
            "url": url,
            "finalUrl": response.geturl(),
            "httpStatus": response.status,
            "contentType": response.headers.get("Content-Type"),
            "contentLengthHeader": response.headers.get("Content-Length"),
            "byteLength": total,
            "sha256": digest.hexdigest(),
        }


def fetch_product_file(directory: str, filename: str, destination: Path) -> dict[str, Any]:
    errors = []
    for base in BASES:
        url = base + filename
        try:
            return request_to_file(url, destination)
        except Exception as error:
            errors.append({"url": url, "error": str(error)})
    raise RuntimeError("unable to retrieve " + filename + ": " + json.dumps(errors))


def qname(local: str) -> str:
    return "{" + PDS_NS + "}" + local


def scalar(element: ET.Element, local: str) -> str | None:
    nodes = [node for node in list(element) if node.tag == qname(local)]
    if not nodes:
        return None
    if len(nodes) != 1 or list(nodes[0]):
        raise RuntimeError("expected one scalar " + local)
    return (nodes[0].text or "").strip() or None


def inspect_label(label_path: Path, payload_filename: str) -> dict[str, Any]:
    root = ET.parse(label_path).getroot()
    if root.tag != qname("Product_Observational"):
        raise RuntimeError("unexpected PDS4 product root in " + label_path.name)
    logical = [n for n in root.iter() if n.tag == qname("logical_identifier")]
    if len(logical) != 1:
        raise RuntimeError("expected one logical_identifier in " + label_path.name)
    file_nodes = []
    for node in root.iter():
        if node.tag == qname("File") and scalar(node, "file_name") == payload_filename:
            file_nodes.append(node)
    if len(file_nodes) != 1:
        raise RuntimeError("expected one File entry for " + payload_filename)
    declared_size = int(scalar(file_nodes[0], "file_size") or "0")
    declared_records = None
    fields: list[str] = []
    for table in root.iter():
        if table.tag == qname("Table_Delimited"):
            rec = next((x for x in table if x.tag == qname("Record_Delimited")), None)
            if rec is not None:
                declared_records = scalar(table, "records")
                fields = [
                    scalar(f, "name") or ""
                    for f in rec
                    if f.tag == qname("Field_Delimited")
                ]
                break
    return {
        "logicalIdentifier": (logical[0].text or "").strip(),
        "payloadFileName": payload_filename,
        "labelDeclaredFileSizeBytes": declared_size,
        "labelDeclaredRecordCount": int(declared_records) if declared_records else None,
        "columnNamesFromPdsLabel": fields,
        "labelSha256": sha256_file(label_path),
        "detachedLabelAuthenticity": "not_independently_authenticated",
    }


def norm_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", value.lower())


def find_column(headers: list[str], candidates: tuple[str, ...]) -> str | None:
    mapping = {norm_key(h): h for h in headers}
    for candidate in candidates:
        if norm_key(candidate) in mapping:
            return mapping[norm_key(candidate)]
    return None


def summarize_science_csv(path: Path, pds_fields: list[str]) -> dict[str, Any]:
    with path.open("r", encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        if not reader.fieldnames:
            raise RuntimeError("science CSV has no header: " + path.name)
        headers = [x.strip() for x in reader.fieldnames]
        mass_col = find_column(headers, ("mass", "amu", "mass_to_charge", "mz"))
        count_col = find_column(headers, ("counts", "count", "raw_counts"))
        cps_col = find_column(headers, ("cps_raw", "cps", "counts_per_second"))
        focus_col = find_column(headers, ("focusmode", "focus_mode", "tuning", "source_mode"))
        multiplier_col = find_column(headers, ("multiplier", "detector", "cem"))
        filament_col = find_column(headers, ("filament", "filament_id"))
        integration_col = find_column(headers, ("ip", "integration_period", "ip_count"))
        groups: dict[str, dict[str, dict[str, Any]]] = {}
        row_count = 0
        blank_mass_rows = 0
        invalid_mass_rows = 0
        for row in reader:
            row_count += 1
            raw_mass = row.get(mass_col, "") if mass_col else ""
            if raw_mass is None or raw_mass.strip() == "":
                blank_mass_rows += 1
                continue
            try:
                mass = float(raw_mass)
            except ValueError:
                invalid_mass_rows += 1
                continue
            if mass < 0:
                invalid_mass_rows += 1
                continue
            focus = (row.get(focus_col, "") or "").strip() if focus_col else "not_reported"
            focus = focus or "blank_or_not_reported"
            mass_key = format(mass, ".4f").rstrip("0").rstrip(".")
            group = groups.setdefault(focus, {}).setdefault(mass_key, {
                "massToCharge": mass,
                "rowCount": 0,
                "countsSum": 0.0,
                "countsObserved": 0,
                "countsMin": None,
                "countsMax": None,
                "cpsSum": 0.0,
                "cpsObserved": 0,
                "multiplierValues": {},
                "filamentValues": {},
                "integrationPeriodValues": {},
            })
            group["rowCount"] += 1
            for column, bucket in (
                (count_col, "counts"),
                (cps_col, "cps"),
            ):
                if column is None:
                    continue
                try:
                    value = float(row.get(column, "") or "")
                except ValueError:
                    continue
                if bucket == "counts":
                    group["countsSum"] += value
                    group["countsObserved"] += 1
                    group["countsMin"] = value if group["countsMin"] is None else min(group["countsMin"], value)
                    group["countsMax"] = value if group["countsMax"] is None else max(group["countsMax"], value)
                else:
                    group["cpsSum"] += value
                    group["cpsObserved"] += 1
            for column, name in (
                (multiplier_col, "multiplierValues"),
                (filament_col, "filamentValues"),
                (integration_col, "integrationPeriodValues"),
            ):
                if column is not None:
                    value = (row.get(column, "") or "").strip()
                    if value:
                        group[name][value] = group[name].get(value, 0) + 1
    mass_summaries: dict[str, Any] = {}
    for focus, mass_bins in groups.items():
        ordered = sorted(mass_bins.values(), key=lambda item: (-item["countsSum"], item["massToCharge"]))
        focus_result = []
        for item in ordered:
            focus_result.append({
                "massToCharge": item["massToCharge"],
                "rowCount": item["rowCount"],
                "countsObserved": item["countsObserved"],
                "countsSum": item["countsSum"] if item["countsObserved"] else None,
                "countsMean": item["countsSum"] / item["countsObserved"] if item["countsObserved"] else None,
                "countsMin": item["countsMin"],
                "countsMax": item["countsMax"],
                "cpsObserved": item["cpsObserved"],
                "cpsMean": item["cpsSum"] / item["cpsObserved"] if item["cpsObserved"] else None,
                "multiplierValues": item["multiplierValues"],
                "filamentValues": item["filamentValues"],
                "integrationPeriodValues": item["integrationPeriodValues"],
            })
        mass_summaries[focus] = {
            "massBinCount": len(focus_result),
            "topMassBinsByIntegratedRawCounts": focus_result[:20],
            "targetMassEvidence": {
                str(target): next((x for x in focus_result if abs(x["massToCharge"] - target) < 0.001), None)
                for target in TARGET_MASSES
            },
        }
    return {
        "rowCount": row_count,
        "headers": headers,
        "pdsLabelFieldNames": pds_fields,
        "detectedColumns": {
            "mass": mass_col,
            "counts": count_col,
            "cps": cps_col,
            "focusModeOrTuning": focus_col,
            "multiplier": multiplier_col,
            "filament": filament_col,
            "integrationPeriod": integration_col,
        },
        "blankMassRowCount": blank_mass_rows,
        "invalidMassRowCount": invalid_mass_rows,
        "focusModeOrTuningSummaries": mass_summaries,
        "gasIdentityAssigned": False,
        "gasIdentityNote": "Mass-channel signal summaries are preserved as raw evidence. A dominant channel alone is not treated as sufficient identification of the calibration gas."
    }


def summarize_message(path: Path) -> dict[str, Any]:
    text = path.read_text(encoding="utf-8", errors="replace")
    lines = text.splitlines()
    data_directory = None
    if lines:
        match = re.match(r"Data directory:\s*(.*)", lines[0].strip(), re.I)
        if match:
            data_directory = match.group(1).strip()
    marker_descriptions = re.findall(r"sys\.marker:\s*id=\d+\s*,\s*txt=(.*)", text, re.I)
    multiplier_commands = re.findall(r"Multiplier\s+([12])\s+On\s+@\s*(\d+)", text, re.I)
    filament_commands = re.findall(r"Filament\s+(\d+)\s+ON", text, re.I)
    return {
        "lineCount": len(lines),
        "firstLines": lines[:12],
        "dataDirectoryName": data_directory,
        "markerDescriptions": marker_descriptions[:200],
        "multiplierOnCommands": [{"multiplier": int(a), "settingCode": int(b)} for a, b in multiplier_commands],
        "filamentOnCommands": sorted({int(x) for x in filament_commands}),
        "containsReplacementCharacter": "\ufffd" in text,
    }


def fetch_and_audit_tid(tid: dict[str, str], work_dir: Path) -> dict[str, Any]:
    result: dict[str, Any] = {
        "tid": int(tid["tid"]),
        "date": tid["timestamp"][:8],
        "sisDesignation": tid["sisDesignation"],
        "products": {},
    }
    for kind, extension in PRODUCT_KINDS.items():
        stem = "mvn_ngi_l1c_" + kind + "-" + tid["tid"] + "_" + tid["timestamp"] + "_v01_r01"
        payload_name = stem + "." + extension
        label_name = stem + ".xml"
        payload_path = work_dir / payload_name
        label_path = work_dir / label_name
        payload_meta = fetch_product_file(BASES[0], payload_name, payload_path)
        label_meta = fetch_product_file(BASES[0], label_name, label_path)
        label = inspect_label(label_path, payload_name)
        label["labelDownload"] = label_meta
        label["payloadDownload"] = payload_meta
        label["payloadSizeMatchesLabel"] = label["labelDeclaredFileSizeBytes"] == payload_meta["byteLength"]
        label["payloadSha256"] = payload_meta["sha256"]
        if kind == "gnd-sci":
            label["scienceSummary"] = summarize_science_csv(payload_path, label["columnNamesFromPdsLabel"])
        elif kind == "gnd-msg":
            label["messageSummary"] = summarize_message(payload_path)
        else:
            label["rowCount"] = sum(1 for _ in payload_path.open("r", encoding="utf-8-sig", errors="replace")) - 1
        result["products"][kind] = label
    directory_name = result["products"]["gnd-msg"]["messageSummary"]["dataDirectoryName"]
    result["messageLogDirectoryName"] = directory_name
    result["sisDesignationConflictsWithMessageDirectory"] = (
        "Argon" in tid["sisDesignation"] and directory_name is not None and "Kr" in directory_name
    )
    return result


def self_test() -> None:
    import unittest

    class Tests(unittest.TestCase):
        def test_target_mass_bins_are_not_species_labels(self) -> None:
            self.assertIn(40, TARGET_MASSES)
            self.assertIn(84, TARGET_MASSES)

        def test_message_directory_conflict_is_detected(self) -> None:
            sis = "Argon calibration"
            directory = "2012-09-23-08.19.45-10191-KrCalibration/"
            self.assertTrue("Argon" in sis and "Kr" in directory)

        def test_no_species_assignment_by_single_peak(self) -> None:
            with tempfile.TemporaryDirectory() as tmp:
                path = Path(tmp) / "sample.csv"
                path.write_text("MASS,COUNTS,FOCUS_MODE\n40,100,csn\n84,10,csn\n", encoding="utf-8")
                summary = summarize_science_csv(path, ["MASS", "COUNTS", "FOCUS_MODE"])
                self.assertFalse(summary["gasIdentityAssigned"])
                self.assertEqual(summary["rowCount"], 2)

    suite = unittest.defaultTestLoader.loadTestsFromTestCase(Tests)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    if not result.wasSuccessful():
        raise SystemExit(1)


def main() -> None:
    if "--self-test" in sys.argv:
        self_test()
        print("pre-flight calibration analyzer self-test: OK")
        return
    results = []
    with tempfile.TemporaryDirectory(prefix="maven-ngims-calibration-") as temp:
        work_dir = Path(temp)
        for tid in TIDS:
            results.append(fetch_and_audit_tid(tid, work_dir))
    output = {
        "schemaVersion": "1.0.0",
        "status": "preflight_products_audited_raw_sensitivity_not_rederived",
        "sourceCollection": "https://atmos.nmsu.edu/PDS/data/PDS4/MAVEN/ngims_bundle/calibration/",
        "sourceSIS": "MAVEN NGIMS PDS SIS Rev. 1.13, Table A-11",
        "retrievedTidCount": len(results),
        "products": results,
        "limitations": [
            "The script streams selected ground science CSVs and records raw mass-channel evidence, but does not calculate absolute sensitivity.",
            "The gnd-hk products are large and have not yet been ingested; chamber pressure/reference gas density and the complete calibration chain are not independently validated here.",
            "TID 10191 is called Argon calibration in SIS Table A-11, but its source message-log directory is named KrCalibration. Gas identity remains unassigned pending raw spectrum and pressure/reference-gas cross-check.",
            "A raw mass-channel peak by itself is not treated as sufficient calibration-gas identification.",
            "Preflight ground references must not be promoted to a flight-specific sensitivity for TID 14282 without matching detector, emission, gas density, and configuration evidence."
        ]
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(output, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print("Wrote " + str(OUTPUT) + " with " + str(len(results)) + " preflight calibration TIDs")


if __name__ == "__main__":
    main()
