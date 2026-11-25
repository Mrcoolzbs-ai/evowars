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
import math
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
COMPACT_OUTPUT = Path("src/modules/Data/mavenNgimsL1bCalibrationArchive/preflight-calibration-housekeeping-summary.json")
USER_AGENT = "EvoWars-NGIMS-Preflight-Calibration-Audit/1.0"
MAX_BYTES = 500_000_000
TIDS = (
    {"tid": "010191", "timestamp": "20120923T081945", "sisDesignation": "Argon calibration"},
    {"tid": "010194", "timestamp": "20120923T174216", "sisDesignation": "Krypton calibration"},
)
PRODUCT_KINDS = {
    "gnd-hk": "csv",
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
    catalog: list[dict[str, Any]] = []
    for table in root.iter():
        if table.tag == qname("Table_Delimited"):
            rec = next((x for x in table if x.tag == qname("Record_Delimited")), None)
            if rec is not None:
                declared_records = scalar(table, "records")
                for field in rec:
                    if field.tag != qname("Field_Delimited"):
                        continue
                    name = scalar(field, "name") or ""
                    fields.append(name)
                    catalog.append({
                        "name": name,
                        "fieldNumber": int(scalar(field, "field_number") or "0"),
                        "dataType": scalar(field, "data_type"),
                        "unit": scalar(field, "unit") or "unitless",
                        "description": " ".join((scalar(field, "description") or "").split()),
                    })
                break
    if not fields and payload_filename.lower().endswith(".csv"):
        raise RuntimeError("no PDS4 Table_Delimited Record_Delimited schema found in " + label_path.name)
    return {
        "logicalIdentifier": (logical[0].text or "").strip(),
        "payloadFileName": payload_filename,
        "labelDeclaredFileSizeBytes": declared_size,
        "labelDeclaredRecordCount": int(declared_records) if declared_records else None,
        "columnNamesFromPdsLabel": fields,
        "columnCatalogFromPdsLabel": catalog,
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



def housekeeping_field_role(field: dict[str, Any]) -> str | None:
    text = (field.get("name", "") + " " + field.get("description", "")).lower()
    patterns = (
        ("pressure", r"press|pres|vacuum|gauge"),
        ("reservoir_gas", r"reservoir|tank|capillary|gas.?supply|bottle"),
        ("valve_flow", r"valve|solenoid|flow.?control|leak.?valve"),
        ("temperature", r"temp|temperature|therm"),
        ("filament_source", r"filament|emission|ion.?source|source.?heater"),
        ("multiplier_detector", r"multiplier|cem|detector|electron.?mult"),
        ("rf_qms", r"rf|radio.?frequency|qms|quadrupole"),
    )
    for role, pattern in patterns:
        if re.search(pattern, text):
            return role
    return None


def new_housekeeping_stats(field: dict[str, Any]) -> dict[str, Any]:
    return {
        "name": field["name"],
        "fieldNumber": field.get("fieldNumber"),
        "unit": field.get("unit", "unknown"),
        "dataType": field.get("dataType"),
        "description": field.get("description", ""),
        "role": housekeeping_field_role(field),
        "observedValueCount": 0,
        "emptyValueCount": 0,
        "nonNumericValueCount": 0,
        "minObservedValue": None,
        "maxObservedValue": None,
        "meanObservedValue": None,
        "firstObservedRawValue": None,
        "lastObservedRawValue": None,
        "firstObservedRecordNumber": None,
        "lastObservedRecordNumber": None,
        "_sum": 0.0,
    }


def update_housekeeping_stats(stats: dict[str, Any], raw: str, record_number: int) -> None:
    value_text = (raw or "").strip()
    if not value_text:
        stats["emptyValueCount"] += 1
        return
    try:
        value = float(value_text)
    except ValueError:
        stats["nonNumericValueCount"] += 1
        return
    if not math.isfinite(value):
        stats["nonNumericValueCount"] += 1
        return
    stats["observedValueCount"] += 1
    stats["_sum"] += value
    stats["minObservedValue"] = value if stats["minObservedValue"] is None else min(stats["minObservedValue"], value)
    stats["maxObservedValue"] = value if stats["maxObservedValue"] is None else max(stats["maxObservedValue"], value)
    if stats["firstObservedRawValue"] is None:
        stats["firstObservedRawValue"] = value_text
        stats["firstObservedRecordNumber"] = record_number
    stats["lastObservedRawValue"] = value_text
    stats["lastObservedRecordNumber"] = record_number


def finish_housekeeping_stats(stats: dict[str, Any]) -> dict[str, Any]:
    count = stats.pop("observedValueCount")
    total = stats.pop("_sum")
    stats["observedValueCount"] = count
    stats["meanObservedValue"] = total / count if count else None
    return stats


def summarize_housekeeping_csv(path: Path, field_catalog: list[dict[str, Any]], declared_records: int | None) -> dict[str, Any]:
    catalog = {item["name"]: item for item in field_catalog}
    with path.open("r", encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        if not reader.fieldnames:
            raise RuntimeError("housekeeping CSV has no header: " + path.name)
        headers = [item.strip() for item in reader.fieldnames]
        if len(headers) != len(set(headers)):
            raise RuntimeError("housekeeping CSV has duplicate column names: " + path.name)
        if len(headers) != len(field_catalog):
            raise RuntimeError(f"housekeeping CSV/PDS4 schema column count mismatch: {len(headers)} != {len(field_catalog)}")
        if headers != [item["name"] for item in field_catalog]:
            raise RuntimeError("housekeeping CSV column order/names differ from detached PDS4 label")

        time_column = find_column(headers, ("TIME", "T_SCLK", "SCLK", "TIME_SCLK"))
        marker_column = find_column(headers, ("MKID", "MARKER_ID", "MARKERID"))
        selected = [
            {**catalog[name], "role": housekeeping_field_role(catalog[name])}
            for name in headers
            if name in catalog and housekeeping_field_role(catalog[name]) is not None
        ]
        stats = {item["name"]: new_housekeeping_stats(item) for item in selected}
        pressure_fields = [
            item["name"] for item in selected
            if item["role"] in ("pressure", "reservoir_gas", "valve_flow")
        ]
        row_count = 0
        blank_marker_rows = 0
        nonnumeric_time_rows = 0
        previous_time: float | None = None
        time_decrease_count = 0
        first_time_raw = None
        last_time_raw = None
        marker_counts: dict[str, int] = {}
        first_last_samples: list[dict[str, Any]] = []
        sample_cap = 24

        for row in reader:
            row_count += 1
            record_number = row_count + 1
            raw_time = (row.get(time_column, "") or "").strip() if time_column else ""
            raw_marker = (row.get(marker_column, "") or "").strip() if marker_column else ""
            marker_key = raw_marker if raw_marker else "__blank__"
            if not raw_marker:
                blank_marker_rows += 1
            marker_counts[marker_key] = marker_counts.get(marker_key, 0) + 1
            if raw_time:
                if first_time_raw is None:
                    first_time_raw = raw_time
                last_time_raw = raw_time
                try:
                    current_time = float(raw_time)
                    if previous_time is not None and current_time < previous_time:
                        time_decrease_count += 1
                    previous_time = current_time
                except ValueError:
                    nonnumeric_time_rows += 1

            for name, channel_stats in stats.items():
                update_housekeeping_stats(channel_stats, row.get(name, ""), record_number)

            if row_count <= sample_cap or len(first_last_samples) < sample_cap * 2:
                first_last_samples.append({
                    "recordNumber": record_number,
                    "timeRaw": raw_time or None,
                    "markerIdRaw": raw_marker or None,
                    "fields": {name: (row.get(name, "") or "").strip() or None for name in pressure_fields}
                })
            elif len(first_last_samples) >= sample_cap * 2:
                first_last_samples.pop(sample_cap)
                first_last_samples.append({
                    "recordNumber": record_number,
                    "timeRaw": raw_time or None,
                    "markerIdRaw": raw_marker or None,
                    "fields": {name: (row.get(name, "") or "").strip() or None for name in pressure_fields}
                })

    finished = {name: finish_housekeeping_stats(value) for name, value in stats.items()}
    record_count_status = (
        "matches_label" if declared_records == row_count
        else "mismatch" if declared_records is not None
        else "not_declared"
    )
    return {
        "rowCount": row_count,
        "declaredRecordCount": declared_records,
        "recordCountStatus": record_count_status,
        "columnCount": len(headers),
        "timeColumn": time_column,
        "markerColumn": marker_column,
        "firstTimeRaw": first_time_raw,
        "lastTimeRaw": last_time_raw,
        "timeMonotonicityDiagnostic": {
            "timeDecreaseCount": time_decrease_count,
            "nonnumericTimeRowCount": nonnumeric_time_rows,
            "timeValuesUsedForPressureOrCalibrationConversion": False,
        },
        "blankMarkerIdRowCount": blank_marker_rows,
        "markerCounts": marker_counts,
        "selectedChannelCount": len(finished),
        "channelStatistics": list(finished.values()),
        "pressureValveChannels": pressure_fields,
        "distinctNonblankMarkerIdCount": sum(1 for marker in marker_counts if marker != "__blank__"),
        "boundedFirstLastSamples": first_last_samples,
        "interpretation": {
            "rawTelemetryOnly": True,
            "pressureVoltageConvertedToPhysicalPressure": False,
            "gasNumberDensityDerived": False,
            "interpolationOrCarryForwardPerformed": False,
            "calibrationSensitivityDerived": False,
            "cEnDerived": False,
            "markerClockJoinToOtherProductsPerformed": False,
        },
        "schemaFieldCatalog": field_catalog,
    }


def summarize_marker_csv(path: Path) -> dict[str, Any]:
    rows = []
    counts: dict[str, int] = {}
    row_count = 0
    with path.open("r", encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        if not reader.fieldnames:
            raise RuntimeError("marker CSV has no header: " + path.name)
        headers = [x.strip() for x in reader.fieldnames]
        time_col = find_column(headers, ("TIME", "T_SCLK", "SCLK"))
        id_col = find_column(headers, ("MKID", "MARKER_ID", "MARKERID"))
        desc_col = find_column(headers, ("DESCRIPTION", "DESC", "TEXT"))
        if time_col is None or id_col is None or desc_col is None:
            raise RuntimeError("marker CSV lacks TIME/MKID/DESCRIPTION columns")
        for record_number, row in enumerate(reader, start=2):
            row_count += 1
            marker_id = (row.get(id_col, "") or "").strip()
            description = (row.get(desc_col, "") or "").strip()
            key = description.lower()
            counts[key] = counts.get(key, 0) + 1
            if len(rows) < 300:
                rows.append({"recordNumber": record_number, "timeRaw": row.get(time_col),
                             "markerId": marker_id, "description": description})
    return {"rowCount": row_count, "descriptionCounts": counts,
            "markerRowsBoundedSample": rows, "timeCoordinateNotConverted": True}

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
        "pressureRelevantLogLines": [line for line in lines if re.search(r"reservoir|pressure|press|valve|capillary|gas.?supply|tank|bottle|leak", line, re.I)][:300],
    }


def fetch_and_audit_tid(
    tid: dict[str, str],
    work_dir: Path,
    previous_products: dict[str, Any] | None = None,
) -> dict[str, Any]:
    result: dict[str, Any] = {
        "tid": int(tid["tid"]),
        "date": tid["timestamp"][:8],
        "sisDesignation": tid["sisDesignation"],
        "products": {},
    }
    for kind, extension in PRODUCT_KINDS.items():
        if kind == "gnd-sci" and previous_products and kind in previous_products:
            reused = json.loads(json.dumps(previous_products[kind]))
            reused["reusedFromPriorManifest"] = True
            result["products"][kind] = reused
            continue
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
        if kind == "gnd-hk":
            label["housekeepingSummary"] = summarize_housekeeping_csv(
                payload_path,
                label["columnCatalogFromPdsLabel"],
                label["labelDeclaredRecordCount"],
            )
        elif kind == "gnd-sci":
            label["scienceSummary"] = summarize_science_csv(payload_path, label["columnNamesFromPdsLabel"])
        elif kind == "gnd-msg":
            label["messageSummary"] = summarize_message(payload_path)
        elif kind == "gnd-mkr":
            label["markerSummary"] = summarize_marker_csv(payload_path)
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

        def test_text_pds_label_without_delimited_table_is_allowed(self) -> None:
            with tempfile.TemporaryDirectory() as tmp:
                folder = Path(tmp)
                label = folder / "sample.xml"
                payload = folder / "sample.txt"
                payload.write_text("test", encoding="utf-8")
                label.write_text(
                    '''<?xml version="1.0"?>
                    <Product_Observational xmlns="http://pds.nasa.gov/pds4/pds/v1">
                      <Identification_Area><logical_identifier>urn:test:sample</logical_identifier></Identification_Area>
                      <File_Area_Observational><File><file_name>sample.txt</file_name>
                        <file_size unit="byte">4</file_size></File></File_Area_Observational>
                    </Product_Observational>''',
                    encoding="utf-8",
                )
                result = inspect_label(label, "sample.txt")
                self.assertEqual(result["columnNamesFromPdsLabel"], [])
                self.assertEqual(result["columnCatalogFromPdsLabel"], [])

        def test_no_species_assignment_by_single_peak(self) -> None:
            with tempfile.TemporaryDirectory() as tmp:
                path = Path(tmp) / "sample.csv"
                path.write_text("MASS,COUNTS,FOCUS_MODE\n40,100,csn\n84,10,csn\n", encoding="utf-8")
                summary = summarize_science_csv(path, ["MASS", "COUNTS", "FOCUS_MODE"])
                self.assertFalse(summary["gasIdentityAssigned"])
                self.assertEqual(summary["rowCount"], 2)

        def test_housekeeping_pressure_channel_is_raw_and_sparse(self) -> None:
            with tempfile.TemporaryDirectory() as tmp:
                path = Path(tmp) / "sample.csv"
                path.write_text(
                    "TIME,MKID,CDH:BA_PRES,CDH:IS_TMP,CDH:OS_FIL_EMON\n"
                    "1,10,1.2,20,-250\n"
                    "2,10,,20,\n"
                    "3,11,1.8,21,-249\n",
                    encoding="utf-8",
                )
                catalog = [
                    {"name":"TIME","fieldNumber":1,"dataType":"ASCII_Real","unit":"SECONDS","description":"NGIMS clock"},
                    {"name":"MKID","fieldNumber":2,"dataType":"ASCII_Integer","unit":"unitless","description":"Marker ID"},
                    {"name":"CDH:BA_PRES","fieldNumber":3,"dataType":"ASCII_Real","unit":"Volts","description":"Pressure monitor voltage"},
                    {"name":"CDH:IS_TMP","fieldNumber":4,"dataType":"ASCII_Real","unit":"Degrees Celsius","description":"Instrument source temperature"},
                    {"name":"CDH:OS_FIL_EMON","fieldNumber":5,"dataType":"ASCII_Real","unit":"Microamperes","description":"Open source filament emission monitor"},
                ]
                result = summarize_housekeeping_csv(path, catalog, 3)
                pressure = next(x for x in result["channelStatistics"] if x["name"] == "CDH:BA_PRES")
                self.assertEqual(pressure["observedValueCount"], 2)
                self.assertEqual(pressure["emptyValueCount"], 1)
                self.assertEqual(pressure["unit"], "Volts")
                self.assertEqual(result["markerCounts"], {"10":2,"11":1})
                self.assertEqual(result["distinctNonblankMarkerIdCount"], 2)
                self.assertFalse(result["interpretation"]["pressureVoltageConvertedToPhysicalPressure"])
                self.assertEqual(result["rowCount"], 3)

        def test_housekeeping_never_carries_forward_missing_values(self) -> None:
            with tempfile.TemporaryDirectory() as tmp:
                path = Path(tmp) / "sample.csv"
                path.write_text("TIME,MKID,QMS:MT_MU2_VCTL\n1,20,-2400\n2,20,\n3,21,-2300\n", encoding="utf-8")
                catalog = [
                    {"name":"TIME","fieldNumber":1,"dataType":"ASCII_Real","unit":"SECONDS","description":"time"},
                    {"name":"MKID","fieldNumber":2,"dataType":"ASCII_Integer","unit":"unitless","description":"marker"},
                    {"name":"QMS:MT_MU2_VCTL","fieldNumber":3,"dataType":"ASCII_Real","unit":"Volts","description":"Multiplier negative electrode voltage"},
                ]
                result = summarize_housekeeping_csv(path, catalog, 3)
                stat = next(x for x in result["channelStatistics"] if x["name"] == "QMS:MT_MU2_VCTL")
                self.assertEqual(stat["observedValueCount"], 2)
                self.assertEqual(stat["emptyValueCount"], 1)
                self.assertEqual(result["markerCounts"], {"20":2,"21":1})

    suite = unittest.defaultTestLoader.loadTestsFromTestCase(Tests)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    if not result.wasSuccessful():
        raise SystemExit(1)



def build_compact_summary(results: list[dict[str, Any]]) -> dict[str, Any]:
    compact_products = []
    for product in results:
        products = product["products"]
        hk_product = products.get("gnd-hk", {})
        hk = hk_product.get("housekeepingSummary", {})
        marker_groups = hk.get("pressureAndValveStatisticsByMarkerId", {})
        compact_marker_groups: dict[str, Any] = {}
        for marker_id, group in marker_groups.items():
            compact_channels = {}
            for name, channel in group.get("channels", {}).items():
                compact_channels[name] = {
                    "observed": channel.get("observedValueCount", 0),
                    "empty": channel.get("emptyValueCount", 0),
                    "nonNumeric": channel.get("nonNumericValueCount", 0),
                    "min": channel.get("minObservedValue"),
                    "max": channel.get("maxObservedValue"),
                    "first": channel.get("firstObservedRawValue"),
                    "last": channel.get("lastObservedRawValue"),
                }
            compact_marker_groups[marker_id] = {
                "rows": group.get("rowCount"),
                "firstTimeRaw": group.get("firstTimeRaw"),
                "lastTimeRaw": group.get("lastTimeRaw"),
                "channels": compact_channels,
            }

        channel_stats = []
        for channel in hk.get("channelStatistics", []):
            channel_stats.append({
                "name": channel.get("name"),
                "fieldNumber": channel.get("fieldNumber"),
                "unit": channel.get("unit"),
                "role": channel.get("role"),
                "description": channel.get("description"),
                "observed": channel.get("observedValueCount"),
                "empty": channel.get("emptyValueCount"),
                "nonNumeric": channel.get("nonNumericValueCount"),
                "min": channel.get("minObservedValue"),
                "max": channel.get("maxObservedValue"),
                "mean": channel.get("meanObservedValue"),
                "first": channel.get("firstObservedRawValue"),
                "last": channel.get("lastObservedRawValue"),
            })

        science = products.get("gnd-sci", {}).get("scienceSummary", {})
        science_focus = {}
        for tuning, section in science.get("focusModeOrTuningSummaries", {}).items():
            science_focus[tuning] = {
                "massBinCount": section.get("massBinCount"),
                "targetMassEvidence": section.get("targetMassEvidence"),
                "topMassBinsByIntegratedRawCounts": section.get("topMassBinsByIntegratedRawCounts", [])[:12],
            }

        message = products.get("gnd-msg", {}).get("messageSummary", {})
        markers = products.get("gnd-mkr", {}).get("markerSummary", {})
        compact_products.append({
            "tid": product.get("tid"),
            "date": product.get("date"),
            "sisDesignation": product.get("sisDesignation"),
            "messageLogDirectoryName": product.get("messageLogDirectoryName"),
            "sisDesignationConflictsWithMessageDirectory": product.get("sisDesignationConflictsWithMessageDirectory"),
            "housekeeping": {
                "fileName": hk_product.get("payloadFileName"),
                "bytes": hk_product.get("payloadDownload", {}).get("byteLength"),
                "sha256": hk_product.get("payloadSha256"),
                "payloadSizeMatchesLabel": hk_product.get("payloadSizeMatchesLabel"),
                "declaredRecords": hk_product.get("labelDeclaredRecordCount"),
                "actualRecords": hk.get("rowCount"),
                "recordCountStatus": hk.get("recordCountStatus"),
                "columnCount": hk.get("columnCount"),
                "timeColumn": hk.get("timeColumn"),
                "markerColumn": hk.get("markerColumn"),
                "firstTimeRaw": hk.get("firstTimeRaw"),
                "lastTimeRaw": hk.get("lastTimeRaw"),
                "timeMonotonicityDiagnostic": hk.get("timeMonotonicityDiagnostic"),
                "blankMarkerIdRows": hk.get("blankMarkerIdRowCount"),
                "markerCounts": hk.get("markerCounts"),
                "pressureValveChannels": hk.get("pressureValveChannels"),
                "selectedChannelCount": hk.get("selectedChannelCount"),
                "channelStatistics": channel_stats,
                "pressureValveStatisticsByMarkerId": compact_marker_groups,
                "interpretation": hk.get("interpretation"),
            },
            "messageLog": {
                "firstLines": message.get("firstLines"),
                "pressureRelevantLines": message.get("pressureRelevantLogLines"),
                "multiplierOnCommands": message.get("multiplierOnCommands"),
                "filamentOnCommands": message.get("filamentOnCommands"),
            },
            "markerProduct": {
                "rowCount": markers.get("rowCount"),
                "descriptionCounts": markers.get("descriptionCounts"),
                "markerRowsBoundedSample": markers.get("markerRowsBoundedSample", [])[:100],
            },
            "science": {
                "rowCount": science.get("rowCount"),
                "detectedColumns": science.get("detectedColumns"),
                "focusModeOrTuningSummaries": science_focus,
            },
        })

    return {
        "schemaVersion": "1.0.0",
        "status": "raw_housekeeping_evidence_compacted_no_pressure_or_sensitivity_conversion",
        "sourceCollection": "https://atmos.nmsu.edu/PDS/data/PDS4/MAVEN/ngims_bundle/calibration/",
        "products": compact_products,
        "interpretationLimits": [
            "Pressure-monitor values retain the exact PDS engineering unit. A voltage readback is not a pressure until its sensor calibration and range are established.",
            "No missing telemetry is carried forward, interpolated, or joined by an unvalidated clock transform.",
            "Mass peaks are raw spectral evidence, not an automatic gas identity assignment.",
            "No reference gas number density, absolute sensitivity, or C_EN is derived by this summary."
        ]
    }

def main() -> None:
    if "--self-test" in sys.argv:
        self_test()
        print("pre-flight calibration analyzer self-test: OK")
        return
    previous_by_tid: dict[str, dict[str, Any]] = {}
    if OUTPUT.is_file():
        try:
            previous_manifest = json.loads(OUTPUT.read_text(encoding="utf-8"))
            previous_by_tid = {
                str(product.get("tid")): product.get("products", {})
                for product in previous_manifest.get("products", [])
            }
        except (OSError, json.JSONDecodeError):
            previous_by_tid = {}
    results = []
    with tempfile.TemporaryDirectory(prefix="maven-ngims-calibration-") as temp:
        work_dir = Path(temp)
        for tid in TIDS:
            previous = previous_by_tid.get(str(int(tid["tid"])), {})
            results.append(fetch_and_audit_tid(tid, work_dir, previous))
    output = {
        "schemaVersion": "1.0.0",
        "status": "preflight_products_and_housekeeping_audited_raw_sensitivity_not_rederived",
        "sourceCollection": "https://atmos.nmsu.edu/PDS/data/PDS4/MAVEN/ngims_bundle/calibration/",
        "sourceSIS": "MAVEN NGIMS PDS SIS Rev. 1.13, Table A-11",
        "retrievedTidCount": len(results),
        "products": results,
        "limitations": [
            "The script streams ground science and housekeeping CSVs; housekeeping pressure and valve monitor channels retain exact PDS units and are not converted from volts to physical pressure without sensor calibration.",
            "The gnd-hk pressure/temperature/valve readbacks do not by themselves establish chamber pressure or reference-gas number density; gas density and the complete calibration chain remain to be independently validated.",
            "TID 10191 is called Argon calibration in SIS Table A-11, but its source message-log directory is named KrCalibration. Gas identity remains unassigned pending raw spectrum and pressure/reference-gas cross-check.",
            "A raw mass-channel peak by itself is not treated as sufficient calibration-gas identification.",
            "Preflight ground references must not be promoted to a flight-specific sensitivity for TID 14282 without matching detector, emission, gas density, and configuration evidence."
        ]
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(output, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    compact = build_compact_summary(results)
    COMPACT_OUTPUT.write_text(json.dumps(compact, separators=(",", ":"), sort_keys=True) + "\n", encoding="utf-8")
    print("Wrote " + str(OUTPUT) + " with " + str(len(results)) + " preflight calibration TIDs")
    print("Wrote " + str(COMPACT_OUTPUT) + " (" + str(COMPACT_OUTPUT.stat().st_size) + " bytes)")
    print("NGIMS-HK-COMPACT " + json.dumps(compact, separators=(",", ":"), sort_keys=True)[:12000])


if __name__ == "__main__":
    main()
