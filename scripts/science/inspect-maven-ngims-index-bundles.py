#!/usr/bin/env python3
"""Audit public NASA/NMSU MAVEN NGIMS index bundles for cso-abund product IDs.

Run once with [inspect-ngims-index-bundles] in a commit subject. This only
downloads public selector/index catalogues; it does not download or claim any
measurement products. It preserves archive hashes, member names and exact text
contexts containing cso-abund/NGIMS L2 product URNs.
"""
from __future__ import annotations

import csv
from collections import Counter
import hashlib
import io
import json
import re
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path, PurePosixPath

BASE = "https://atmos.nmsu.edu/data_and_services/atmospheres_data/MAVEN/logs/"
OUTPUT = Path("src/modules/Data/mavenNgimsIndexBundleAudit")
SOURCES = [
    {
        "name": "The_NGIMS_Indices_.zip",
        "url": BASE + "The_NGIMS_Indices_.zip",
        "kind": "zip",
        "maxBytes": 20_000_000,
    },
    {
        "name": "The_other_3_NGIMS_Indices_2.zip",
        "url": BASE + "The_other_3_NGIMS_Indices%202.zip",
        "kind": "zip",
        "maxBytes": 20_000_000,
    },
    {
        "name": "NGIMS_indexes.zip",
        "url": BASE + "NGIMS_indexes.zip",
        "kind": "zip",
        "maxBytes": 100_000_000,
    },
    {
        "name": "MAVEN_NGIMS_Single-Species_del1-43.csv",
        "url": BASE + "MAVEN_NGIMS_Single-Species_del1-43.csv",
        "kind": "text",
        "maxBytes": 20_000_000,
    },
]
CSO_RE = re.compile(r"cso[-_]abund", re.IGNORECASE)
URN_RE = re.compile(r"urn:nasa:pds:maven_ngims:l2:[A-Za-z0-9_.:-]+", re.IGNORECASE)
FILE_RE = re.compile(r"mvn_ngi_l2_[A-Za-z0-9_.-]+", re.IGNORECASE)
PRODUCT_ID_RE = re.compile(
    r"mvn_ngi_l2_(?P<mode>[a-z0-9-]+)-(?P<tid>\d+)_(?P<time>\d{8}t\d{6})",
    re.IGNORECASE,
)


