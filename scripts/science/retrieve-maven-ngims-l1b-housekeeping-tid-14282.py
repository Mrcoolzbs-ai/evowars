#!/usr/bin/env python3
"""Freeze the three event-matched MAVEN NGIMS L1B housekeeping products.

The products are retained as instrument-operational context only. This script
does not derive a neutral abundance, species sensitivity, C_EN, or a
calibration response matrix from housekeeping data.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import re
import sys
import unittest
import urllib.request
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from pathlib import Path

PDS_NS = "http://pds.nasa.gov/pds4/pds/v1"
DIRECTORIES = (
    "https://atmos.nmsu.edu/PDS/data/PDS4/MAVEN/ngims_bundle/l1b/2014/12/",
    "https://pds-atmospheres.nmsu.edu/PDS/data/PDS4/MAVEN/ngims_bundle/l1b/2014/12/",
)
TID = 14282
ORBIT = 391
EVENT_STEM = "014282_20141211T154406"
OUTPUT = Path("src/modules/Data/mavenNgimsL1bHousekeepingArchive")
MAX_FILE_BYTES = 100_000_000
PRODUCTS = {
    "cal-hk": {"extension": "csv", "kind": "instrument_housekeeping"},
    "cal-mkr": {"extension": "csv", "kind": "instrument_markers"},
    "cal-msg": {"extension": "txt", "kind": "instrument_message_log"},
}
USER_AGENT = "EvoWars-MAVEN-NGIMS-Exact-Housekeeping-Retrieval/1.0"


class LinkParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.hrefs: list[str] = []

    def handle_starttag(self, tag: str, attrs) -> None:
        if tag.lower() == "a":
            href = dict(attrs).get("href")
            if href:
                self.hrefs.append(href)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def request_bytes(url: str, limit: int = MAX_FILE_BYTES) -> tuple[bytes, dict]:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xml,text/csv,text/plain,*/*",
            "Accept-Encoding": "identity",
        },
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        body = response.read(limit + 1)
        if len(body) > limit:
            raise RuntimeError(f"payload exceeds {limit} bytes: {url}")
        return body, {
            "url": url,
            "finalUrl": response.geturl(),
            "httpStatus": response.status,
            "contentType": response.headers.get("Content-Type"),
            "contentLengthHeader": response.headers.get("Content-Length"),
            "byteLength": len(body),
            "sha256": sha256(body),
        }


def matching_filenames(hrefs: list[str]) -> dict[str, dict[str, str]]:
    """Require one exact CSV/TXT payload and one detached XML label per kind."""
    matches: dict[str, dict[str, str]] = {}
    for kind, config in PRODUCTS.items():
        stem = f"mvn_ngi_l1b_{kind}-{EVENT_STEM}"
        pattern = re.compile(
            rf"^{re.escape(stem)}_v\d{{2}}_r\d{{2}}\.(?:{re.escape(config['extension'])}|xml)$",
            re.IGNORECASE,
        )
        candidates = sorted({href.rsplit("/", 1)[-1] for href in hrefs if pattern.match(href.rsplit("/", 1)[-1])})
        payloads = [name for name in candidates if name.lower().endswith("." + config["extension"])]
        labels = [name for name in candidates if name.lower().endswith(".xml")]
        if len(payloads) != 1 or len(labels) != 1:
            raise RuntimeError(
                f"{kind}: expected exactly one {config['extension']} and one XML label, "
                f"found payloads={payloads}, labels={labels}"
            )
        matches[kind] = {"payload": payloads[0], "label": labels[0]}
    return matches


def discover_products() -> tuple[str, dict[str, dict[str, str]], list[dict]]:
    attempts = []
    for directory in DIRECTORIES:
        try:
            page, page_meta = request_bytes(directory, limit=10_000_000)
            parser = LinkParser()
            parser.feed(page.decode("utf-8", errors="replace"))
            names = matching_filenames(parser.hrefs)
            return directory, names, [{"directory": directory, **page_meta}]
        except Exception as error:
            attempts.append({"directory": directory, "error": str(error)})
    raise RuntimeError("could not discover the exact event-matched housekeeping products: " + json.dumps(attempts))


def qname(name: str) -> str:
    return "{" + PDS_NS + "}" + name


def direct_scalar(parent: ET.Element, name: str, optional: bool = False) -> str | None:
    nodes = [node for node in list(parent) if node.tag == qname(name)]
    if optional and not nodes:
        return None
    if len(nodes) != 1 or list(nodes[0]):
        raise RuntimeError(f"expected one direct PDS4 scalar {name}; found {len(nodes)}")
    value = (nodes[0].text or "").strip()
    if not value and not optional:
        raise RuntimeError(f"PDS4 scalar {name} is empty")
    return value or None


def validate_label(xml_bytes: bytes, payload_bytes: bytes, payload_name: str, product_kind: str) -> dict:
    root = ET.fromstring(xml_bytes)
    if root.tag != qname("Product_Observational"):
        raise RuntimeError(f"{product_kind}: detached label root is not PDS4 Product_Observational")

    identification = [node for node in root.iter() if node.tag == qname("Identification_Area")]
    if len(identification) != 1 or identification[0] not in list(root):
        raise RuntimeError(f"{product_kind}: expected one direct Identification_Area")
    logical_id = direct_scalar(identification[0], "logical_identifier")
    expected_id = (
        "urn:nasa:pds:maven_ngims:l1b:"
        f"mvn_ngi_l1b_{product_kind}-{EVENT_STEM.lower()}"
    )
    if logical_id != expected_id:
        raise RuntimeError(f"{product_kind}: logical_identifier mismatch: {logical_id}")

    file_candidates = []
    for node in root.iter():
        if node.tag == qname("File"):
            file_name = direct_scalar(node, "file_name", optional=True)
            if file_name == payload_name:
                file_candidates.append(node)
    if len(file_candidates) != 1:
        raise RuntimeError(f"{product_kind}: expected one File entry for {payload_name}; found {len(file_candidates)}")

    file_node = file_candidates[0]
    size_text = direct_scalar(file_node, "file_size")
    size_nodes = [node for node in list(file_node) if node.tag == qname("file_size")]
    if len(size_nodes) != 1 or size_nodes[0].attrib.get("unit") != "byte":
        raise RuntimeError(f"{product_kind}: file_size must use byte units")
    declared_size = int(size_text or "")
    if declared_size <= 0:
        raise RuntimeError(f"{product_kind}: file_size must be positive")
    md5_label = direct_scalar(file_node, "md5_checksum", optional=True)
    md5_computed = hashlib.md5(payload_bytes).hexdigest()
    if md5_label and not re.fullmatch(r"[0-9a-fA-F]{32}", md5_label):
        raise RuntimeError(f"{product_kind}: malformed PDS4 md5_checksum")

    size_matches = declared_size == len(payload_bytes)
    md5_matches = md5_label is not None and md5_computed == md5_label.lower()
    md5_status = (
        "verified_against_detached_label" if md5_matches
        else "not_present_in_detached_label" if md5_label is None
        else "mismatch_forensic_only"
    )
    forensic_only = not size_matches or not md5_matches
    return {
        "logicalIdentifier": logical_id,
        "payloadFileName": payload_name,
        "payloadByteLength": len(payload_bytes),
        "labelDeclaredFileSizeBytes": declared_size,
        "sizeDifferenceBytes": declared_size - len(payload_bytes),
        "fileSizeStatus": "matches_detached_label" if size_matches else "mismatch_forensic_only",
        "md5Label": md5_label,
        "md5Computed": md5_computed,
        "md5Status": md5_status,
        "payloadSha256": sha256(payload_bytes),
        "labelSha256": sha256(xml_bytes),
        "detachedLabelAuthenticity": "not_independently_authenticated",
        "forensicOnly": forensic_only,
    }


def summarize_csv(data: bytes) -> dict:
    text = data.decode("utf-8-sig", errors="replace")
    reader = csv.reader(io.StringIO(text, newline=""))
    try:
        headers = next(reader)
    except StopIteration:
        return {"status": "empty"}
    row_count = 0
    malformed_width_count = 0
    first_rows = []
    last_row = None
    width = len(headers)
    for row in reader:
        if not row:
            continue
        row_count += 1
        if len(row) != width:
            malformed_width_count += 1
        if len(first_rows) < 2:
            first_rows.append(row)
        last_row = row
    return {
        "status": "summarized",
        "columnCount": width,
        "columnNames": headers,
        "rowCount": row_count,
        "malformedFieldCountRows": malformed_width_count,
        "firstRows": first_rows,
        "lastRow": last_row,
        "textDecodeReplacementPresent": "\ufffd" in text,
    }


def summarize_message_log(data: bytes) -> dict:
    text = data.decode("utf-8", errors="replace")
    lines = text.splitlines()
    return {
        "status": "summarized",
        "lineCount": len(lines),
        "characterCount": len(text),
        "firstLines": lines[:8],
        "lastLines": lines[-8:],
        "textDecodeReplacementPresent": "\ufffd" in text,
    }


def retrieve() -> dict:
    directory, files, attempts = discover_products()
    products = {}
    downloaded = {}
    for kind, names in files.items():
        payload_name = names["payload"]
        label_name = names["label"]
        payload_url = directory + payload_name
        label_url = directory + label_name
        payload, payload_http = request_bytes(payload_url)
        label, label_http = request_bytes(label_url, limit=2_000_000)
        integrity = validate_label(label, payload, payload_name, kind)
        config = PRODUCTS[kind]
        summary = summarize_csv(payload) if config["extension"] == "csv" else summarize_message_log(payload)
        products[kind] = {
            "kind": config["kind"],
            "payload": {**payload_http, "fileName": payload_name},
            "label": {**label_http, "fileName": label_name},
            "pds4Integrity": integrity,
            "contentSummary": summary,
            "scientificUse": {
                "role": "instrument_operational_context",
                "speciesAbundanceProduced": False,
                "neutralNumberDensityProduced": False,
                "absoluteSensitivityProduced": False,
                "energyCorrectionFactorProduced": False,
                "eligibleAsSchedulerInitialAbundance": False,
                "eligibleAsMarsPhotochemicalInitialState": False,
            },
        }
        downloaded[payload_name] = payload
        downloaded[label_name] = label

    manifest = {
        "schemaVersion": 1,
        "status": "retrieved_and_label_checked",
        "retrievedAtUtc": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
        "sourceDirectory": directory,
        "directoryDiscoveryAttempts": attempts,
        "event": {
            "tid": TID,
            "orbit": ORBIT,
            "eventKey": EVENT_STEM,
            "eventStartUtc": "2014-12-11T15:45:25Z",
            "eventStopUtc": "2014-12-11T17:29:43Z",
            "matchingProductTimeToken": "2014-12-11T15:44:06",
        },
        "products": products,
        "interpretation": {
            "productsAreEventMatchedByTIDAndFilenameTime": True,
            "housekeepingIsNotNeutralAbundance": True,
            "instrumentSignalsAreNotDensity": True,
            "calibrationSensitivityNotDerived": True,
            "energyCorrectionFactorNotDerived": True,
            "responseOrFragmentationMatrixNotDerived": True,
            "focusModesMustRemainSeparate": True,
            "notes": [
                "cal-hk is an instrument housekeeping packet product.",
                "cal-mkr is an instrument marker product; its rows are event markers, not abundance.",
                "cal-msg is an instrument message log, not a calibration constant table.",
                "The products are retained for time/context QA only; no scientific calibration is inferred.",
                "A missing PDS4 MD5 or a file_size mismatch keeps that exact product forensic-only.",
            ],
        },
    }

    OUTPUT.mkdir(parents=True, exist_ok=True)
    for name, data in downloaded.items():
        (OUTPUT / name).write_bytes(data)
    (OUTPUT / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({
        "status": manifest["status"],
        "outputDirectory": str(OUTPUT),
        "products": {
            kind: {
                "payload": entry["payload"]["fileName"],
                "payloadBytes": entry["payload"]["byteLength"],
                "sha256": entry["payload"]["sha256"],
                "fileSizeStatus": entry["pds4Integrity"]["fileSizeStatus"],
                "md5Status": entry["pds4Integrity"]["md5Status"],
                "rowCount": entry["contentSummary"].get("rowCount"),
                "lineCount": entry["contentSummary"].get("lineCount"),
            }
            for kind, entry in products.items()
        },
    }, ensure_ascii=False, indent=2))


class HousekeepingRetrievalSelfTests(unittest.TestCase):
    def test_exact_product_name_discovery(self) -> None:
        names = [
            "mvn_ngi_l1b_cal-hk-014282_20141211T154406_v01_r02.csv",
            "mvn_ngi_l1b_cal-hk-014282_20141211T154406_v01_r02.xml",
            "mvn_ngi_l1b_cal-mkr-014282_20141211T154406_v01_r02.csv",
            "mvn_ngi_l1b_cal-mkr-014282_20141211T154406_v01_r02.xml",
            "mvn_ngi_l1b_cal-msg-014282_20141211T154406_v01_r02.txt",
            "mvn_ngi_l1b_cal-msg-014282_20141211T154406_v01_r02.xml",
            "mvn_ngi_l1b_osnb-14282_20141211T154406_v09_r01.csv",
        ]
        result = matching_filenames(names)
        self.assertEqual(set(result), {"cal-hk", "cal-mkr", "cal-msg"})
        self.assertTrue(result["cal-msg"]["payload"].endswith(".txt"))

    def test_ambiguous_version_fails_closed(self) -> None:
        names = [
            "mvn_ngi_l1b_cal-mkr-014282_20141211T154406_v01_r02.csv",
            "mvn_ngi_l1b_cal-mkr-014282_20141211T154406_v02_r01.csv",
            "mvn_ngi_l1b_cal-mkr-014282_20141211T154406_v01_r02.xml",
        ]
        with self.assertRaises(RuntimeError):
            matching_filenames(names)

    def test_csv_summary_does_not_drop_headers_or_rows(self) -> None:
        summary = summarize_csv(b"t_utc,mass\n2014-12-11T17:04:00,16\n")
        self.assertEqual(summary["columnNames"], ["t_utc", "mass"])
        self.assertEqual(summary["rowCount"], 1)
        self.assertEqual(summary["malformedFieldCountRows"], 0)

    def test_message_log_summary_is_bounded(self) -> None:
        summary = summarize_message_log(b"one\ntwo\nthree\n")
        self.assertEqual(summary["lineCount"], 3)
        self.assertEqual(summary["firstLines"], ["one", "two", "three"])


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--self-test":
        unittest.main(argv=[sys.argv[0]])
    else:
        retrieve()
