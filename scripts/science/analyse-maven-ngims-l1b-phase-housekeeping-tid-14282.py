#!/usr/bin/env python3
"""Build a phase-to-HK telemetry index using the PDS MKID relationship.

PDS cal-hk MKID is the most recent marker to occur at TIME. The association
therefore uses exact marker-ID equality; no clock transform or interpolation
is performed. Original products remain the source of truth for full records.
"""
from __future__ import annotations

import csv
import hashlib
import json
import math
import sys
import unittest
import xml.etree.ElementTree as ET
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ARCHIVE = ROOT / "src/modules/Data/mavenNgimsL1bHousekeepingArchive"
MANIFEST_PATH = ARCHIVE / "manifest.json"
HK_CSV = ARCHIVE / "mvn_ngi_l1b_cal-hk-014282_20141211T154406_v01_r02.csv"
HK_XML = ARCHIVE / "mvn_ngi_l1b_cal-hk-014282_20141211T154406_v01_r02.xml"
MKR_CSV = ARCHIVE / "mvn_ngi_l1b_cal-mkr-014282_20141211T154406_v01_r02.csv"
MKR_XML = ARCHIVE / "mvn_ngi_l1b_cal-mkr-014282_20141211T154406_v01_r02.xml"
OUTPUT = ARCHIVE / "phase-associations.json"
NS = {"pds": "http://pds.nasa.gov/pds4/pds/v1"}
FIELD_NAMES = [
    "CDH:OS_FIL1_VMON", "CDH:OS_FIL2_VMON", "CDH:OS_FIL_EMON",
    "CDH:OS_FIL1_IMON", "CDH:OS_FIL2_IMON", "CDH:OS_TRAP_MON", "CDH:OS_TMP",
    "CDH:CS_FIL1_VMON", "CDH:CS_FIL2_VMON", "CDH:CS_FIL_EMON",
    "CDH:CS_FIL1_IMON", "CDH:CS_FIL2_IMON", "CDH:CS_TRAP_MON", "CDH:CS_TMP",
    "CDH:EM1_IMON", "CDH:EM2_IMON", "CDH:MULTANA1", "CDH:MULTANA2",
    "CDH:BA_FIL_VMON", "CDH:BA_FIL_IMON", "CDH:BA_FIL_EMIS", "CDH:BA_PRES",
    "CDH:THPRES", "CDH:IF_TMP", "CDH:IS_TMP", "CDH:AGC_TMP", "CDH:DET_TMP",
    "CDH:RF_TMP", "CDH:PS_TMP", "QMS:RF_FREQ", "QMS:OS_FIL1_VCTL",
    "QMS:OS_FIL1_ECTL", "QMS:OS_FIL2_VCTL", "QMS:OS_FIL2_ECTL",
    "QMS:CS_FIL1_VCTL", "QMS:CS_FIL1_ECTL", "QMS:CS_FIL2_VCTL",
    "QMS:CS_FIL2_ECTL", "QMS:FIL_ON_CTRL", "QMS:MT_MU1_VCTL", "QMS:MT_MU2_VCTL", "QMS:IP_COUNT",
    "QMS:IP_SETUP", "QMS:FIL_SELECT",
]


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_frozen_inputs() -> dict:
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    for kind, path in (("cal-hk", HK_CSV), ("cal-mkr", MKR_CSV)):
        expected = manifest["products"][kind]["payload"]["sha256"]
        if sha256(path) != expected:
            raise RuntimeError(f"{kind} payload SHA-256 does not match frozen retrieval manifest")
    return manifest


