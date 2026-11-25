#!/usr/bin/env python3
"""Retrieve the co-event NGIMS L3 scale-height/temperature product for TID 14282.

Trigger with a commit subject containing [import-ngims-sht-tid-14282].
The archive member is preserved byte-for-byte; PDS4 label size/MD5 checks
are reported without silently repairing any discrepancy. Scale-height
temperature is a species-specific fit, not a pointwise thermometer.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import re
import sys
import tarfile
import urllib.request
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

ARCHIVE_URL = "https://atmos.nmsu.edu/PDS/data/PDS4/MAVEN/ngims_derivedL3_2014.tar.gz"
ARCHIVE_NAME = "ngims_derivedL3_2014.tar.gz"
PRODUCT_ID = "urn:nasa:pds:maven_ngims:l3:mvn_ngi_l3_res-sht-14282_20141211t154406"
PRODUCT_STEM = "mvn_ngi_l3_res-sht-14282_20141211t154406"
PDS_NS = "http://pds.nasa.gov/pds4/pds/v1"
OUTPUT_DIR = Path("src/modules/Data/mavenNgimsShtArchive")
MAX_ARCHIVE_BYTES = 20_000_000
MAX_PRODUCT_BYTES = 1_000_000
REQUIRED_COLUMNS = [
    "t_utc", "t_unix", "t_sclk", "t_tid", "tid", "orbit", "exo_alt",
    "mass", "species", "scale_height", "scale_height_error",
    "temperature", "temperature_error", "fit_residual", "quality"
]


def fail(message: str) -> "None":
    raise RuntimeError(message)


def download_archive() -> tuple[bytes, dict]:
    request = urllib.request.Request(
        ARCHIVE_URL,
        headers={
            "User-Agent": "EvoWars-Scientific-Archive-Importer/1.0",
            "Accept": "application/x-gzip,application/octet-stream,*/*",
            "Accept-Encoding": "identity",
        },
    )
    with urllib.request.urlopen(request, timeout=90) as response:
        if response.status != 200:
            fail(f"HTTP {response.status} retrieving {ARCHIVE_NAME}")
        payload = response.read(MAX_ARCHIVE_BYTES + 1)
        if len(payload) > MAX_ARCHIVE_BYTES:
            fail(f"{ARCHIVE_NAME} exceeds safety limit")
        return payload, {
            "url": ARCHIVE_URL,
            "fileName": ARCHIVE_NAME,
            "httpStatus": response.status,
            "httpContentType": response.headers.get("Content-Type"),
            "httpContentLength": response.headers.get("Content-Length"),
            "byteLength": len(payload),
            "sha256": hashlib.sha256(payload).hexdigest(),
        }


def extract_member(archive: tarfile.TarFile, name: str) -> tuple[bytes, str]:
    matches = [
        member for member in archive.getmembers()
        if Path(member.name).name.lower() == name.lower() and member.isfile()
    ]
    if len(matches) != 1:
        fail(f"expected exactly one archive member {name}; found {len(matches)}")
    member = matches[0]
    if member.size <= 0 or member.size > MAX_PRODUCT_BYTES:
        fail(f"disallowed size for {member.name}: {member.size}")
    stream = archive.extractfile(member)
    if stream is None:
        fail(f"cannot extract {member.name}")
    payload = stream.read(MAX_PRODUCT_BYTES + 1)
    if len(payload) != member.size or len(payload) > MAX_PRODUCT_BYTES:
        fail(f"byte count mismatch extracting {member.name}")
    return payload, member.name


def q(name: str) -> str:
    return "{" + PDS_NS + "}" + name


def one_scalar(parent: ET.Element, name: str, *, optional: bool = False) -> str | None:
    all_matches = [node for node in parent.iter() if node.tag == q(name)]
    direct = [node for node in list(parent) if node.tag == q(name)]
    if optional and not all_matches:
        return None
    if len(all_matches) != 1 or len(direct) != 1 or list(direct[0]):
        fail(f"expected one direct scalar PDS4 {name}")
    value = (direct[0].text or "").strip()
    if not value and not optional:
        fail(f"PDS4 {name} is empty")
    return value or None


def audit_label(xml_bytes: bytes, csv_bytes: bytes, expected_csv: str) -> dict:
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError as error:
        fail(f"malformed PDS4 XML: {error}")
    if root.tag != q("Product_Observational"):
        fail("PDS4 root must be Product_Observational")
    ids = [node for node in root.iter() if node.tag == q("Identification_Area")]
    fas = [node for node in root.iter() if node.tag == q("File_Area_Observational")]
    if len(ids) != 1 or ids[0] not in list(root):
        fail("expected one direct-child Identification_Area")
    if len(fas) != 1 or fas[0] not in list(root):
        fail("expected one direct-child File_Area_Observational")
    files = [node for node in fas[0].iter() if node.tag == q("File")]
    direct_files = [node for node in list(fas[0]) if node.tag == q("File")]
    if len(files) != 1 or len(direct_files) != 1:
        fail("expected one direct-child File")
    file_node = direct_files[0]
    logical_id = one_scalar(ids[0], "logical_identifier")
    file_name = one_scalar(file_node, "file_name")
    file_size_text = one_scalar(file_node, "file_size")
    size_node = next(node for node in list(file_node) if node.tag == q("file_size"))
    if size_node.attrib.get("unit") != "byte":
        fail('file_size must declare unit="byte"')
    if logical_id != PRODUCT_ID or file_name != expected_csv:
        fail(f"product identity mismatch: {logical_id} / {file_name}")
    try:
        declared_size = int(file_size_text or "")
    except ValueError:
        fail("file_size is not an integer")
    if declared_size <= 0:
        fail("file_size must be positive")
    md5_text = one_scalar(file_node, "md5_checksum", optional=True)
    md5_status = "not_present_in_detached_label"
    md5_value = None
    if md5_text is not None:
        if not re.fullmatch(r"[0-9a-fA-F]{32}", md5_text):
            fail("md5_checksum must be 32 hex characters")
        md5_value = hashlib.md5(csv_bytes).hexdigest()
        if md5_value != md5_text.lower():
            fail("CSV MD5 does not match detached PDS4 label")
        md5_status = "verified_against_detached_label"
    return {
        "productId": logical_id,
        "csvFileName": file_name,
        "csvByteLength": len(csv_bytes),
        "labelDeclaredFileSizeBytes": declared_size,
        "csvSizeConsistencyStatus": (
            "matches_detached_label_file_size" if declared_size == len(csv_bytes)
            else "mismatch_quarantined_no_md5" if md5_text is None
            else "mismatch_md5_verified"
        ),
        "csvSha256": hashlib.sha256(csv_bytes).hexdigest(),
        "csvMd5Checksum": md5_value,
        "csvMd5ChecksumStatus": md5_status,
        "xmlSha256": hashlib.sha256(xml_bytes).hexdigest(),
        "detachedLabelAuthenticity": "not_independently_authenticated",
    }


def summarize(csv_bytes: bytes) -> dict:
    try:
        text = csv_bytes.decode("utf-8-sig")
    except UnicodeDecodeError as error:
        fail(f"CSV is not UTF-8/ASCII-compatible: {error}")
    reader = csv.DictReader(io.StringIO(text, newline=""))
    if reader.fieldnames is None:
        fail("CSV header missing")
    headers = [item.strip().lower() for item in reader.fieldnames]
    if headers != REQUIRED_COLUMNS:
        fail(f"unexpected Table A-10 header: {headers}")

    raw_species: Counter[str] = Counter()
    raw_quality: Counter[str] = Counter()
    raw_orbits: Counter[str] = Counter()
    raw_tids: Counter[str] = Counter()
    candidates: dict[tuple[str, str], list[dict]] = defaultdict(list)
    accepted_rows = 0
    rejected_rows = 0
    timestamps: list[datetime] = []

    for record_number, values in enumerate(reader, start=1):
        row = {str(k).strip().lower(): (v or "").strip() for k, v in values.items()}
        species = row.get("species", "").strip()
        quality = row.get("quality", "").strip().upper()
        if species:
            raw_species[species] += 1
        if quality:
            raw_quality[quality] += 1
        try:
            tid = int(row["tid"])
            orbit = int(row["orbit"])
            unix = float(row["t_unix"])
            sclk = float(row["t_sclk"])
            elapsed = float(row["t_tid"])
            altitude = float(row["exo_alt"])
            mass = float(row["mass"])
            scale_height = float(row["scale_height"])
            scale_error = float(row["scale_height_error"])
            temperature = float(row["temperature"])
            temperature_error = float(row["temperature_error"])
            residual = float(row["fit_residual"])
            parsed = datetime.fromisoformat(row["t_utc"].replace("Z", "+00:00"))
        except (KeyError, TypeError, ValueError):
            rejected_rows += 1
            continue
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        parsed = parsed.astimezone(timezone.utc)
        if (
            tid != 14282 or orbit != 391 or unix < 0 or sclk < 0 or elapsed < 0 or
            altitude <= 0 or mass < 2 or mass > 150 or
            scale_error < 0 or temperature_error < 0 or residual < 0 or residual > 500 or
            quality not in {"HI", "HW", "HA", "H0"} or
            (quality != "H0" and (scale_height <= 0 or temperature <= 0))
        ):
            rejected_rows += 1
            continue
        accepted_rows += 1
        timestamps.append(parsed)
        if quality != "H0":
            candidates[(species, quality)].append({
                "timeUtc": parsed.isoformat().replace("+00:00", "Z"),
                "exobaseAltitudeKm": altitude,
                "massAmu": mass,
                "scaleHeightKm": scale_height,
                "scaleHeightFitErrorKm": scale_error,
                "scaleHeightTemperatureK": temperature,
                "temperatureFitErrorK": temperature_error,
                "fitResidual": residual,
                "qualityFlag": quality,
            })

    summaries = []
    for (species, quality), rows in sorted(candidates.items()):
        summaries.append({
            "species": species,
            "qualityFlag": quality,
            "rowCount": len(rows),
            "timeStartUtc": min(row["timeUtc"] for row in rows),
            "timeStopUtc": max(row["timeUtc"] for row in rows),
            "exobaseAltitudeRangeKm": [
                min(row["exobaseAltitudeKm"] for row in rows),
                max(row["exobaseAltitudeKm"] for row in rows)
            ],
            "scaleHeightRangeKm": [
                min(row["scaleHeightKm"] for row in rows),
                max(row["scaleHeightKm"] for row in rows)
            ],
            "derivedTemperatureRangeK": [
                min(row["scaleHeightTemperatureK"] for row in rows),
                max(row["scaleHeightTemperatureK"] for row in rows)
            ],
            "fitResidualRange": [
                min(row["fitResidual"] for row in rows),
                max(row["fitResidual"] for row in rows)
            ],
            "fitQuality": (
                "good_near_isothermic_fit" if quality == "HI" else
                "structured_or_wavy_fit" if quality == "HW" else
                "high_altitude_fit"
            )
        })
    return {
        "schema": "NGIMS SIS Rev. 1.13 Table A-10",
        "sourceHeaders": headers,
        "rowCount": accepted_rows + rejected_rows,
        "acceptedRows": accepted_rows,
        "rejectedRows": rejected_rows,
        "rawSpeciesRowCounts": dict(raw_species),
        "rawQualityFlagCounts": dict(raw_quality),
        "rawOrbitCounts": dict(raw_orbits),
        "rawTidCounts": dict(raw_tids),
        "timeStartUtc": min(timestamps).isoformat().replace("+00:00", "Z") if timestamps else None,
        "timeStopUtc": max(timestamps).isoformat().replace("+00:00", "Z") if timestamps else None,
        "profileCandidates": summaries,
    }


def main() -> int:
    archive_request = urllib.request.Request(
        ARCHIVE_URL,
        headers={
            "User-Agent": "EvoWars-Scientific-Archive-Importer/1.0",
            "Accept": "application/x-gzip,application/octet-stream,*/*",
            "Accept-Encoding": "identity",
        },
    )
    with urllib.request.urlopen(archive_request, timeout=90) as response:
        archive_bytes = response.read(MAX_ARCHIVE_BYTES + 1)
        archive_http = {
            "url": ARCHIVE_URL,
            "fileName": ARCHIVE_NAME,
            "httpStatus": response.status,
            "httpContentType": response.headers.get("Content-Type"),
            "httpContentLength": response.headers.get("Content-Length"),
            "byteLength": len(archive_bytes),
            "sha256": hashlib.sha256(archive_bytes).hexdigest(),
        }
    if len(archive_bytes) > MAX_ARCHIVE_BYTES:
        fail("annual archive exceeds safety limit")

    pattern = re.compile(
        re.escape(PRODUCT_STEM) + r"_v\d+_r\d+\.(csv|xml)$",
        re.IGNORECASE,
    )
    try:
        archive = tarfile.open(fileobj=io.BytesIO(archive_bytes), mode="r:gz")
    except (tarfile.TarError, OSError) as error:
        fail(f"annual archive is not valid gzip tar: {error}")
    with archive:
        matches = [
            member for member in archive.getmembers()
            if member.isfile() and pattern.search(Path(member.name).name)
        ]
        csv_members = [member for member in matches if Path(member.name).suffix.lower() == ".csv"]
        xml_members = [member for member in matches if Path(member.name).suffix.lower() == ".xml"]
        if len(csv_members) != 1 or len(xml_members) != 1:
            fail(
                f"expected one scale-height CSV/XML pair for {PRODUCT_STEM}; "
                f"found csv={len(csv_members)}, xml={len(xml_members)}"
            )

        def read_member(member: tarfile.TarInfo) -> bytes:
            if member.size <= 0 or member.size > MAX_PRODUCT_BYTES:
                fail(f"disallowed member size {member.size} for {member.name}")
            stream = archive.extractfile(member)
            if stream is None:
                fail(f"cannot extract {member.name}")
            data = stream.read(MAX_PRODUCT_BYTES + 1)
            if len(data) != member.size or len(data) > MAX_PRODUCT_BYTES:
                fail(f"archive member byte length mismatch for {member.name}")
            return data

        csv_bytes = read_member(csv_members[0])
        xml_bytes = read_member(xml_members[0])
        csv_name = Path(csv_members[0].name).name
        xml_name = Path(xml_members[0].name).name

    provenance = audit_label(xml_bytes, csv_bytes, csv_name)
    summary = summarize(csv_bytes)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUTPUT_DIR / csv_name).write_bytes(csv_bytes)
    (OUTPUT_DIR / xml_name).write_bytes(xml_bytes)
    manifest = {
        "archive": archive_http,
        "productId": PRODUCT_ID,
        "csv": provenance,
        "xml": {"fileName": xml_name, "byteLength": len(xml_bytes), "sha256": provenance["xmlSha256"]},
        "profileSummary": summary,
        "interpretation": {
            "productLevel": "L3 derived scale-height temperature",
            "notDirectPointTemperatureObservation": True,
            "notLocalTemperatureObservation": True,
            "notMarsPhotochemicalInitialState": True,
            "notes": [
                "Temperature is derived from species-specific H=m*g/(k*T) scale-height fit over exobase-to-homopause range.",
                "The exobase altitude is not a pointwise representative temperature altitude.",
                "HI fit quality is the good near-isothermic fit; HW, HA and H0 remain distinct categories.",
                "This product cannot by itself provide a continuous vertical T(z) or P(z) profile."
            ]
        }
    }
    (OUTPUT_DIR / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({
        "status": "retrieved_and_audited",
        "productId": PRODUCT_ID,
        "archive": archive_http,
        "csv": provenance,
        "profileSummary": summary,
        "outputDirectory": str(OUTPUT_DIR)
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1)
