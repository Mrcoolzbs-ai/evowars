#!/usr/bin/env python3
"""Retrieve one exact MAVEN NGIMS L1B OSNB calibrated science product.

Trigger with [retrieve-ngims-l1b-osnb-14282].
The product is identified by the official NGIMS L1B index and exact event
window/orbit. The script locates the CSV/XML partner from the official PDS4
directory (or narrow version/revision probes), validates the detached label,
preserves byte-identical source files, and produces a mass-channel audit.
L1B counts/cps are not converted to neutral abundance.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from html.parser import HTMLParser

PDS_NAMESPACE = "http://pds.nasa.gov/pds4/pds/v1"
DIRECTORIES = [
    "https://atmos.nmsu.edu/PDS/data/PDS4/MAVEN/ngims_bundle/l1b/2014/12/",
    "https://pds-atmospheres.nmsu.edu/PDS/data/PDS4/MAVEN/ngims_bundle/l1b/2014/12/",
]
PRODUCT_ID = "urn:nasa:pds:maven_ngims:l1b:mvn_ngi_l1b_osnb-14282_20141211t154406"
STEM = "mvn_ngi_l1b_osnb-14282_20141211T154406"
EVENT_START = "2014-12-11T15:45:25Z"
EVENT_STOP = "2014-12-11T17:29:43Z"
ORBIT = 391
TID = 14282
FOCUS_MODE = "osnb"
MAX_FILE_BYTES = 100_000_000
OUTPUT = Path("src/modules/Data/mavenNgimsL1bArchive")


class Links(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.hrefs: list[str] = []

    def handle_starttag(self, tag: str, attrs) -> None:
        if tag.lower() == "a":
            value = dict(attrs).get("href")
            if value:
                self.hrefs.append(value)


def request_bytes(url: str, max_bytes: int = MAX_FILE_BYTES) -> tuple[bytes, dict]:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "EvoWars-NGIMS-L1B-Exact-Product-Retrieval/1.0",
            "Accept": "text/html,application/xml,text/csv,text/plain,application/octet-stream,*/*",
            "Accept-Encoding": "identity",
        },
    )
    with urllib.request.urlopen(req, timeout=90) as response:
        if response.status != 200:
            raise RuntimeError(f"HTTP {response.status}: {url}")
        body = response.read(max_bytes + 1)
        if len(body) > max_bytes:
            raise RuntimeError(f"payload exceeds {max_bytes} bytes: {url}")
        return body, {
            "url": url,
            "httpStatus": response.status,
            "finalUrl": response.geturl(),
            "contentType": response.headers.get("Content-Type"),
            "contentLengthHeader": response.headers.get("Content-Length"),
            "byteLength": len(body),
            "sha256": hashlib.sha256(body).hexdigest(),
        }


def discover_directory() -> tuple[str, list[str], list[dict]]:
    attempts = []
    for directory in DIRECTORIES:
        try:
            body, meta = request_bytes(directory, max_bytes=10_000_000)
            html = body.decode("utf-8", errors="replace")
            parser = Links()
            parser.feed(html)
            matching = sorted({
                href for href in parser.hrefs
                if STEM.lower() in href.lower()
                and (href.lower().endswith(".csv") or href.lower().endswith(".xml"))
            })
            return directory, matching, [{"directory": directory, **meta}]
        except Exception as error:
            attempts.append({"directory": directory, "error": str(error)})
    return "", [], attempts


def probe_versions() -> tuple[str, list[str], list[dict]]:
    # Product index rows do not publish version/revision suffixes. Probe only
    # the exact stem and bounded PDS4 version/revision combinations.
    candidates = []
    for version in range(1, 13):
        for revision in range(1, 4):
            for extension in ("csv", "xml"):
                candidates.append(
                    f"{STEM}_v{version:02d}_r{revision:02d}.{extension}"
                )
    bases = [DIRECTORIES[0], DIRECTORIES[1]]
    urls = [(base, name) for base in bases for name in candidates]
    found: dict[str, tuple[str, dict]] = {}
    attempts: list[dict] = []

    def head_one(pair):
        base, name = pair
        url = base + name
        req = urllib.request.Request(
            url,
            method="HEAD",
            headers={"User-Agent": "EvoWars-NGIMS-L1B-Exact-Product-Retrieval/1.0"},
        )
        try:
            with urllib.request.urlopen(req, timeout=15) as response:
                length = response.headers.get("Content-Length")
                return name, url, {
                    "httpStatus": response.status,
                    "contentType": response.headers.get("Content-Type"),
                    "contentLengthHeader": length,
                }, None
        except HTTPError as error:
            return name, url, None, {"status": error.code, "reason": str(error.reason)}
        except Exception as error:
            return name, url, None, {"error": str(error)}

    with ThreadPoolExecutor(max_workers=24) as pool:
        futures = [pool.submit(head_one, pair) for pair in urls]
        for future in as_completed(futures):
            name, url, headers, error = future.result()
            if headers is not None:
                found.setdefault(name, (url, headers))
            elif error and error.get("status") not in (404, 410):
                attempts.append({"url": url, **error})
    candidates_found = []
    for name, (url, headers) in sorted(found.items()):
        candidates_found.append(url)
        attempts.append({"url": url, "head": headers})
    return (DIRECTORIES[0], candidates_found, attempts)


def qname(name: str) -> str:
    return "{" + PDS_NAMESPACE + "}" + name


def scalar(parent: ET.Element, name: str, optional: bool = False) -> str | None:
    all_matches = [node for node in parent.iter() if node.tag == qname(name)]
    direct = [node for node in list(parent) if node.tag == qname(name)]
    if optional and not all_matches:
        return None
    if len(all_matches) != 1 or len(direct) != 1 or list(direct[0]):
        raise RuntimeError(f"expected exactly one direct scalar PDS4 {name}; found total={len(all_matches)}, direct={len(direct)}")
    value = (direct[0].text or "").strip()
    if not value and not optional:
        raise RuntimeError(f"PDS4 {name} is empty")
    return value or None


def validate_label(xml_bytes: bytes, csv_bytes: bytes, csv_name: str) -> tuple[dict, dict]:
    root = ET.fromstring(xml_bytes)
    if root.tag != qname("Product_Observational"):
        raise RuntimeError("L1B label root is not PDS4 Product_Observational")

    ids = [node for node in root.iter() if node.tag == qname("Identification_Area")]
    areas = [node for node in root.iter() if node.tag == qname("File_Area_Observational")]
    if len(ids) != 1 or ids[0] not in list(root):
        raise RuntimeError("label must contain exactly one direct Identification_Area")
    if len(areas) != 1 or areas[0] not in list(root):
        raise RuntimeError("label must contain exactly one direct File_Area_Observational")
    files = [node for node in areas[0].iter() if node.tag == qname("File")]
    if len(files) != 1 or files[0] not in list(areas[0]):
        raise RuntimeError("label must contain exactly one direct File entry")

    product_id = scalar(ids[0], "logical_identifier")
    file_node = files[0]
    file_name = scalar(file_node, "file_name")
    file_size_text = scalar(file_node, "file_size")
    size_node = next(node for node in list(file_node) if node.tag == qname("file_size"))
    if size_node.attrib.get("unit") != "byte":
        raise RuntimeError('file_size must have unit="byte"')
    md5_label = scalar(file_node, "md5_checksum", optional=True)
    if product_id != PRODUCT_ID:
        raise RuntimeError(f"logical_identifier mismatch: {product_id}")
    if file_name != csv_name:
        raise RuntimeError(f"file_name mismatch: {file_name}")
    declared_size = int(file_size_text or "")
    if declared_size <= 0:
        raise RuntimeError("file_size must be positive")

    size_match = declared_size == len(csv_bytes)
    md5_computed = hashlib.md5(csv_bytes).hexdigest()
    if md5_label is not None:
        if not re.fullmatch(r"[a-f0-9]{32}", md5_label, re.I):
            raise RuntimeError("invalid PDS4 md5_checksum syntax")
        if md5_computed != md5_label.lower():
            raise RuntimeError("downloaded CSV MD5 mismatch with PDS4 label")
    elif not size_match:
        raise RuntimeError(
            f"file_size mismatch without md5_checksum: label={declared_size}, CSV={len(csv_bytes)}"
        )

    if not size_match and md5_label is None:
        raise RuntimeError("size mismatch with no MD5 cannot be accepted for a scientific import")

    provenance = {
        "productId": product_id,
        "csvFileName": file_name,
        "csvByteLength": len(csv_bytes),
        "labelDeclaredFileSizeBytes": declared_size,
        "csvSizeConsistencyStatus": "matches_label" if size_match else "mismatch_with_md5_verified",
        "md5Checksum": md5_label,
        "md5ChecksumStatus": "verified_against_detached_label" if md5_label else "not_present_in_detached_label",
        "csvSha256": hashlib.sha256(csv_bytes).hexdigest(),
        "xmlSha256": hashlib.sha256(xml_bytes).hexdigest(),
        "detachedLabelAuthenticity": "not_independently_authenticated",
    }

    data_text = csv_bytes.decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(data_text, newline=""))
    if reader.fieldnames is None:
        raise RuntimeError("L1B CSV has no header")
    headers = [h.strip().lower() for h in reader.fieldnames]
    aliases = {
        "focus_mode": "focusmode",
        "temperature_s": "temperature_s",
    }
    normalized = [aliases.get(h, h) for h in headers]
    rows = []
    mass_counts: Counter[str] = Counter()
    focus_counts: Counter[str] = Counter()
    orbit_counts: Counter[str] = Counter()
    tid_counts: Counter[str] = Counter()
    time_values: list[float] = []
    selected_tids = 0
    selected_rows = 0
    rejected_rows = 0
    speciesless_mass_channels: Counter[str] = Counter()
    numeric_fields: Counter[str] = Counter()
    minmax: dict[str, dict[str, float]] = {}

    # Process by raw header names; preserve every column and do not infer
    # molecular identities from m/z alone.
    for raw in reader:
        row = {str(k).strip().lower(): (v or "").strip() for k, v in raw.items()}
        def number(key: str) -> float | None:
            value = row.get(key) or row.get("focus_mode")
            try:
                return float(value) if value not in ("", "nan", "NaN") else None
            except ValueError:
                return None

        tid = number("tid")
        orbit = number("orbit")
        if tid is None or orbit is None:
            rejected_rows += 1
            continue
        if int(tid) != TID or int(orbit) != ORBIT:
            continue
        selected_tids += 1
        selected_rows += 1
        focus = row.get("focus_mode", row.get("focusmode", "")).lower()
        if focus:
            focus_counts[focus] += 1
        try:
            mass = float(row.get("mass", ""))
            if mass.is_integer():
                mass_key = str(int(mass))
            else:
                mass_key = format(mass, ".6g")
            mass_counts[mass_key] += 1
        except ValueError:
            pass
        try:
            unix_time = float(row.get("t_unix", ""))
            time_values.append(unix_time)
        except ValueError:
            pass
        for field in ("counts", "cps_raw", "cps_raw_bkgd", "cps_dt", "cps_dt_bkgd", "abundance"):
            try:
                value = float(row[field])
            except (KeyError, ValueError):
                continue
            numeric_fields[field] += 1
            if field not in minmax:
                minmax[field] = {"min": value, "max": value}
            else:
                minmax[field]["min"] = min(minmax[field]["min"], value)
                minmax[field]["max"] = max(minmax[field]["max"], value)
        # Keep a compact audit subset for masses relevant to neutral species
        # and their known fragments; m/z values are candidate channels only.
        try:
            m = float(row.get("mass", ""))
            if m in {14, 15, 16, 28, 29, 30, 32, 40, 44}:
                rows.append({k: row.get(k, "") for k in [
                    "t_unix", "t_sclk", "t_tid", "tid", "orbit",
                    "focus_mode", "mass", "counts", "cps_raw",
                    "cps_raw_bkgd", "cps_dt", "cps_dt_bkgd"
                ]})
        except ValueError:
            pass

    if selected_tids == 0:
        raise RuntimeError("no L1B data rows for exact TID14282/orbit391 found in downloaded CSV")

    time_start = min(time_values) if time_values else None
    time_stop = max(time_values) if time_values else None
    manifest = {
        "product": provenance,
        "source": "NASA PDS4 MAVEN NGIMS L1B calibrated science data",
        "event": {
            "tid": TID,
            "orbit": ORBIT,
            "focusModeExpected": FOCUS_MODE,
            "timeStartUtc": EVENT_START,
            "timeStopUtc": EVENT_STOP,
        },
        "csv": {
            "sourceHeaders": headers,
            "sourceHeaderAliases": aliases,
            "rowCountForTargetTidOrbit": selected_rows,
            "focusModeCounts": dict(focus_counts),
            "massChannelRowCounts": dict(mass_counts),
            "unixTimeMin": time_start,
            "unixTimeMax": time_stop,
            "numericColumnValueCounts": dict(numeric_fields),
            "numericColumnMinMax": minmax,
            "selectedMassChannelAuditRows": rows[:5000],
            "selectedMassChannelAuditRowCount": len(rows),
        },
        "interpretation": {
            "l1bIsCalibratedInstrumentSignal": True,
            "notL2NeutralAbundance": True,
            "mOverZNotUniqueSpeciesIdentifier": True,
            "massChannelCountsAndCpsAreNotNumberDensity": True,
            "requiresCalibrationResponseAndFragmentationModel": True,
            "noConversionToParticlesPerCm3Applied": True,
            "noOOrNoNeutralAbundanceClaim": True,
        },
    }
    return provenance, manifest


def main() -> int:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    directory, listing_candidates, listing_attempts = discover_directory()
    discovered_from_listing = bool(listing_candidates)
    candidates = listing_candidates
    attempts = listing_attempts
    if not candidates:
        _, candidates, probe_attempts = probe_versions()
        attempts.extend(probe_attempts)

    # Filter candidate URLs to CSV/XML versions where both partners can exist.
    csv_urls = [url for url in candidates if url.lower().endswith(".csv")]
    xml_urls = [url[:-4] + ".xml" for url in csv_urls]
    if not csv_urls:
        # Preserve directory and probe evidence even when the source service
        # blocks listing/HEAD. Do not silently assume a guessed URL exists.
        result = {
            "status": "product_not_located",
            "productId": PRODUCT_ID,
            "directory": directory,
            "directoryListingCandidates": listing_candidates,
            "versionProbeAttempts": attempts,
            "officialIndexEvidence": {
                "eventStart": EVENT_START,
                "eventStop": EVENT_STOP,
                "orbit": ORBIT,
                "tid": TID,
                "focusMode": FOCUS_MODE,
                "closestApproachUtc": "2014-12-11T17:15:29Z",
                "indexProductSizeMb": 13.949,
            },
        }
        (OUTPUT / "l1b-osnb-retrieval-probe.json").write_text(
            json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True) + "\\n",
            encoding="utf-8",
        )
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0

    failures = []
    for csv_url in csv_urls:
        xml_url = csv_url[:-4] + ".xml"
        try:
            csv_bytes, csv_meta = request_bytes(csv_url)
            xml_bytes, xml_meta = request_bytes(xml_url, max_bytes=5_000_000)
            csv_name = csv_url.rsplit("/", 1)[-1]
            provenance, detail = validate_label(xml_bytes, csv_bytes, csv_name)
            (OUTPUT / csv_name).write_bytes(csv_bytes)
            (OUTPUT / xml_url.rsplit("/", 1)[-1]).write_bytes(xml_bytes)
            result = {
                "status": "retrieved_and_pds4_label_checked",
                "directory": directory,
                "discoveredFromDirectoryListing": discovered_from_listing,
                "csvHttp": csv_meta,
                "xmlHttp": xml_meta,
                "productManifest": detail,
                "attempts": attempts,
            }
            (OUTPUT / "l1b-osnb-tid-14282-manifest.json").write_text(
                json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True) + "\\n",
                encoding="utf-8",
            )
            print(json.dumps(result, ensure_ascii=False, indent=2))
            return 0
        except Exception as error:
            failures.append({"csvUrl": csv_url, "xmlUrl": xml_url, "error": str(error)})

    result = {
        "status": "candidate_urls_failed_product_fetch_or_PDS4_validation",
        "productId": PRODUCT_ID,
        "directory": directory,
        "candidateCsvUrls": csv_urls,
        "failures": failures,
        "attempts": attempts,
    }
    (OUTPUT / "l1b-osnb-retrieval-probe.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True) + "\\n",
        encoding="utf-8",
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1)
