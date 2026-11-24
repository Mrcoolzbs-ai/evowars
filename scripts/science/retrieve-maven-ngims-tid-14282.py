#!/usr/bin/env python3
"""Fetch and freeze one public MAVEN NGIMS PDS4 L3 res-den product.

This is an explicit, one-shot archive retrieval helper. Trigger it with a commit
subject containing [import-ngims-tid-14282]. It preserves the exact
CSV/XML bytes, verifies the detached PDS4 label structure, compares file_size
and (when supplied) md5_checksum, and writes a small machine-readable manifest.
It does not convert this L3 resampled product into L2 point measurements.
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

BASE_URL = (
    "https://atmos.nmsu.edu/PDS/data/PDS4/MAVEN/ngims_bundle/"
    "l3/2014/12"
)
ANNUAL_ARCHIVE_URL = (
    "https://atmos.nmsu.edu/PDS/data/PDS4/MAVEN/"
    "ngims_derivedL3_2014.tar.gz"
)
ANNUAL_ARCHIVE_NAME = "ngims_derivedL3_2014.tar.gz"
PRODUCT_ID = (
    "urn:nasa:pds:maven_ngims:l3:"
    "mvn_ngi_l3_res-den-14282_20141211t154406"
)
CSV_NAME = "mvn_ngi_l3_res-den-14282_20141211T154406_v06_r01.csv"
XML_NAME = "mvn_ngi_l3_res-den-14282_20141211T154406_v06_r01.xml"
OUTPUT_DIR = Path("src/modules/Data/mavenNgimsArchive")
PDS_NS = "http://pds.nasa.gov/pds4/pds/v1"
Q = lambda name: "{" + PDS_NS + "}" + name
BASE_COLUMNS = [
    "t_utc", "t_unix", "t_sclk", "t_tid", "tid", "orbit",
    "focusmode", "alt", "mass", "species", "density_bins", "quality",
]


def fail(message: str) -> "None":
    raise RuntimeError(message)


def download_url(url: str, display_name: str, max_bytes: int) -> tuple[bytes, dict]:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "EvoWars-Scientific-Archive-Importer/1.0",
            "Accept": "application/x-gzip,application/octet-stream,*/*",
            "Accept-Encoding": "identity",
        },
    )
    with urllib.request.urlopen(request, timeout=90) as response:
        if response.status != 200:
            fail(f"HTTP {response.status} retrieving {display_name}")
        payload = response.read(max_bytes + 1)
        if len(payload) > max_bytes:
            fail(f"{display_name} exceeds safety limit ({max_bytes} bytes)")
        metadata = {
            "httpContentType": response.headers.get("Content-Type"),
            "httpContentLength": response.headers.get("Content-Length"),
            "httpContentEncoding": response.headers.get("Content-Encoding"),
            "httpPayloadByteLength": len(payload),
        }
        return payload, metadata


def extract_unique_tar_member(archive_bytes: bytes, file_name: str, max_bytes: int) -> tuple[bytes, str]:
    try:
        archive = tarfile.open(fileobj=io.BytesIO(archive_bytes), mode="r:gz")
    except (tarfile.TarError, OSError) as error:
        fail(f"2014 NGIMS annual L3 archive is not a valid gzip tar: {error}")
    with archive:
        matches = [
            member for member in archive.getmembers()
            if Path(member.name).name == file_name and member.isfile()
        ]
        if len(matches) != 1:
            fail(f"annual archive must contain exactly one regular {file_name}; found {len(matches)}")
        member = matches[0]
        if member.size <= 0 or member.size > max_bytes:
            fail(f"archive member {file_name} has disallowed size {member.size}")
        stream = archive.extractfile(member)
        if stream is None:
            fail(f"unable to read archive member {member.name}")
        payload = stream.read(max_bytes + 1)
        if len(payload) != member.size or len(payload) > max_bytes:
            fail(f"archive member {member.name} size mismatch or safety limit exceeded")
        return payload, member.name


def one_direct_child(scope: ET.Element, name: str, *, optional: bool = False) -> str | None:
    expected = Q(name)
    all_matches = [element for element in scope.iter() if element.tag == expected]
    direct_matches = [element for element in list(scope) if element.tag == expected]
    if optional and not all_matches:
        return None
    if len(all_matches) != 1 or len(direct_matches) != 1:
        fail(f"expected exactly one direct PDS4 {name}; found {len(all_matches)} total")
    if list(direct_matches[0]):
        fail(f"PDS4 {name} must be a scalar, not a container")
    value = (direct_matches[0].text or "").strip()
    if not value and not optional:
        fail(f"PDS4 {name} is empty")
    return value or None


def validate_label(xml_bytes: bytes, csv_bytes: bytes) -> tuple[dict, bytes]:
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError as error:
        fail(f"detached PDS4 XML is malformed: {error}")
    if root.tag != Q("Product_Observational"):
        fail("detached label root is not PDS4 Product_Observational")

    identification_areas = [node for node in root.iter() if node.tag == Q("Identification_Area")]
    file_areas = [node for node in root.iter() if node.tag == Q("File_Area_Observational")]
    if len(identification_areas) != 1 or identification_areas[0] not in list(root):
        fail("label must contain exactly one direct-child Identification_Area")
    if len(file_areas) != 1 or file_areas[0] not in list(root):
        fail("label must contain exactly one direct-child File_Area_Observational")

    files = [node for node in file_areas[0].iter() if node.tag == Q("File")]
    direct_files = [node for node in list(file_areas[0]) if node.tag == Q("File")]
    if len(files) != 1 or len(direct_files) != 1:
        fail("File_Area_Observational must contain exactly one direct-child File")
    file_node = direct_files[0]

    logical_identifier = one_direct_child(identification_areas[0], "logical_identifier")
    file_name = one_direct_child(file_node, "file_name")
    file_size_text = one_direct_child(file_node, "file_size")
    file_size_node = next(child for child in list(file_node) if child.tag == Q("file_size"))
    if file_size_node.attrib.get("unit") != "byte":
        fail('PDS4 file_size must declare unit="byte"')
    if logical_identifier != PRODUCT_ID:
        fail("PDS4 logical_identifier does not match expected NGIMS product URN")
    if file_name != CSV_NAME:
        fail("PDS4 file_name does not match the requested CSV filename")
    try:
        file_size = int(file_size_text or "")
    except ValueError:
        fail("PDS4 file_size is not an integer")
    if file_size <= 0:
        fail("PDS4 file_size must be positive")

    md5_value = one_direct_child(file_node, "md5_checksum", optional=True)
    canonical_bytes = csv_bytes
    transport_normalization = "none"
    if md5_value is not None:
        if not re.fullmatch(r"[0-9a-fA-F]{32}", md5_value):
            fail("PDS4 md5_checksum is not 32 hexadecimal characters")
        declared_md5 = md5_value.lower()
    else:
        declared_md5 = None

    csv_size_matches_label = len(csv_bytes) == file_size
    if declared_md5 is not None:
        computed_md5 = hashlib.md5(csv_bytes).hexdigest()
        if computed_md5 != declared_md5:
            fail(
                f"downloaded CSV MD5 {computed_md5} does not match PDS4 label "
                f"md5_checksum {declared_md5}"
            )
        md5_status = "verified_against_detached_label"
    else:
        computed_md5 = None
        md5_status = "not_present_in_detached_label"

    if csv_size_matches_label:
        size_status = "matches_detached_label_file_size"
    else:
        size_status = "mismatch_quarantined_no_md5"
    transport_normalization = "none"
    canonical_bytes = csv_bytes

    return ({
        "productId": logical_identifier,
        "csvFileName": file_name,
        "csvByteLength": len(canonical_bytes),
        "labelDeclaredFileSizeBytes": file_size,
        "csvSizeConsistencyStatus": size_status,
        "downloadedHttpByteLength": len(csv_bytes),
        "transportNormalization": transport_normalization,
        "md5Checksum": computed_md5,
        "md5ChecksumStatus": md5_status,
        "csvFixityStatus": (
            "md5_verified_against_detached_label"
            if declared_md5
            else "sha256_computed_not_compared_to_archive_checksum"
        ),
        "sha256": hashlib.sha256(canonical_bytes).hexdigest(),
        "downloadedResponseSha256": hashlib.sha256(csv_bytes).hexdigest(),
        "detachedLabelSha256": hashlib.sha256(xml_bytes).hexdigest(),
        "detachedLabelAuthenticity": "not_independently_authenticated",
    }, canonical_bytes)



def parse_and_summarize(csv_bytes: bytes) -> dict:
    try:
        text = csv_bytes.decode("utf-8-sig")
    except UnicodeDecodeError as error:
        fail(f"NGIMS CSV is not UTF-8/ASCII compatible: {error}")

    reader = csv.reader(io.StringIO(text, newline=""))
    try:
        headers = [header.strip().lower() for header in next(reader)]
    except StopIteration:
        fail("NGIMS CSV is empty")
    duplicate_utc = len(headers) == 13 and headers[:2] == ["t_utc", "t_utc"]
    canonical_headers = [headers[0], *headers[2:]] if duplicate_utc else headers
    if canonical_headers != BASE_COLUMNS:
        fail("CSV header does not match NGIMS SIS Rev. 1.13 Table A-9")

    species = Counter()
    quality = Counter()
    focus_modes = Counter()
    orbits = Counter()
    tids = Counter()
    times: list[str] = []
    altitude_by_group: dict[tuple[str, str], set[float]] = defaultdict(set)
    row_count = 0
    malformed_width = 0
    duplicate_time_mismatch = 0
    positive_density_count = 0

    for record_number, values in enumerate(reader, start=1):
        if not values:
            continue
        row_count += 1
        if len(values) != len(headers):
            malformed_width += 1
            continue
        if duplicate_utc and values[0].strip() != values[1].strip():
            duplicate_time_mismatch += 1
            continue
        mapped_values = [values[0], *values[2:]] if duplicate_utc else values
        record = dict(zip(BASE_COLUMNS, mapped_values))
        species_name = record["species"].strip()
        quality_flag = record["quality"].strip().upper()
        focus_mode = record["focusmode"].strip().lower()
        if species_name:
            species[species_name] += 1
        if quality_flag:
            quality[quality_flag] += 1
        if focus_mode:
            focus_modes[focus_mode] += 1
        try:
            orbit = int(record["orbit"])
            tid = int(record["tid"])
            altitude = float(record["alt"])
            density = float(record["density_bins"])
        except (TypeError, ValueError):
            continue
        orbits[str(orbit)] += 1
        tids[str(tid)] += 1
        timestamp = record["t_utc"].strip()
        if timestamp:
            try:
                parsed_time = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
                if parsed_time.tzinfo is None:
                    fail(f"row {record_number} has a timestamp without timezone")
                times.append(parsed_time.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"))
            except ValueError:
                continue
        if density > 0 and altitude > 0 and quality_flag in {"IV", "OV", "IU", "OU"}:
            positive_density_count += 1
            cls = "verified" if quality_flag in {"IV", "OV"} else "uncertain"
            altitude_by_group[(species_name, cls)].add(altitude)

    candidates = [
        {"species": name, "quality": cls, "uniqueAltitudeBins": len(altitudes)}
        for (name, cls), altitudes in sorted(altitude_by_group.items())
        if len(altitudes) >= 2
    ]
    if not candidates:
        fail("no species/quality group has at least two positive altitude bins")
    return {
        "csvHeader": headers,
        "duplicatedUtcHeader": duplicate_utc,
        "rowCount": row_count,
        "malformedWidthRows": malformed_width,
        "duplicateUtcMismatchRows": duplicate_time_mismatch,
        "positiveDensityRowsWithScienceQuality": positive_density_count,
        "speciesRowCounts": dict(sorted(species.items())),
        "qualityFlagRowCounts": dict(sorted(quality.items())),
        "focusModeRowCounts": dict(sorted(focus_modes.items())),
        "orbitRowCounts": dict(sorted(orbits.items())),
        "tidRowCounts": dict(sorted(tids.items())),
        "timeStartUtc": min(times) if times else None,
        "timeStopUtc": max(times) if times else None,
        "profileCandidates": candidates,
    }


def main() -> int:
    archive_bytes, archive_http = download_url(
        ANNUAL_ARCHIVE_URL, ANNUAL_ARCHIVE_NAME, max_bytes=20_000_000
    )
    csv_bytes, csv_member = extract_unique_tar_member(
        archive_bytes, CSV_NAME, max_bytes=512_000
    )
    xml_bytes, xml_member = extract_unique_tar_member(
        archive_bytes, XML_NAME, max_bytes=256_000
    )
    provenance, csv_bytes = validate_label(xml_bytes, csv_bytes)
    summary = parse_and_summarize(csv_bytes)
    provenance["sourceArchive"] = {
        "url": ANNUAL_ARCHIVE_URL,
        "fileName": ANNUAL_ARCHIVE_NAME,
        "byteLength": len(archive_bytes),
        "sha256": hashlib.sha256(archive_bytes).hexdigest(),
        "httpResponse": archive_http,
        "csvTarMember": csv_member,
        "xmlTarMember": xml_member,
    }
    manifest = {
        "archive": "NASA PDS Planetary Atmospheres Node / MAVEN NGIMS PDS4",
        "archiveDirectory": BASE_URL + "/",
        "annualArchiveUrl": ANNUAL_ARCHIVE_URL,
        "csvUrl": BASE_URL + "/" + CSV_NAME,
        "xmlUrl": BASE_URL + "/" + XML_NAME,
        "productId": PRODUCT_ID,
        "csv": provenance,
        "xml": {
            "fileName": XML_NAME,
            "byteLength": len(xml_bytes),
            "sha256": provenance["detachedLabelSha256"],
        },
        "tableA9": summary,
        "interpretation": {
            "productLevel": "L3 altitude-resampled density",
            "notRawL2Measurement": True,
            "perRowDensitySigma": "not supplied by Table A-9",
            "csvSizeConsistencyStatus": provenance["csvSizeConsistencyStatus"],
            "csvFixityStatus": provenance["csvFixityStatus"],
            "transportNormalization": "none; original archive member preserved byte-for-byte",
            "schedulerEligibleAsCompleteMarsInitialState": False,
            "notes": [
                "Rows are archived L3 resampled/interpolated densities, not raw L2 point measurements.",
                "The PDS4 detached label is structurally checked but not independently authenticated.",
                "The PDS4 file_size is inconsistent with the archived CSV bytes; the payload is quarantined for forensic analysis.",
                "No md5_checksum is present in the detached label; only SHA-256 of the archived bytes is recorded.",
                "The file alone does not provide a complete T(z), P(z), bulk composition, or all radical inventories.",
            ],
        },
    }

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUTPUT_DIR / CSV_NAME).write_bytes(csv_bytes)
    (OUTPUT_DIR / XML_NAME).write_bytes(xml_bytes)
    (OUTPUT_DIR / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )

    print(json.dumps({
        "status": (
            "retrieved_and_label_checked"
            if provenance["csvSizeConsistencyStatus"] == "matches_detached_label_file_size"
            else "retrieved_from_annual_archive_with_label_size_discrepancy_quarantined"
        ),
        "productId": PRODUCT_ID,
        "csvByteLength": provenance["csvByteLength"],
        "labelDeclaredFileSizeBytes": provenance["labelDeclaredFileSizeBytes"],
        "csvSizeConsistencyStatus": provenance["csvSizeConsistencyStatus"],
        "csvFixityStatus": provenance["csvFixityStatus"],
        "md5ChecksumStatus": provenance["md5ChecksumStatus"],
        "sha256": provenance["sha256"],
        "rowCount": summary["rowCount"],
        "speciesRowCounts": summary["speciesRowCounts"],
        "qualityFlagRowCounts": summary["qualityFlagRowCounts"],
        "profileCandidates": summary["profileCandidates"],
        "outputDirectory": str(OUTPUT_DIR),
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1)