def download(source: dict) -> tuple[bytes, dict]:
    request = urllib.request.Request(
        source["url"],
        headers={
            "User-Agent": "EvoWars-NGIMS-Index-Audit/1.0",
            "Accept": "application/zip,text/csv,text/plain,*/*",
            "Accept-Encoding": "identity",
        },
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        if response.status != 200:
            raise RuntimeError(f"HTTP {response.status} downloading {source['name']}")
        body = response.read(source["maxBytes"] + 1)
        if len(body) > source["maxBytes"]:
            raise RuntimeError(f"{source['name']} exceeds safety limit {source['maxBytes']}")
        return body, {
            "name": source["name"],
            "url": source["url"],
            "httpStatus": response.status,
            "contentType": response.headers.get("Content-Type"),
            "contentLengthHeader": response.headers.get("Content-Length"),
            "byteLength": len(body),
            "sha256": hashlib.sha256(body).hexdigest(),
        }


def scan_text(source_name: str, member_name: str, body: bytes, matches: list[dict]) -> dict:
    text = body.decode("utf-8-sig", errors="replace")
    lines = text.splitlines()
    found = 0
    target_tid_rows = []
    product_token_counts: Counter[str] = Counter()
    urns_in_member: set[str] = set()
    mode_counts: Counter[str] = Counter()

    for index, line in enumerate(lines, start=1):
        urns = sorted(set(URN_RE.findall(line)))
        names = sorted(set(FILE_RE.findall(line)))
        if urns:
            urns_in_member.update(urns)

        # A TID is parsed only from a structured product identifier. Searching
        # arbitrary row text is unsafe because timestamps can contain the same digits.
        product_ids = {
            (
                match.group("mode").lower(),
                int(match.group("tid")),
                match.group("time").lower(),
            )
            for match in PRODUCT_ID_RE.finditer(line)
        }
        product_token_counts.update(name.lower() for name in names)
        mode_counts.update(mode for mode, _, _ in product_ids)

        if any(tid == 14282 for _, tid, _ in product_ids):
            target_tid_rows.append({
                "lineNumber": index,
                "urns": urns,
                "productFileTokens": names,
                "productIds": [
                    {"mode": mode, "tid": tid, "time": time_token}
                    for mode, tid, time_token in sorted(product_ids)
                    if tid == 14282
                ],
                "lineText": line[:3000],
            })

        cso_ids = sorted(
            (mode, tid, time_token)
            for mode, tid, time_token in product_ids
            if mode == "cso-abund"
        )
        if not cso_ids:
            continue

        found += 1
        for mode, tid, time_token in cso_ids:
            matches.append({
                "source": source_name,
                "member": member_name,
                "lineNumber": index,
                "tid": tid,
                "time": time_token,
                "productType": mode,
                "urns": urns,
                "productFileTokens": names,
                "lineText": line[:3000],
            })

    csv_schema = None
    if PurePosixPath(member_name).suffix.lower() == ".csv":
        try:
            parsed_rows = list(csv.reader(io.StringIO(text)))
            expected_headers = {"Time of Closest Approach", "URN", "Product Type"}
            header_index = next(
                (
                    row_index
                    for row_index, row in enumerate(parsed_rows)
                    if expected_headers.issubset({cell.strip() for cell in row})
                ),
                None,
            )
            if header_index is None:
                csv_schema = {
                    "parseStatus": "header_not_found",
                    "preambleRows": len(parsed_rows),
                    "firstRows": parsed_rows[:3],
                }
            else:
                csv_schema = {
                    "parseStatus": "parsed",
                    "preambleRowCount": header_index,
                    "headers": parsed_rows[header_index],
                    "rowCount": max(0, len(parsed_rows) - header_index - 1),
                    "sampleRows": parsed_rows[header_index + 1:header_index + 4],
                }
        except csv.Error as error:
            csv_schema = {"parseError": str(error)}

    return {
        "member": member_name,
        "byteLength": len(body),
        "lineCount": len(lines),
        "csoAbundLineCount": found,
        "uniqueUrns": sorted(urns_in_member, key=str.lower),
        "productTokenCounts": dict(product_token_counts),
        "modeTokenLineCounts": dict(mode_counts),
        "targetTid14282Rows": target_tid_rows[:100],
        "targetTid14282RowCount": len(target_tid_rows),
        "csvSchema": csv_schema,
    }


def scan_xlsx(source_name: str, member_name: str, body: bytes, matches: list[dict]) -> list[dict]:
    output = []
    try:
        inner = zipfile.ZipFile(io.BytesIO(body))
    except zipfile.BadZipFile:
        return output
    with inner:
        for item in inner.infolist():
            if item.is_dir() or not item.filename.endswith(".xml") or item.file_size > 25_000_000:
                continue
            data = inner.read(item)
            if CSO_RE.search(data.decode("utf-8", errors="replace")):
                output.append(scan_text(source_name, member_name + "!" + item.filename, data, matches))
    return output


def inspect_zip(source_name: str, body: bytes, matches: list[dict]) -> dict:
    try:
        archive = zipfile.ZipFile(io.BytesIO(body))
    except zipfile.BadZipFile as error:
        raise RuntimeError(f"{source_name} is not a valid ZIP archive: {error}")
    members = []
    with archive:
        for item in archive.infolist():
            if item.is_dir():
                continue
            record = {
                "name": item.filename,
                "size": item.file_size,
                "compressedSize": item.compress_size,
            }
            members.append(record)
            if item.file_size > 50_000_000:
                continue
            data = archive.read(item)
            suffix = PurePosixPath(item.filename).suffix.lower()
            if suffix in {".csv", ".txt", ".html", ".htm", ".xml", ".json"}:
                record["textAudit"] = scan_text(source_name, item.filename, data, matches)
            elif suffix in {".xlsx", ".xlsm"}:
                record["embeddedWorkbookAudit"] = scan_xlsx(source_name, item.filename, data, matches)
            elif CSO_RE.search(data.decode("latin-1", errors="ignore")):
                record["binaryTokenHit"] = True
                matches.append({
                    "source": source_name,
                    "member": item.filename,
                    "lineNumber": None,
                    "tid": None,
                    "urns": sorted(set(URN_RE.findall(data.decode("latin-1", errors="ignore")))),
                    "productFileTokens": sorted(set(FILE_RE.findall(data.decode("latin-1", errors="ignore")))),
                    "lineText": "binary member contains cso-abund token",
                })
    return {"memberCount": len(members), "members": members}



def run_self_tests() -> None:
    """Offline regression tests for CSV preambles and structured product IDs."""
    sample = (
        "Note: geometry is reported at closest approach\n"
        "Time of Closest Approach,URN,Start Time,Stop Time,Product Type\n"
        "2014-12-11T16:37:34Z,urn:nasa:pds:maven_ngims:l2:mvn_ngi_l2_cso-abund-14282_20141211t154406,2014-12-11T15:45:25Z,2014-12-11T17:29:43Z,cso-abund\n"
        "2016-08-22T15:22:36Z,urn:nasa:pds:maven_ngims:l2:mvn_ngi_l2_csn-abund-20902_20160822t142824,2016-08-22T14:30:25Z,2016-08-22T16:14:48Z,csn-abund\n"
    )
    matches: list[dict] = []
    audit = scan_text(
        "fixture.csv",
        "fixture.csv",
        sample.encode("utf-8"),
        matches,
    )
    assert audit["csvSchema"]["parseStatus"] == "parsed", audit
    assert audit["csvSchema"]["preambleRowCount"] == 1, audit
    assert audit["csvSchema"]["rowCount"] == 2, audit
    assert audit["csoAbundLineCount"] == 1, audit
    assert audit["targetTid14282RowCount"] == 1, audit
    assert audit["targetTid14282Rows"][0]["productIds"][0]["tid"] == 14282, audit
    assert len(matches) == 1, matches
    assert matches[0]["tid"] == 14282 and matches[0]["productType"] == "cso-abund", matches
    assert audit["modeTokenLineCounts"] == {"cso-abund": 1, "csn-abund": 1}, audit

    # Timestamp contains "14282", but the product's actual TID is 20902.
    timestamp_collision = (
        "2016-08-22T15:22:36Z,urn:nasa:pds:maven_ngims:l2:"
        "mvn_ngi_l2_csn-abund-20902_20160822t142824"
    )
    collision = scan_text(
        "fixture.txt",
        "fixture.txt",
        timestamp_collision.encode("utf-8"),
        [],
    )
    assert collision["targetTid14282RowCount"] == 0, collision
    assert collision["csoAbundLineCount"] == 0, collision
    print(
        "NGIMS index-bundle self-test: PASS "
        "(CSV preamble/header, row counts, product modes, exact TID parsing)"
    )


def main() -> int:
    selector_only = "--selector-only" in sys.argv[1:]
    selected_sources = (
        [source for source in SOURCES if source["name"] == "MAVEN_NGIMS_Single-Species_del1-43.csv"]
        if selector_only
        else SOURCES
    )
    if selector_only and not selected_sources:
        raise RuntimeError("official single-species selector CSV source is not configured")
    OUTPUT.mkdir(parents=True, exist_ok=True)
    archive_audits = []
    all_matches: list[dict] = []
    failures = []
    for source in selected_sources:
        try:
            body, provenance = download(source)
            if source["kind"] == "zip":
                details = inspect_zip(source["name"], body, all_matches)
            else:
                details = scan_text(source["name"], source["name"], body, all_matches)
            archive_audits.append({**provenance, **details})
        except Exception as error:
            failures.append({"source": source["name"], "error": str(error)})
            archive_audits.append({"name": source["name"], "url": source["url"], "error": str(error)})

    unique_urns = sorted({
        urn.lower(): urn
        for match in all_matches
        for urn in match.get("urns", [])
    }.values(), key=str.lower)
    unique_tids = sorted({
        match["tid"] for match in all_matches if match.get("tid") is not None
    })
    manifest = {
        "sourceDirectory": BASE,
        "retrievalDate": "2026-11-25",
        "scanScope": "official_single_species_selector_csv_only" if selector_only else "selector_csv_and_legacy_index_bundles",
        "archives": archive_audits,
        "summary": {
            "successfulSources": sum(1 for item in archive_audits if "error" not in item),
            "failedSources": failures,
            "zipMemberCount": sum(item.get("memberCount", 0) for item in archive_audits),
            "csoAbundTextMatches": len(all_matches),
            "uniqueCsoProductUrns": unique_urns,
            "uniqueTids": unique_tids,
        },
        "matches": all_matches,
        "interpretation": {
            "indexOnly": True,
            "measurementCsvPayloadsDownloaded": False,
            "detachedPds4LabelsDownloaded": False,
            "candidateRowsAreNotMeasurements": True,
            "nextStep": "For each cso-abund URN, retrieve exact PDS4 CSV/XML and validate product identity, byte length, checksum, row-level quality and same-event geometry before co-registration.",
        },
    }
    (OUTPUT / "index-bundle-audit.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(manifest["summary"], ensure_ascii=False, indent=2))
    return 0 if not failures else 1


if __name__ == "__main__":
    if "--self-test" in __import__("sys").argv[1:]:
        run_self_tests()
        raise SystemExit(0)
    raise SystemExit(main())
