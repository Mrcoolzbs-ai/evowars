#!/usr/bin/env python3
"""Audit and exactly cross-index MAVEN NGIMS L2/L3 product identifiers.

Downloads the official PDS product-selection CSV indexes only. It does not
download measurement products, infer concentrations, or declare data
Scheduler-eligible.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import re
import sys
import urllib.request
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

BASE = "https://atmos.nmsu.edu/data_and_services/atmospheres_data/MAVEN/logs/"
OUTPUT = Path("src/modules/Data/mavenNgimsIndexBundleAudit/product-index-audit.json")
MAX_INDEX_BYTES = 50_000_000
TIMEOUT_SECONDS = 120

SOURCES = (
    {
        "key": "l2_single_species",
        "name": "MAVEN_NGIMS_Single-Species_del1-43.csv",
        "url": BASE + "MAVEN_NGIMS_Single-Species_del1-43.csv",
        "expectedLevel": "l2",
    },
    {
        "key": "l3_resampled",
        "name": "Maven_NGIMS_Altitude-Resampled_del 1-40.csv",
        "url": BASE + "Maven_NGIMS_Altitude-Resampled_del%201-40.csv",
        "expectedLevel": "l3",
    },
    {
        "key": "l3_scale_height",
        "name": "MAVEN_NGIMS_Scale-Height&Temp_del1-42.csv",
        "url": BASE + "MAVEN_NGIMS_Scale-Height%26Temp_del1-42.csv",
        "expectedLevel": "l3",
    },
)

PRODUCT_ID_RE = re.compile(
    r"mvn_ngi_(?P<level>l[123])_(?P<product>[a-z0-9-]+)-"
    r"(?P<tid>\d+)_(?P<time>\d{8}t\d{6})",
    re.IGNORECASE,
)


def download_index(source: dict[str, str]) -> tuple[bytes, dict[str, Any]]:
    request = urllib.request.Request(
        source["url"],
        headers={
            "User-Agent": "EvoWars-NGIMS-Product-Index-Audit/1.0",
            "Accept": "text/csv,text/plain,*/*",
            "Accept-Encoding": "identity",
        },
    )
    with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
        if response.status != 200:
            raise RuntimeError(f"HTTP {response.status}: {source['name']}")
        body = response.read(MAX_INDEX_BYTES + 1)
        if len(body) > MAX_INDEX_BYTES:
            raise RuntimeError(f"{source['name']} exceeds {MAX_INDEX_BYTES} bytes")
        return body, {
            "url": source["url"],
            "httpStatus": response.status,
            "contentType": response.headers.get("Content-Type"),
            "contentLengthHeader": response.headers.get("Content-Length"),
            "byteLength": len(body),
            "sha256": hashlib.sha256(body).hexdigest(),
        }


def find_header(rows: list[list[str]]) -> tuple[int, list[str]]:
    for index, row in enumerate(rows):
        names = {value.strip().casefold() for value in row}
        if "urn" in names and (
            "time of closest approach" in names
            or {"start time", "stop time"}.issubset(names)
        ):
            return index, [value.strip() for value in row]
    raise ValueError("CSV header with URN and observation-time fields not found")


def column(headers: list[str], *aliases: str) -> int | None:
    lookup = {name.casefold(): index for index, name in enumerate(headers)}
    for alias in aliases:
        if alias.casefold() in lookup:
            return lookup[alias.casefold()]
    return None


def value(row: list[str], index: int | None) -> str | None:
    if index is None or index >= len(row):
        return None
    result = row[index].strip()
    return result or None


def parse_index(
    source: dict[str, str], body: bytes
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    text = body.decode("utf-8-sig", errors="replace")
    rows = list(csv.reader(io.StringIO(text, newline="")))
    preamble_rows, headers = find_header(rows)
    columns = {
        "urn": column(headers, "URN"),
        "closestApproachTimeUtc": column(headers, "Time of Closest Approach"),
        "startTimeUtc": column(headers, "Start Time"),
        "stopTimeUtc": column(headers, "Stop Time"),
        "altitudeKm": column(headers, "Altitude (km)", "Altitude"),
        "solarLongitudeDeg": column(headers, "Solar Longitude (deg)", "Ls"),
        "martianYear": column(headers, "Martian Year"),
    }
    if columns["urn"] is None:
        raise ValueError(f"{source['name']}: URN column missing")

    records: list[dict[str, Any]] = []
    diagnostics: list[dict[str, Any]] = []
    counts: Counter[str] = Counter()
    seen_urns: set[str] = set()

    for row_number, row in enumerate(rows[preamble_rows + 1:], start=preamble_rows + 2):
        urn = value(row, columns["urn"])
        if not urn:
            continue
        match = PRODUCT_ID_RE.search(urn)
        if not match:
            diagnostics.append({
                "rowNumber": row_number,
                "reason": "unrecognized_product_urn",
                "urn": urn[:500],
            })
            continue

        level = match.group("level").lower()
        product_type = match.group("product").lower()
        if level != source["expectedLevel"]:
            diagnostics.append({
                "rowNumber": row_number,
                "reason": "unexpected_product_level",
                "urn": urn,
                "expected": source["expectedLevel"],
                "actual": level,
            })
            continue
        if urn.casefold() in seen_urns:
            diagnostics.append({
                "rowNumber": row_number,
                "reason": "duplicate_urn",
                "urn": urn,
            })
            continue

        seen_urns.add(urn.casefold())
        counts[f"{level}:{product_type}"] += 1
        records.append({
            "sourceIndex": source["key"],
            "level": level,
            "productType": product_type,
            "tid": int(match.group("tid")),
            "productTime": match.group("time").lower(),
            "urn": urn,
            "closestApproachTimeUtc": value(row, columns["closestApproachTimeUtc"]),
            "startTimeUtc": value(row, columns["startTimeUtc"]),
            "stopTimeUtc": value(row, columns["stopTimeUtc"]),
            "altitudeKm": value(row, columns["altitudeKm"]),
            "solarLongitudeDeg": value(row, columns["solarLongitudeDeg"]),
            "martianYear": value(row, columns["martianYear"]),
            "rowNumber": row_number,
        })

    return {
        "name": source["name"],
        "url": source["url"],
        "expectedLevel": source["expectedLevel"],
        "byteLength": len(body),
        "preambleRowCount": preamble_rows,
        "headers": headers,
        "rowCount": max(0, len(rows) - preamble_rows - 1),
        "parsedProductCount": len(records),
        "productTypeCounts": dict(sorted(counts.items())),
        "diagnosticCount": len(diagnostics),
        "diagnosticsSample": diagnostics[:25],
        "duplicateUrnCount": sum(d["reason"] == "duplicate_urn" for d in diagnostics),
    }, records


def role(record: dict[str, Any]) -> str | None:
    key = (record["level"], record["productType"])
    return {
        ("l2", "csn-abund"): "l2_csn",
        ("l2", "cso-abund"): "l2_cso",
        ("l3", "res-den"): "l3_res_den",
        ("l3", "res-sht"): "l3_res_sht",
    }.get(key)


def build_exact_event_join(records: list[dict[str, Any]]) -> dict[str, Any]:
    """Join exact event keys; collapse repeated identical URNs across indexes only."""
    empty_group = lambda: {
        "l2_csn": [], "l2_cso": [], "l3_res_den": [], "l3_res_sht": []
    }
    groups: dict[tuple[int, str], dict[str, list[dict[str, Any]]]] = defaultdict(empty_group)
    for record in records:
        event_role = role(record)
        if event_role:
            groups[(record["tid"], record["productTime"])][event_role].append(record)

    comparable_fields = (
        "level",
        "productType",
        "tid",
        "productTime",
        "startTimeUtc",
        "stopTimeUtc",
        "closestApproachTimeUtc",
        "altitudeKm",
        "solarLongitudeDeg",
        "martianYear",
    )

    exact_events: list[dict[str, Any]] = []
    complete_triples: list[dict[str, Any]] = []
    rejected_keys: list[dict[str, Any]] = []
    catalog_duplicate_details: list[dict[str, Any]] = []
    collapsed_catalog_references = 0
    partial_pairs: Counter[str] = Counter()

    for (tid, product_time), group in sorted(groups.items()):
        unique_group: dict[str, list[dict[str, Any]]] = {}
        identity_conflicts: list[dict[str, Any]] = []

        for event_role, items in group.items():
            by_urn: dict[str, dict[str, Any]] = {}
            for item in items:
                urn_key = item["urn"].casefold()
                existing = by_urn.get(urn_key)
                if existing is None:
                    normalized = dict(item)
                    normalized["sourceIndexes"] = [item["sourceIndex"]]
                    by_urn[urn_key] = normalized
                    continue

                existing_signature = tuple(existing.get(field) for field in comparable_fields)
                incoming_signature = tuple(item.get(field) for field in comparable_fields)
                if existing_signature != incoming_signature:
                    identity_conflicts.append({
                        "role": event_role,
                        "urn": item["urn"],
                        "existingSourceIndex": existing["sourceIndex"],
                        "duplicateSourceIndex": item["sourceIndex"],
                        "reason": "same_urn_has_conflicting_catalog_metadata",
                    })
                    continue

                collapsed_catalog_references += 1
                if item["sourceIndex"] not in existing["sourceIndexes"]:
                    existing["sourceIndexes"].append(item["sourceIndex"])
                catalog_duplicate_details.append({
                    "tid": tid,
                    "productTime": product_time,
                    "role": event_role,
                    "urn": item["urn"],
                    "sourceIndexes": sorted(existing["sourceIndexes"]),
                    "reason": "identical_urn_and_metadata_listed_in_multiple_indexes",
                })

            unique_group[event_role] = sorted(
                by_urn.values(), key=lambda value: value["urn"].casefold()
            )

        multiplicities = {
            event_role: len(items) for event_role, items in unique_group.items()
        }
        ambiguous_roles = {
            event_role: [item["urn"] for item in items]
            for event_role, items in unique_group.items()
            if len(items) > 1
        }
        if ambiguous_roles or identity_conflicts:
            rejected_keys.append({
                "tid": tid,
                "productTime": product_time,
                "reason": (
                    "same_urn_metadata_conflict"
                    if identity_conflicts
                    else "multiple_distinct_urns_for_same_role"
                ),
                "multiplicities": multiplicities,
                "ambiguousRoles": ambiguous_roles,
                "identityConflicts": identity_conflicts,
            })
            continue

        present = {
            event_role for event_role, count in multiplicities.items() if count == 1
        }
        if present:
            exact_events.append({
                "tid": tid,
                "productTime": product_time,
                "presentRoles": sorted(present),
            })

        required = {"l2_csn", "l3_res_den", "l3_res_sht"}
        if required.issubset(present):
            products = {
                event_role: unique_group[event_role][0]
                for event_role in sorted(required)
            }
            windows = [
                (item["startTimeUtc"], item["stopTimeUtc"])
                for item in products.values()
            ]
            all_windows_present = all(start and stop for start, stop in windows)
            window_agreement = all_windows_present and len(set(windows)) == 1
            complete_triples.append({
                "tid": tid,
                "productTime": product_time,
                "products": {
                    event_role: {
                        "urn": item["urn"],
                        "sourceIndex": item["sourceIndex"],
                        "sourceIndexes": sorted(item["sourceIndexes"]),
                        "startTimeUtc": item["startTimeUtc"],
                        "stopTimeUtc": item["stopTimeUtc"],
                        "closestApproachTimeUtc": item["closestApproachTimeUtc"],
                        "altitudeKm": item["altitudeKm"],
                        "solarLongitudeDeg": item["solarLongitudeDeg"],
                        "martianYear": item["martianYear"],
                    }
                    for event_role, item in products.items()
                },
                "timeWindowStatus": (
                    "agree" if window_agreement
                    else "conflict" if all_windows_present
                    else "incomplete"
                ),
                "schedulerEligible": False,
            })

        if {"l2_csn", "l3_res_den"}.issubset(present):
            partial_pairs["l2_csn+l3_res_den"] += 1
        if {"l2_csn", "l3_res_sht"}.issubset(present):
            partial_pairs["l2_csn+l3_res_sht"] += 1
        if {"l3_res_den", "l3_res_sht"}.issubset(present):
            partial_pairs["l3_res_den+l3_res_sht"] += 1

    return {
        "joinKey": ["tid", "productTime from exact PDS URN"],
        "fuzzyMatching": False,
        "interpolation": False,
        "exactEventKeyCount": len(exact_events),
        "completeTripleCount": len(complete_triples),
        "coherentTimeWindowTripleCount": sum(
            item["timeWindowStatus"] == "agree" for item in complete_triples
        ),
        "partialPairCounts": dict(sorted(partial_pairs.items())),
        "duplicateCatalogReferencesCollapsed": collapsed_catalog_references,
        "duplicateCatalogReferenceDetails": catalog_duplicate_details[:100],
        "duplicateJoinKeysRejected": rejected_keys,
        "completeTriples": complete_triples,
    }


def run_self_tests() -> None:
    sources = {item["key"]: item for item in SOURCES}
    samples = {
        "l2_single_species": (
            "Note: fixture preamble\n"
            "Time of Closest Approach,URN,Start Time,Stop Time,Product Type,Altitude (km)\n"
            "2014-12-11T16:37:34Z,urn:nasa:pds:maven_ngims:l2:mvn_ngi_l2_csn-abund-14282_20141211t154406,2014-12-11T15:45:25Z,2014-12-11T17:29:43Z,csn-abund,152.981\n"
            "2016-08-22T15:22:36Z,urn:nasa:pds:maven_ngims:l2:mvn_ngi_l2_csn-abund-20902_20160822t142824,2016-08-22T14:30:25Z,2016-08-22T16:14:48Z,csn-abund,153.495\n"
        ),
        "l3_resampled": (
            "Note: fixture preamble\n"
            "Time of Closest Approach,URN,Start Time,Stop Time,Altitude (km)\n"
            "2014-12-11T16:37:34Z,urn:nasa:pds:maven_ngims:l3:mvn_ngi_l3_res-den-14282_20141211t154406,2014-12-11T15:45:25Z,2014-12-11T17:29:43Z,152.981\n"
        ),
        "l3_scale_height": (
            "Note: fixture preamble\n"
            "Time of Closest Approach,URN,Start Time,Stop Time,Altitude (km)\n"
            "2014-12-11T16:37:34Z,urn:nasa:pds:maven_ngims:l3:mvn_ngi_l3_res-sht-14282_20141211t154406,2014-12-11T15:45:25Z,2014-12-11T17:29:43Z,464.9283\n"
        ),
    }
    records: list[dict[str, Any]] = []
    parsed_by_source: dict[str, list[dict[str, Any]]] = {}
    for key, source in sources.items():
        _, parsed = parse_index(source, samples[key].encode("utf-8"))
        parsed_by_source[key] = parsed
        records.extend(parsed)

    joined = build_exact_event_join(records)
    assert joined["completeTripleCount"] == 1, joined
    assert joined["coherentTimeWindowTripleCount"] == 1, joined
    assert joined["completeTriples"][0]["tid"] == 14282, joined
    assert joined["completeTriples"][0]["timeWindowStatus"] == "agree", joined
    assert not any(item["tid"] == 20902 for item in joined["completeTriples"])

    # Same exact PDS URN + same metadata in two official indexes is one product,
    # not two competing measurements.
    repeated_resden = dict(parsed_by_source["l3_resampled"][0])
    repeated_resden["sourceIndex"] = "l3_scale_height"
    collapsed = build_exact_event_join(records + [repeated_resden])
    assert collapsed["completeTripleCount"] == 1, collapsed
    assert collapsed["duplicateCatalogReferencesCollapsed"] == 1, collapsed
    resden = collapsed["completeTriples"][0]["products"]["l3_res_den"]
    assert resden["sourceIndexes"] == ["l3_resampled", "l3_scale_height"], resden

    # A different URN for the same key/role is genuinely ambiguous and fails closed.
    conflicting_urn = dict(repeated_resden)
    conflicting_urn["urn"] += "-alternate"
    ambiguous = build_exact_event_join(records + [conflicting_urn])
    assert ambiguous["completeTripleCount"] == 0, ambiguous
    assert ambiguous["duplicateJoinKeysRejected"], ambiguous

    # A triple can exist by exact product key while its observation windows disagree.
    conflict_windows = [dict(item) for item in records]
    sht = next(item for item in conflict_windows if item["productType"] == "res-sht")
    sht["stopTimeUtc"] = "2014-12-11T17:30:00Z"
    window_conflict = build_exact_event_join(conflict_windows)
    assert window_conflict["completeTripleCount"] == 1, window_conflict
    assert window_conflict["coherentTimeWindowTripleCount"] == 0, window_conflict
    assert window_conflict["completeTriples"][0]["timeWindowStatus"] == "conflict"

    print(
        "NGIMS product-index self-test: PASS "
        "(exact event joins, catalog-reference collapse, ambiguity rejection, window conflict)"
    )


def main() -> int:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    index_audits: list[dict[str, Any]] = []
    all_records: list[dict[str, Any]] = []
    failures: list[dict[str, str]] = []

    for source in SOURCES:
        try:
            body, provenance = download_index(source)
            audit, records = parse_index(source, body)
            index_audits.append({**provenance, **audit})
            all_records.extend(records)
        except Exception as error:
            failures.append({"source": source["name"], "error": str(error)})
            index_audits.append({"name": source["name"], "url": source["url"], "error": str(error)})

    counts = Counter(f"{item['level']}:{item['productType']}" for item in all_records)
    joined = build_exact_event_join(all_records)
    manifest = {
        "generatedAtUtc": datetime.now(timezone.utc).isoformat(),
        "sourcePage": "https://atmos.nmsu.edu/data_and_services/atmospheres_data/MAVEN/ngims.html",
        "scope": "official product-selection CSV indexes only; no measurement payloads",
        "indexes": index_audits,
        "summary": {
            "successfulIndexes": sum("error" not in item for item in index_audits),
            "failedIndexes": failures,
            "parsedProductRecords": len(all_records),
            "productTypeCounts": dict(sorted(counts.items())),
            "exactEventKeyCount": joined["exactEventKeyCount"],
            "completeL2CsnL3ResDenResShtTripleCount": joined["completeTripleCount"],
            "coherentTimeWindowTripleCount": joined["coherentTimeWindowTripleCount"],
            "duplicateJoinKeysRejected": len(joined["duplicateJoinKeysRejected"]),
            "tid14282Candidates": [
                item for item in joined["completeTriples"] if item["tid"] == 14282
            ],
        },
        "exactEventJoin": joined,
        "interpretation": {
            "indexOnly": True,
            "measurementCsvPayloadsDownloaded": False,
            "detachedPds4LabelsDownloaded": False,
            "rowQualityValidated": False,
            "schedulerEligible": False,
            "joinPolicy": "exact (TID, product timestamp extracted from PDS URN); duplicate keys fail closed; no fuzzy matching or interpolation",
            "nextStep": "Retrieve selected exact L2/L3 CSV/XML pairs, validate PDS4 identity/size/checksum and row quality, then compare actual coverage and timing before scientific use.",
        },
    }
    OUTPUT.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(manifest["summary"], ensure_ascii=False, indent=2))
    return 0 if not failures else 1


if __name__ == "__main__":
    if "--self-test" in sys.argv[1:]:
        run_self_tests()
        raise SystemExit(0)
    raise SystemExit(main())
