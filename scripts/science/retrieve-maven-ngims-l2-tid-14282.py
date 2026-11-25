#!/usr/bin/env python3
"""Retrieve and audit all MAVEN NGIMS L2 abundance products for TID 14282.

Run once by committing a subject containing [import-ngims-l2-tid-14282].

The annual PDS archive is the byte-preserving source. Candidate files are
selected by orbit/TID/product timestamp; every candidate is paired with its
own detached PDS4 label, and file identity, size, optional MD5, and row schema
are validated. Unknown focus modes and quality flags are retained in the
manifest rather than silently treated as valid measurements.
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

ARCHIVE_URL = "https://atmos.nmsu.edu/PDS/data/PDS4/MAVEN/ngims_derivedL2_2014.tar.gz"
ARCHIVE_NAME = "ngims_derivedL2_2014.tar.gz"
PDS_NS = "http://pds.nasa.gov/pds4/pds/v1"
TID = 14282
ORBIT = 391
TIME_STAMP = "20141211T154406"
TIME_START = "2014-12-11T15:45:25Z"
TIME_STOP = "2014-12-11T17:29:43Z"
OUTPUT_DIR = Path("src/modules/Data/mavenNgimsL2Archive")
MAX_ARCHIVE_BYTES = 120_000_000
MAX_PRODUCT_BYTES = 8_000_000
RECORD_PATTERN = re.compile(
    r"mvn_ngi_l2_(?P<mode>[a-z0-9]+)-abund-14282_20141211t154406_v(?P<version>\d+)_r(?P<revision>\d+)\.(?P<ext>csv|xml)$",
    re.IGNORECASE,
)
REQUIRED_COLUMNS = [
    "t_utc", "t_unix", "t_sclk", "t_tid", "tid", "orbit", "focusmode",
    "alt", "lst", "long", "lat", "sza", "mass", "species",
    "cps_dt_bkgd", "abundance", "precision", "quality",
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
    with urllib.request.urlopen(request, timeout=180) as response:
        if response.status != 200:
            fail(f"HTTP {response.status} retrieving {ARCHIVE_NAME}")
        payload = response.read(MAX_ARCHIVE_BYTES + 1)
        if len(payload) > MAX_ARCHIVE_BYTES:
            fail(f"{ARCHIVE_NAME} exceeds safety limit {MAX_ARCHIVE_BYTES}")
        metadata = {
            "url": ARCHIVE_URL,
            "fileName": ARCHIVE_NAME,
            "httpStatus": response.status,
            "httpContentType": response.headers.get("Content-Type"),
            "httpContentLength": response.headers.get("Content-Length"),
            "httpContentEncoding": response.headers.get("Content-Encoding"),
            "byteLength": len(payload),
            "sha256": hashlib.sha256(payload).hexdigest(),
        }
        return payload, metadata


def extract_member(archive: tarfile.TarFile, member: tarfile.TarInfo) -> bytes:
    if not member.isfile() or member.size <= 0 or member.size > MAX_PRODUCT_BYTES:
        fail(f"disallowed archive member size/type: {member.name} ({member.size})")
    stream = archive.extractfile(member)
    if stream is None:
        fail(f"cannot extract {member.name}")
    payload = stream.read(MAX_PRODUCT_BYTES + 1)
    if len(payload) != member.size or len(payload) > MAX_PRODUCT_BYTES:
        fail(f"archive member length mismatch: {member.name}")
    return payload


def q(name: str) -> str:
    return "{" + PDS_NS + "}" + name


def direct_scalar(parent: ET.Element, name: str, *, optional: bool = False) -> str | None:
    all_items = [node for node in parent.iter() if node.tag == q(name)]
    direct = [node for node in list(parent) if node.tag == q(name)]
    if optional and not all_items:
        return None
    if len(all_items) != 1 or len(direct) != 1 or list(direct[0]):
        fail(f"expected exactly one direct scalar {name}; found total={len(all_items)} direct={len(direct)}")
    value = (direct[0].text or "").strip()
    if not value and not optional:
        fail(f"PDS4 {name} is empty")
    return value or None


def audit_label(xml_bytes: bytes, csv_bytes: bytes, expected_filename: str) -> dict:
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError as error:
        fail(f"malformed detached XML: {error}")
    if root.tag != q("Product_Observational"):
        fail("PDS4 label root is not Product_Observational")

    identification = [node for node in root.iter() if node.tag == q("Identification_Area")]
    file_areas = [node for node in root.iter() if node.tag == q("File_Area_Observational")]
    if len(identification) != 1 or identification[0] not in list(root):
        fail("expected one direct-child Identification_Area")
    if len(file_areas) != 1 or file_areas[0] not in list(root):
        fail("expected one direct-child File_Area_Observational")
    files = [node for node in file_areas[0].iter() if node.tag == q("File")]
    direct_files = [node for node in list(file_areas[0]) if node.tag == q("File")]
    if len(files) != 1 or len(direct_files) != 1:
        fail("expected one direct-child File in observational area")
    file_node = direct_files[0]

    logical_id = direct_scalar(identification[0], "logical_identifier")
    file_name = direct_scalar(file_node, "file_name")
    file_size_text = direct_scalar(file_node, "file_size")
    size_node = next(child for child in list(file_node) if child.tag == q("file_size"))
    if size_node.attrib.get("unit") != "byte":
        fail('file_size must use unit="byte"')
    if file_name != expected_filename:
        fail(f"label file_name mismatch: {file_name} != {expected_filename}")
    if not logical_id or not logical_id.startswith("urn:nasa:pds:maven_ngims:l2:"):
        fail(f"unexpected L2 product identifier {logical_id}")
    try:
        declared_size = int(file_size_text or "")
    except ValueError:
        fail("file_size is not an integer")

    md5_text = direct_scalar(file_node, "md5_checksum", optional=True)
    if md5_text is not None and not re.fullmatch(r"[0-9a-fA-F]{32}", md5_text):
        fail("md5_checksum is not 32 hexadecimal characters")
    computed_md5 = hashlib.md5(csv_bytes).hexdigest()
    md5_status = "not_present_in_detached_label"
    if md5_text is not None:
        if computed_md5 != md5_text.lower():
            fail("CSV MD5 does not match detached label")
        md5_status = "verified_against_detached_label"

    size_matches = declared_size == len(csv_bytes)
    return {
        "productId": logical_id,
        "csvFileName": file_name,
        "csvByteLength": len(csv_bytes),
        "labelDeclaredFileSizeBytes": declared_size,
        "csvSizeConsistencyStatus": (
            "matches_detached_label_file_size" if size_matches
            else "mismatch_quarantined_no_md5" if md5_text is None
            else "mismatch_md5_verified"
        ),
        "csvSha256": hashlib.sha256(csv_bytes).hexdigest(),
        "csvMd5Checksum": computed_md5 if md5_text is not None else None,
        "csvMd5ChecksumStatus": md5_status,
        "xmlSha256": hashlib.sha256(xml_bytes).hexdigest(),
        "detachedLabelAuthenticity": "not_independently_authenticated",
    }


def parse_csv(csv_bytes: bytes) -> dict:
    try:
        text = csv_bytes.decode("utf-8-sig")
    except UnicodeDecodeError as error:
        fail(f"L2 CSV is not UTF-8/ASCII compatible: {error}")
    reader = csv.DictReader(io.StringIO(text, newline=""))
    if reader.fieldnames is None:
        fail("L2 CSV header missing")
    headers = [h.strip().lower() for h in reader.fieldnames]
    if headers != REQUIRED_COLUMNS:
        fail(f"L2 CSV header differs from SIS 1.13 schema: {headers}")

    species_counts: Counter[str] = Counter()
    quality_counts: Counter[str] = Counter()
    focus_counts: Counter[str] = Counter()
    orbit_counts: Counter[str] = Counter()
    tid_counts: Counter[str] = Counter()
    profiles: dict[tuple[str, str, str], list[tuple[float, float, float, str]]] = defaultdict(list)
    timestamps: list[datetime] = []
    row_count = 0
    rejected_rows = 0
    no_rows = 0
    for record_number, raw in enumerate(reader, start=1):
        row_count += 1
        row = {str(k).strip().lower(): (v or "").strip() for k, v in raw.items()}
        try:
            tid = int(row["tid"])
            orbit = int(row["orbit"])
            altitude = float(row["alt"])
            abundance = float(row["abundance"])
            precision = float(row["precision"])
            mass = float(row["mass"])
        except (KeyError, TypeError, ValueError):
            rejected_rows += 1
            continue
        if tid != TID or orbit != ORBIT:
            rejected_rows += 1
            continue
        if altitude <= 0 or mass < 2 or mass > 150 or abundance <= 0 or precision < 0 or precision > 1:
            rejected_rows += 1
            continue
        try:
            time_text = row["t_utc"]
            parsed = datetime.fromisoformat(time_text.replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            parsed = parsed.astimezone(timezone.utc)
        except ValueError:
            rejected_rows += 1
            continue
        quality = row["quality"].upper()
        species = row["species"].strip()
        focus = row["focusmode"].strip().lower()
        if quality not in {"IV", "IU", "OV", "OU", "UR"}:
            quality_label = "unrecognized:" + quality
        else:
            quality_label = quality
        timestamps.append(parsed)
        species_counts[species] += 1
        quality_counts[quality_label] += 1
        focus_counts[focus] += 1
        orbit_counts[str(orbit)] += 1
        tid_counts[str(tid)] += 1
        if species.upper() == "NO":
            no_rows += 1
        if quality in {"IV", "OV", "IU", "OU"}:
            cls = "verified" if quality in {"IV", "OV"} else "uncertain"
            profiles[(species, focus, cls)].append((altitude, abundance, precision, quality))
    candidates = []
    for (species, focus, quality), rows in sorted(profiles.items()):
        unique_altitudes = len({r[0] for r in rows})
        candidates.append({
            "species": species,
            "focusMode": focus,
            "quality": quality,
            "rowCount": len(rows),
            "uniqueAltitudeCount": unique_altitudes,
            "altitudeMinKm": min(r[0] for r in rows),
            "altitudeMaxKm": max(r[0] for r in rows),
            "abundanceUnit": "particles/cm3",
            "precisionMeaning": "fractional 1-sigma",
            "relativeSigmaMin": min(r[2] for r in rows),
            "relativeSigmaMax": max(r[2] for r in rows),
            "hasDuplicateAltitude": unique_altitudes != len(rows),
        })
    return {
        "schema": "NGIMS SIS Rev. 1.13 Table A-8 L2 neutral abundances",
        "rowCount": row_count,
        "acceptedRows": row_count - rejected_rows,
        "rejectedRows": rejected_rows,
        "tidCounts": dict(tid_counts),
        "orbitCounts": dict(orbit_counts),
        "focusModeCounts": dict(focus_counts),
        "speciesRowCounts": dict(species_counts),
        "qualityFlagCounts": dict(quality_counts),
        "timeStartUtc": min(timestamps).isoformat().replace("+00:00", "Z") if timestamps else None,
        "timeStopUtc": max(timestamps).isoformat().replace("+00:00", "Z") if timestamps else None,
        "noRowCount": no_rows,
        "profileCandidates": candidates,
    }


def main() -> int:
    archive_bytes, archive_provenance = download_archive()
    archive = tarfile.open(fileobj=io.BytesIO(archive_bytes), mode="r:gz")
    with archive:
        matches = []
        for member in archive.getmembers():
            if not member.isfile():
                continue
            basename = Path(member.name).name
            match = RECORD_PATTERN.fullmatch(basename)
            if match:
                matches.append((member, match.groupdict()))
        if not matches:
            fail("no TID 14282 / 2014-12-11T15:44:06 L2 abundance candidates found in official annual archive")

        pairs: dict[str, dict[str, tuple[tarfile.TarInfo, dict]]] = defaultdict(dict)
        for member, groups in matches:
            stem = member.name[:-4]
            ext = groups["ext"].lower()
            if ext in pairs[stem]:
                fail(f"duplicate archive members for {stem}.{ext}")
            pairs[stem][ext] = (member, groups)

        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        products = []
        for stem, components in sorted(pairs.items()):
            if "csv" not in components or "xml" not in components:
                fail(f"archive product missing CSV/XML partner: {stem} components={list(components)}")
            csv_member, groups = components["csv"]
            xml_member, _ = components["xml"]
            csv_bytes = extract_member(archive, csv_member)
            xml_bytes = extract_member(archive, xml_member)
            product_prov = audit_label(xml_bytes, csv_bytes, Path(csv_member.name).name)
            if (
                "mvn_ngi_l2_" not in product_prov["productId"] or
                "-14282_" not in product_prov["productId"] or
                "20141211t154406" not in product_prov["productId"].lower()
            ):
                fail(f"label URN is not the requested event: {product_prov['productId']}")
            summary = parse_csv(csv_bytes)
            basename = Path(csv_member.name).name
            labelname = Path(xml_member.name).name
            out = OUTPUT_DIR / basename
            out_label = OUTPUT_DIR / labelname
            out.write_bytes(csv_bytes)
            out_label.write_bytes(xml_bytes)
            products.append({
                "archiveMemberCsv": csv_member.name,
                "archiveMemberXml": xml_member.name,
                "csv": product_prov,
                "xmlFileName": labelname,
                "xmlByteLength": len(xml_bytes),
                "csvSummary": summary,
                "filesCommitted": [basename, labelname],
            })

    manifest = {
        "archive": archive_provenance,
        "indexEvidence": {
            "productEventUtcStart": TIME_START,
            "productEventUtcStop": TIME_STOP,
            "productIdEvent": "urn:nasa:pds:maven_ngims:l2:mvn_ngi_l2_csn-abund-14282_20141211t154406",
            "orbit": ORBIT,
            "tid": TID,
            "note": "The official index can expose multiple product modes/versions for the same TID; all matching L2 abundance products in the annual archive are retained separately."
        },
        "retrievalMethod": "exact original archive members extracted byte-for-byte; no line-ending rewriting",
        "products": products,
        "interpretation": {
            "allProductsRemainSeparate": True,
            "l2AbundanceUnit": "particles/cm3",
            "precisionField": "fractional 1-sigma on abundance",
            "noAutomaticCrossModeOrSpeciesMerge": True,
            "schedulerInitializationEligible": False,
            "notes": [
                "Each product retains its own product ID, focus mode, time, geometry, species and quality flag.",
                "No profile is merged across different focus modes or product versions.",
                "Unknown quality flags remain explicit and are not promoted to verified detections.",
                "A single orbit is an upper-atmosphere spacecraft track, not a complete lower-atmosphere state."
            ]
        }
    }
    (OUTPUT_DIR / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({
        "status": "retrieved_and_audited",
        "archive": archive_provenance,
        "products": [
            {
                "productId": product["csv"]["productId"],
                "fileName": product["csv"]["csvFileName"],
                "byteLength": product["csv"]["csvByteLength"],
                "sizeConsistency": product["csv"]["csvSizeConsistencyStatus"],
                "focusModes": product["csvSummary"]["focusModeCounts"],
                "species": product["csvSummary"]["speciesRowCounts"],
                "quality": product["csvSummary"]["qualityFlagCounts"],
                "profileCandidates": product["csvSummary"]["profileCandidates"],
            }
            for product in products
        ]
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1)
