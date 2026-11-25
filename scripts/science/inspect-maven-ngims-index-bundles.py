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
TID_RE = re.compile(r"cso[-_]abund[-_](\d+)", re.IGNORECASE)


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
        for token in ("csn", "osnb", "osnt", "osion", "cso-abund", "ion-abund"):
            if re.search(r"\\b" + re.escape(token) + r"\\b", line, re.I):
                mode_counts[token.lower()] += 1
        product_token_counts.update(name.lower() for name in names)
        tid_match = TID_RE.search(line)
        if "14282" in line:
            target_tid_rows.append({
                "lineNumber": index,
                "urns": urns,
                "productFileTokens": names,
                "lineText": line[:3000]
            })
        if not CSO_RE.search(line):
            continue
        found += 1
        matches.append({
            "source": source_name,
            "member": member_name,
            "lineNumber": index,
            "tid": int(tid_match.group(1)) if tid_match else None,
            "urns": urns,
            "productFileTokens": names,
            "lineText": line[:3000],
        })
    csv_schema = None
    if PurePosixPath(member_name).suffix.lower() == ".csv":
        try:
            parsed_rows = list(csv.reader(io.StringIO(text)))
            if parsed_rows:
                csv_schema = {
                    "headers": parsed_rows[0],
                    "rowCount": max(0, len(parsed_rows) - 1),
                    "sampleRows": parsed_rows[1:4],
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
    """Offline regression tests for CSV, URN, filename and TID extraction."""
    sample = (
        "product_id,filename,notes\n"
        "urn:nasa:pds:maven_ngims:l2:mvn_ngi_l2_cso-abund-14282_20141211t154406,"
        "mvn_ngi_l2_cso-abund-14282_20141211T154406_v08_r01.csv,fixture\n"
        "urn:nasa:pds:maven_ngims:l2:mvn_ngi_l2_csn-abund-14282_20141211t154406,"
        "mvn_ngi_l2_csn-abund-14282_20141211T154406_v08_r01.csv,control\n"
    )
    matches: list[dict] = []
    audit = scan_text(
        "fixture.csv",
        "fixture.csv",
        sample.encode("utf-8"),
        matches,
    )
    assert audit["csvSchema"]["rowCount"] == 2, audit
    assert audit["targetTid14282RowCount"] == 2, audit
    assert audit["csoAbundLineCount"] == 1, audit
    assert len(matches) == 1, matches
    assert matches[0]["tid"] == 14282, matches
    assert len(matches[0]["urns"]) == 1, matches
    assert matches[0]["urns"][0].lower().endswith(
        "mvn_ngi_l2_cso-abund-14282_20141211t154406"
    ), matches
    assert any("cso-abund-14282" in name for name in matches[0]["productFileTokens"]), matches
    assert len(audit["uniqueUrns"]) == 2, audit

    control_matches: list[dict] = []
    control = scan_text(
        "fixture.txt",
        "fixture.txt",
        b"ordinary product without an abundance marker",
        control_matches,
    )
    assert control["csoAbundLineCount"] == 0
    assert not control_matches
    print(
        "NGIMS index-bundle self-test: PASS "
        "(CSV schema, TID, URN, filename token, CSO filtering)"
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