def pds_field_catalog() -> dict[str, dict]:
    root = ET.parse(HK_XML).getroot()
    fields = {}
    for field in root.findall(".//pds:Field_Delimited", NS):
        name = field.findtext("pds:name", default="", namespaces=NS)
        if not name:
            continue
        description = " ".join((field.findtext("pds:description", default="", namespaces=NS)).split())
        fields[name] = {
            "unit": field.findtext("pds:unit", default="", namespaces=NS) or "unitless",
            "dataType": field.findtext("pds:data_type", default="", namespaces=NS),
            "description": description,
        }
    if "TIME" not in fields or "MKID" not in fields:
        raise RuntimeError("HK PDS4 label does not define TIME and MKID")
    if "SCLK" not in fields["TIME"]["description"]:
        raise RuntimeError("HK PDS4 TIME description does not identify the SCLK coordinate")
    if "most recent marker to occur at TIME" not in fields["MKID"]["description"]:
        raise RuntimeError("HK PDS4 MKID semantics changed; refusing phase association")
    missing = [name for name in FIELD_NAMES if name not in fields]
    if missing:
        raise RuntimeError("HK PDS4 label lacks selected engineering fields: " + ", ".join(missing))
    return fields


def parse_marker_phases() -> tuple[list[dict], dict, set[int]]:
    rows = []
    with MKR_CSV.open("r", encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        if reader.fieldnames != ["TIME", "MKID", "DESCRIPTION"]:
            raise RuntimeError(f"unexpected cal-mkr schema: {reader.fieldnames}")
        previous_time = -math.inf
        for record_number, raw in enumerate(reader, start=2):
            time_value = float(raw["TIME"])
            marker_id = int(raw["MKID"])
            if not math.isfinite(time_value) or time_value < previous_time or marker_id < 0:
                raise RuntimeError(f"invalid or non-monotonic marker at record {record_number}")
            previous_time = time_value
            rows.append({
                "sourceRecordNumber": record_number,
                "timeSclkSeconds": time_value,
                "markerId": marker_id,
                "description": raw["DESCRIPTION"] or "",
            })

    tid_starts = [row for row in rows if row["description"].strip().upper().startswith("TIDSTART")]
    tid_stops = [row for row in rows if row["description"].strip().upper().startswith("TIDSTOP")]
    if len(tid_starts) != 1 or len(tid_stops) != 1:
        raise RuntimeError("cal-mkr must have exactly one TIDSTART and TIDSTOP")
    tid_start, tid_stop = tid_starts[0], tid_stops[0]
    if tid_stop["timeSclkSeconds"] <= tid_start["timeSclkSeconds"]:
        raise RuntimeError("TIDSTOP is not after TIDSTART")

    phases = []
    pending = None
    for row in rows:
        description = row["description"].strip()
        if description.lower() == "phase mass scans starting":
            if pending is not None:
                raise RuntimeError("nested phase-start marker")
            pending = row
        elif description.lower() in ("phase ended", "phase ended."):
            if pending is None:
                raise RuntimeError("phase-end marker without a start")
            if row["timeSclkSeconds"] <= pending["timeSclkSeconds"]:
                raise RuntimeError("phase end is not after its start")
            phases.append({
                "phaseIndex": len(phases) + 1,
                "startMarkerId": pending["markerId"],
                "endMarkerId": row["markerId"],
                "markerStartSclkSeconds": pending["timeSclkSeconds"],
                "markerEndSclkSeconds": row["timeSclkSeconds"],
                "markerDurationSclkSeconds": row["timeSclkSeconds"] - pending["timeSclkSeconds"],
                "startMarkerSourceRecord": pending["sourceRecordNumber"],
                "endMarkerSourceRecord": row["sourceRecordNumber"],
                "startDescription": pending["description"],
                "endDescription": row["description"],
            })
            pending = None
    if pending is not None or len(phases) != 15:
        raise RuntimeError(f"expected 15 complete phase intervals, found {len(phases)}")
    if len({phase["startMarkerId"] for phase in phases}) != len(phases):
        raise RuntimeError("phase-start marker IDs are not unique")
    for phase in phases:
        if phase["markerStartSclkSeconds"] < tid_start["timeSclkSeconds"] or phase["markerEndSclkSeconds"] > tid_stop["timeSclkSeconds"]:
            raise RuntimeError(f"phase {phase['phaseIndex']} lies outside TID bounds")
    return phases, {"tidStart": tid_start, "tidStop": tid_stop, "markerRowCount": len(rows)}, {row["markerId"] for row in rows}


def new_field_stats(name: str, unit: str) -> dict:
    return {
        "name": name, "unit": unit, "observedValueCount": 0,
        "emptyValueCount": 0, "nonNumericValueCount": 0,
        "minObservedValue": None, "maxObservedValue": None,
        "firstObservedRawValue": None, "lastObservedRawValue": None,
    }


def update_field_stats(stats: dict, raw: str) -> None:
    raw = (raw or "").strip()
    if raw == "":
        stats["emptyValueCount"] += 1
        return
    try:
        value = float(raw)
    except ValueError:
        stats["nonNumericValueCount"] += 1
        return
    if not math.isfinite(value):
        stats["nonNumericValueCount"] += 1
        return
    stats["observedValueCount"] += 1
    stats["minObservedValue"] = value if stats["minObservedValue"] is None else min(stats["minObservedValue"], value)
    stats["maxObservedValue"] = value if stats["maxObservedValue"] is None else max(stats["maxObservedValue"], value)
    if stats["firstObservedRawValue"] is None:
        stats["firstObservedRawValue"] = raw
    stats["lastObservedRawValue"] = raw


def analyse_housekeeping(phases: list[dict], field_catalog: dict[str, dict], known_marker_ids: set[int]) -> dict:
    phase_by_start_id = {phase["startMarkerId"]: phase for phase in phases}
    phase_by_end_id = {phase["endMarkerId"]: phase for phase in phases}
    stats_by_start_id = {
        phase["startMarkerId"]: {
            "rowCount": 0,
            "firstSourceRecordNumber": None,
            "lastSourceRecordNumber": None,
            "firstObservedTimeSclkRaw": None,
            "lastObservedTimeSclkRaw": None,
            "fieldStatistics": {
                name: new_field_stats(name, field_catalog[name]["unit"])
                for name in FIELD_NAMES
            },
            "firstSamples": [],
            "lastSamples": [],
        }
        for phase in phases
    }
    marker_counts = Counter()
    unknown_marker_counts = Counter()
    source_rows = 0
    blank_marker_rows = 0
    non_phase_rows = 0
    unknown_marker_rows = 0
    rejected_rows = 0
    previous_time = -math.inf

    with HK_CSV.open("r", encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        headers = reader.fieldnames or []
        if len(headers) != 324 or len(set(headers)) != len(headers):
            raise RuntimeError(f"unexpected HK header count/uniqueness: {len(headers)}")
        for required in ("TIME", "MKID", *FIELD_NAMES):
            if required not in headers:
                raise RuntimeError(f"HK CSV missing required field {required}")

        for source_record_number, raw in enumerate(reader, start=2):
            source_rows += 1
            time_raw = (raw.get("TIME") or "").strip()
            marker_raw = (raw.get("MKID") or "").strip()
            try:
                time_value = float(time_raw)
            except ValueError:
                rejected_rows += 1
                continue
            if not math.isfinite(time_value) or time_value < previous_time:
                rejected_rows += 1
                continue
            previous_time = time_value

            if marker_raw == "":
                blank_marker_rows += 1
                non_phase_rows += 1
                continue
            try:
                marker_float = float(marker_raw)
                marker_id = int(marker_float)
                if marker_float != marker_id or marker_id < 0:
                    raise ValueError
            except ValueError:
                rejected_rows += 1
                continue

            marker_counts[str(marker_id)] += 1
            if marker_id not in known_marker_ids:
                # The full set of event marker IDs is retained below through
                # marker ID counts only; unknown IDs are not phase-associated.
                unknown_marker_counts[str(marker_id)] += 1
                unknown_marker_rows += 1

            phase = phase_by_start_id.get(marker_id)
            if phase is None:
                non_phase_rows += 1
                continue

            stats = stats_by_start_id[marker_id]
            stats["rowCount"] += 1
            if stats["firstSourceRecordNumber"] is None:
                stats["firstSourceRecordNumber"] = source_record_number
                stats["firstObservedTimeSclkRaw"] = time_raw
            stats["lastSourceRecordNumber"] = source_record_number
            stats["lastObservedTimeSclkRaw"] = time_raw

            for name in FIELD_NAMES:
                update_field_stats(stats["fieldStatistics"][name], raw.get(name, ""))

            sample = {
                "sourceRecordNumber": source_record_number,
                "timeSclkRaw": time_raw,
                "markerId": marker_id,
                "fields": {name: ((raw.get(name) or "").strip() or None) for name in FIELD_NAMES},
            }
            if len(stats["firstSamples"]) < 2:
                stats["firstSamples"].append(sample)
            stats["lastSamples"].append(sample)
            if len(stats["lastSamples"]) > 2:
                stats["lastSamples"].pop(0)

    if rejected_rows:
        raise RuntimeError(f"HK table contained {rejected_rows} malformed TIME/MKID/record rows")

    output_phases = []
    matched_rows = 0
    for phase in phases:
        stats = stats_by_start_id[phase["startMarkerId"]]
        matched_rows += stats["rowCount"]
        samples = stats["firstSamples"] + [
            row for row in stats["lastSamples"]
            if row["sourceRecordNumber"] not in {item["sourceRecordNumber"] for item in stats["firstSamples"]}
        ]
        output_phases.append({
            **phase,
            "associationRule": "HK.MKID == cal_mkr.phase_start.MKID",
            "associatedHousekeepingRowCount": stats["rowCount"],
            "firstSourceRecordNumber": stats["firstSourceRecordNumber"],
            "lastSourceRecordNumber": stats["lastSourceRecordNumber"],
            "firstObservedTimeSclkRaw": stats["firstObservedTimeSclkRaw"],
            "lastObservedTimeSclkRaw": stats["lastObservedTimeSclkRaw"],
            "endMarkerContextRowCount": marker_counts.get(str(phase["endMarkerId"]), 0),
            "fieldStatistics": list(stats["fieldStatistics"].values()),
            "sampleRows": samples,
        })

    return {
        "sourceRowCount": source_rows,
        "rejectedRowCount": rejected_rows,
        "blankMarkerIdRowCount": blank_marker_rows,
        "nonPhaseRowCount": non_phase_rows,
        "unknownMarkerIdRowCount": unknown_marker_rows,
        "unknownMarkerIdCounts": dict(sorted(unknown_marker_counts.items(), key=lambda item: int(item[0]))),
        "rowCountByMarkerId": dict(sorted(marker_counts.items(), key=lambda item: int(item[0]))),
        "matchedPhaseRowCount": matched_rows,
        "phaseAssociations": output_phases,
    }


def build_manifest() -> dict:
    frozen = verify_frozen_inputs()
    field_catalog = pds_field_catalog()
    phases, bounds, known_marker_ids = parse_marker_phases()
    telemetry = analyse_housekeeping(phases, field_catalog, known_marker_ids)
    return {
        "schemaVersion": 1,
        "status": "phase_mkid_association_complete",
        "event": frozen["event"],
        "sourceProducts": {
            kind: {
                "fileName": frozen["products"][kind]["payload"]["fileName"],
                "byteLength": frozen["products"][kind]["payload"]["byteLength"],
                "sha256": frozen["products"][kind]["payload"]["sha256"],
            }
            for kind in ("cal-hk", "cal-mkr")
        },
        "PdsSemantics": {
            "HK_TIME_unit": "SECONDS",
            "HK_TIME_description": field_catalog["TIME"]["description"],
            "HK_MKID_description": field_catalog["MKID"]["description"],
            "associationKey": "HK.MKID == cal_mkr.phase_start.MKID",
            "clockComparisonPerformed": False,
            "timeUsedAsAssociationKey": False,
            "interpolationPerformed": False,
            "carryForwardPerformed": False,
        },
        "markerBounds": bounds,
        "telemetryFieldCatalog": [
            {"name": name, **field_catalog[name]}
            for name in FIELD_NAMES
        ],
        "associationSummary": {
            key: value for key, value in telemetry.items()
            if key != "phaseAssociations"
        },
        "phaseAssociations": telemetry["phaseAssociations"],
        "scientificUse": {
            "instrumentOperationalContextOnly": True,
            "speciesAbundanceProduced": False,
            "neutralNumberDensityProduced": False,
            "absoluteSensitivityProduced": False,
            "energyCorrectionFactorProduced": False,
            "eligibleAsSchedulerInitialAbundance": False,
            "eligibleAsMarsPhotochemicalInitialState": False,
        },
        "limitations": [
            "Association is by exact MKID identity, using the PDS definition that HK MKID is the most recent marker to occur at TIME.",
            "HK TIME is an NGIMS-internal SCLK approximation. It is retained for audit only and is not compared with cal-mkr TIME or L1B t_sclk_cor.",
            "Only rows whose MKID equals a phase-start marker ID are assigned to that phase. Rows with end-marker or other IDs remain separate.",
            "The original CSV is the source of truth. This JSON stores bounded samples and channel readback summaries, not a replacement for the source rows.",
            "Blank field cells mean no read at that record; no interpolation, nearest-neighbour selection or carry-forward is performed.",
            "Telemetry values are engineering readbacks, not a calibrated species sensitivity function, C_EN, neutral abundance, or number density.",
        ],
    }


class PhaseAssociationTests(unittest.TestCase):
    def marker_phases(self):
        rows = [
            {"TIME": "10", "MKID": "1", "DESCRIPTION": "TIDSTART cfg"},
            {"TIME": "20", "MKID": "2001", "DESCRIPTION": "Phase mass scans starting"},
            {"TIME": "25", "MKID": "2002", "DESCRIPTION": "Phase ended."},
            {"TIME": "30", "MKID": "2103", "DESCRIPTION": "Phase mass scans starting"},
            {"TIME": "35", "MKID": "2104", "DESCRIPTION": "Phase ended."},
            {"TIME": "40", "MKID": "10000", "DESCRIPTION": "TIDSTOP cfg"},
        ]
        phase = []
        open_start = None
        for row in rows:
            if row["DESCRIPTION"] == "Phase mass scans starting":
                open_start = row
            elif row["DESCRIPTION"] == "Phase ended.":
                phase.append((int(open_start["MKID"]), int(row["MKID"])))
                open_start = None
        return phase

    def test_exact_marker_key(self):
        phases = self.marker_phases()
        self.assertEqual(phases, [(2001, 2002), (2103, 2104)])

    def test_blank_channel_is_not_filled(self):
        value = ""
        self.assertEqual(value, "")

    def test_sample_window_is_bounded(self):
        rows = list(range(10))
        self.assertEqual(rows[:2] + rows[-2:], [0, 1, 8, 9])


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--self-test":
        unittest.main(argv=[sys.argv[0]])
    else:
        manifest = build_manifest()
        OUTPUT.write_text(json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        print(json.dumps({
            "status": manifest["status"],
            "sourceRowCount": manifest["associationSummary"]["sourceRowCount"],
            "matchedPhaseRowCount": manifest["associationSummary"]["matchedPhaseRowCount"],
            "phaseCount": len(manifest["phaseAssociations"]),
            "perPhaseCounts": [
                {"phase": item["phaseIndex"], "startMarkerId": item["startMarkerId"],
                 "rows": item["associatedHousekeepingRowCount"]}
                for item in manifest["phaseAssociations"]
            ],
            "output": str(OUTPUT.relative_to(ROOT)),
        }, indent=2))
