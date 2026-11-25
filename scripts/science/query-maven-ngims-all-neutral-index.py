#!/usr/bin/env python3
"""Query the official NMSU MAVEN/NGIMS all-neutral product selector.

Run once by committing a subject containing [query-ngims-all-neutral].
The script submits the exact public form fields discovered from the live page,
captures its raw HTML response and extracts every returned L2 cso-abund URN.
It does not download measurement CSV payloads; selected URNs must subsequently
be retrieved with their detached PDS4 labels and byte/fixity checks.
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
import time
import urllib.parse
import urllib.request
import http.cookiejar
from urllib.error import HTTPError, URLError
from collections import Counter
from datetime import date
from html.parser import HTMLParser
from pathlib import Path

FORM_PAGE = "https://pds-atmospheres.nmsu.edu/data_and_services/atmospheres_data/MAVEN/ngims_data_search.html"
FORM_ACTIONS = [
    "https://atmos.nmsu.edu:8443/maven_test/NGIMS_Browser",
    "https://atmos.nmsu.edu:8443/maven_test/NGIMS_Browser/",
    "https://atmos-ah-vs.nmsu.edu:8443/maven_test/NGIMS_Browser",
    "https://pds-atmospheres.nmsu.edu:8443/maven_test/NGIMS_Browser",
    "http://atmos.nmsu.edu:8443/maven_test/NGIMS_Browser",
    "https://atmos.nmsu.edu/maven_test/NGIMS_Browser",
    "https://pds-atmospheres.nmsu.edu/maven_test/NGIMS_Browser",
]
OUTPUT_DIR = Path("src/modules/Data/mavenNgimsAllNeutralIndex")
START_DATE = date(2014, 10, 18)
STOP_DATE = date(2025, 2, 15)
PAGE_SIZE = 500
MAX_PAGES_PER_YEAR = 100
URN_RE = re.compile(r"urn:nasa:pds:maven_ngims:l2:[A-Za-z0-9_.:-]+", re.I)
PRODUCT_RE = re.compile(r"mvn_ngi_l2_[A-Za-z0-9_-]+_\d{8}t\d{6}(?:_v\d+_r\d+)?", re.I)
FOCUS_RE = re.compile(r"\b(?:csn|osnb|osnt|osion)\b", re.I)


def clean_text(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


class ResultParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.rows: list[list[str]] = []
        self.links: list[dict[str, str]] = []
        self.inputs: list[dict[str, str]] = []
        self.text_parts: list[str] = []
        self._in_row = False
        self._in_cell = False
        self._cell: list[str] = []
        self._row: list[str] = []
        self._in_anchor = False
        self._anchor: list[str] = []
        self._anchor_href = ""

    def handle_starttag(self, tag: str, attrs) -> None:
        a = dict(attrs)
        tag = tag.lower()
        if tag == "tr":
            self._in_row = True
            self._row = []
        elif tag in {"td", "th"} and self._in_row:
            self._in_cell = True
            self._cell = []
        elif tag == "a":
            self._in_anchor = True
            self._anchor = []
            self._anchor_href = a.get("href", "")
        elif tag == "input":
            self.inputs.append({str(k): str(v) for k, v in a.items() if v is not None})

    def handle_data(self, data: str) -> None:
        value = clean_text(data)
        if value:
            self.text_parts.append(value)
            if self._in_cell:
                self._cell.append(value)
            if self._in_anchor:
                self._anchor.append(value)

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag in {"td", "th"} and self._in_cell:
            self._row.append(clean_text(" ".join(self._cell)))
            self._cell = []
            self._in_cell = False
        elif tag == "tr" and self._in_row:
            if self._row:
                self.rows.append(self._row)
            self._row = []
            self._in_row = False
        elif tag == "a" and self._in_anchor:
            self.links.append({
                "text": clean_text(" ".join(self._anchor)),
                "href": self._anchor_href,
            })
            self._in_anchor = False
            self._anchor = []
            self._anchor_href = ""


COOKIE_JAR = http.cookiejar.CookieJar()
OPENER = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(COOKIE_JAR))


def fetch_search_form() -> dict:
    request = urllib.request.Request(
        FORM_PAGE,
        headers={"User-Agent": "EvoWars-NGIMS-Index-Research/1.0", "Accept": "text/html"},
    )
    with OPENER.open(request, timeout=45) as response:
        body = response.read(4_000_001)
        if len(body) > 4_000_000:
            raise RuntimeError("official NGIMS search form exceeds 4 MB")
        return {
            "url": response.geturl(),
            "httpStatus": response.status,
            "contentType": response.headers.get("Content-Type"),
            "byteLength": len(body),
            "sha256": hashlib.sha256(body).hexdigest(),
            "cookies": [
                {"name": cookie.name, "domain": cookie.domain, "path": cookie.path}
                for cookie in COOKIE_JAR
            ],
            "body": body,
        }


def submit_query(start: date, stop: date, offset: int) -> tuple[bytes, dict]:
    fields = [
        ("slice_start", str(offset)),
        ("slice_size", str(PAGE_SIZE)),
        ("Product type4", "cso-abund"),
        ("Start Time", start.isoformat() + "T00:00:00"),
        ("Stop Time", stop.isoformat() + "T23:59:59"),
    ]
    payload = urllib.parse.urlencode(fields).encode("ascii")
    attempts = []
    for endpoint in FORM_ACTIONS:
        request = urllib.request.Request(
            endpoint,
            data=payload,
            method="POST",
            headers={
                "User-Agent": "EvoWars-NGIMS-Index-Research/1.0",
                "Accept": "text/html,application/xhtml+xml,*/*",
                "Content-Type": "application/x-www-form-urlencoded",
                "Referer": FORM_PAGE,
                "Origin": "https://pds-atmospheres.nmsu.edu",
            },
        )
        try:
            with OPENER.open(request, timeout=45) as response:
                body = response.read(12_000_001)
                if len(body) > 12_000_000:
                    raise RuntimeError("NGIMS selector response exceeds 12 MB safety limit")
                metadata = {
                    "requestStart": start.isoformat(),
                    "requestStop": stop.isoformat(),
                    "sliceStart": offset,
                    "sliceSize": PAGE_SIZE,
                    "endpoint": endpoint,
                    "httpStatus": response.status,
                    "finalUrl": response.geturl(),
                    "contentType": response.headers.get("Content-Type"),
                    "byteLength": len(body),
                    "sha256": hashlib.sha256(body).hexdigest(),
                    "cookies": len(COOKIE_JAR),
                }
                return body, metadata
        except HTTPError as error:
            detail = error.read(1200).decode("utf-8", errors="replace")
            attempts.append({
                "endpoint": endpoint,
                "status": error.code,
                "reason": str(error.reason),
                "server": error.headers.get("Server"),
                "bodyPreview": clean_text(detail)[:500],
            })
        except (URLError, TimeoutError, OSError) as error:
            attempts.append({"endpoint": endpoint, "error": str(error)})
    raise RuntimeError("all official NGIMS selector endpoints failed: " + json.dumps(attempts))

def next_year_bounds(year: int) -> tuple[date, date]:
    start = max(START_DATE, date(year, 1, 1))
    stop = min(STOP_DATE, date(year, 12, 31))
    return start, stop



def extract_selector_identifiers(html: str) -> tuple[list[str], list[str]]:
    """Extract URNs and versioned filename stems without counting URNs as filenames."""
    urns = sorted(set(URN_RE.findall(html)), key=str.lower)
    urn_stems = {urn.rsplit(":", 1)[-1].lower() for urn in urns}
    names = sorted(
        {
            name for name in PRODUCT_RE.findall(html)
            if name.lower() not in urn_stems
        },
        key=str.lower,
    )
    return urns, names


def product_identity_key(product_id: str) -> str:
    """Normalize an L2 product URN or versioned filename to its shared product stem."""
    value = product_id.rsplit(":", 1)[-1]
    value = re.sub(r"_v\d+_r\d+$", "", value, flags=re.IGNORECASE)
    return value.lower()


def record_page_identifiers(
    all_products: dict[str, dict],
    year: int,
    page_path: str,
    urns: list[str],
    product_names: list[str],
) -> None:
    """Merge a page's URN and filename evidence under one stable product identity."""
    for field, identifiers in (("productId", urns), ("fileNameStem", product_names)):
        for identifier in identifiers:
            key = product_identity_key(identifier)
            entry = all_products.setdefault(key, {
                "firstSeenYearQuery": year,
                "responsePages": [],
            })
            entry[field] = identifier
            if page_path not in entry["responsePages"]:
                entry["responsePages"].append(page_path)


def build_source_metadata(form_provenance: dict) -> dict:
    """Return reproducible selector provenance without guessing the winning endpoint."""
    return {
        "formPage": FORM_PAGE,
        "formActionCandidates": FORM_ACTIONS,
        "formMethod": "POST",
        "formFields": {
            "productTypeField": "Product type4",
            "productTypeValue": "cso-abund",
            "startTimeField": "Start Time",
            "stopTimeField": "Stop Time",
            "pagination": {"slice_start": "0-based offset", "slice_size": PAGE_SIZE},
        },
        "formFetch": form_provenance,
        "queryDateRange": {
            "startInclusive": START_DATE.isoformat(),
            "stopInclusive": STOP_DATE.isoformat(),
        },
        "retrievalDate": date.today().isoformat(),
    }


def run_self_tests() -> None:
    """Small offline contract checks; this must not contact the PDS selector."""
    sample_html = """<!doctype html>
    <table><tr><th>Product</th></tr>
    <tr><td><a href="https://example.invalid/urn:nasa:pds:maven_ngims:l2:mvn_ngi_l2_cso-abund-14282_20141211t154406">
    mvn_ngi_l2_cso-abund-14282_20141211T154406_v08_r01</a></td></tr></table>
    <a href="?slice_start=500">Next</a>"""
    parser = ResultParser()
    parser.feed(sample_html)
    urns, names = extract_selector_identifiers(sample_html)
    assert len(parser.rows) == 2, f"expected header + one result row, got {len(parser.rows)}"
    assert len(urns) == 1 and "14282" in urns[0], f"unexpected URNs: {urns!r}"
    assert len(names) == 1 and names[0].endswith("_v08_r01"), f"unexpected product names: {names!r}"
    assert any("slice_start" in link["href"] for link in parser.links), "next-page link was not captured"
    merged: dict[str, dict] = {}
    record_page_identifiers(merged, 2014, "fixture.html", urns, names)
    assert len(merged) == 1, f"URN and CSV filename were not merged: {merged!r}"
    only_product = next(iter(merged.values()))
    assert only_product["productId"] == urns[0] and only_product["fileNameStem"] == names[0]
    assert next_year_bounds(2014) == (date(2014, 10, 18), date(2014, 12, 31))
    assert next_year_bounds(2025) == (date(2025, 1, 1), date(2025, 2, 15))
    source = build_source_metadata({"httpStatus": 200, "sha256": "fixture"})
    assert source["formActionCandidates"] == FORM_ACTIONS
    assert source["formMethod"] == "POST"
    assert source["queryDateRange"]["stopInclusive"] == STOP_DATE.isoformat()
    json.dumps(source)
    print("NGIMS all-neutral selector self-test: PASS (HTML parsing, identifiers, pagination link, date bounds, provenance)")

def main() -> int:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    form = fetch_search_form()
    form_body = form.pop("body")
    (OUTPUT_DIR / "search-form.html").write_bytes(form_body)
    form_provenance = form
    (OUTPUT_DIR / "search-form-provenance.json").write_text(
        json.dumps(form_provenance, ensure_ascii=False, indent=2, sort_keys=True) + "\\n",
        encoding="utf-8",
    )

    all_products: dict[str, dict] = {}
    page_audit: list[dict] = []
    raw_pages: list[dict] = []
    total_rows = 0
    query_years = list(range(START_DATE.year, STOP_DATE.year + 1))

    for year in query_years:
        start, stop = next_year_bounds(year)
        empty_or_short_page = False
        for page_number in range(MAX_PAGES_PER_YEAR):
            offset = page_number * PAGE_SIZE
            body, metadata = submit_query(start, stop, offset)
            page_path = OUTPUT_DIR / f"selector-{year}-offset-{offset:06d}.html"
            page_path.write_bytes(body)
            decoded = body.decode("utf-8", errors="replace")
            parser = ResultParser()
            parser.feed(decoded)
            flat_text = clean_text(" ".join(parser.text_parts))

            urns, product_names = extract_selector_identifiers(decoded)
            metadata.update({
                "year": year,
                "pageNumber": page_number,
                "tableRowCount": len(parser.rows),
                "urnCount": len(urns),
                "productNameCount": len(product_names),
                "urns": urns,
                "productNames": product_names,
                "links": parser.links,
                "inputFields": parser.inputs,
                "responseTextPreview": flat_text[:4000],
                "savedResponse": str(page_path),
            })
            page_audit.append(metadata)
            raw_pages.append({
                "year": year,
                "offset": offset,
                "file": str(page_path),
                "sha256": metadata["sha256"],
                "byteLength": metadata["byteLength"],
            })
            total_rows += len(parser.rows)

            record_page_identifiers(
                all_products, year, str(page_path), urns, product_names
            )

            # No next page when the server returned fewer than PAGE_SIZE rows
            # and neither a full page nor pagination controls suggest more rows.
            next_markers = [
                link for link in parser.links
                if any(token in (link["text"] + " " + link["href"]).lower()
                       for token in ("next", "slice_start", "offset="))
            ]
            if len(parser.rows) < PAGE_SIZE and not next_markers:
                empty_or_short_page = True
                break
            time.sleep(0.15)

        if not empty_or_short_page:
            print(
                f"WARNING: year {year} reached MAX_PAGES_PER_YEAR="
                f"{MAX_PAGES_PER_YEAR}; later pages may remain",
                file=sys.stderr,
            )

    products = sorted(
        all_products.values(),
        key=lambda row: (
            int(re.search(r"-(\d+)_", row.get("productId", "")).group(1))
            if re.search(r"-(\d+)_", row.get("productId", "")) else 0,
            row.get("productId", row.get("fileNameStem", "")).lower(),
        ),
    )
    manifest = {
        "source": build_source_metadata(form_provenance),
        "summary": {
            "queriedYears": query_years,
            "httpResponsePages": len(page_audit),
            "htmlTableRowsTotal": total_rows,
            "uniqueReturnedUrnsAndFilenameStems": len(products),
            "uniqueUrnCount": sum(1 for product in products if product.get("productId")),
            "products": products,
            "paginationPageSize": PAGE_SIZE,
            "maxPagesPerYear": MAX_PAGES_PER_YEAR,
            "possiblyTruncatedYears": [
                year for year in query_years
                if sum(1 for page in page_audit if page["year"] == year) >= MAX_PAGES_PER_YEAR
            ],
        },
        "pages": raw_pages,
        "pageAudit": page_audit,
        "interpretation": {
            "indexOnly": True,
            "measurementCsvPayloadsDownloaded": False,
            "detachedPds4LabelsDownloaded": False,
            "notYetScienceValidated": True,
            "nextStep": "For returned cso-abund URNs, retrieve exact CSV/XML bytes, validate PDS4 label/size/checksum, then inspect per-row species/quality/geometry and co-register only exact event tracks.",
        },
    }
    (OUTPUT_DIR / "all-neutral-selector-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    summary = manifest["summary"]
    print(json.dumps({
        "status": "selector_queried",
        "httpResponsePages": summary["httpResponsePages"],
        "htmlTableRowsTotal": summary["htmlTableRowsTotal"],
        "uniqueReturnedUrnsAndFilenameStems": summary["uniqueReturnedUrnsAndFilenameStems"],
        "uniqueUrnCount": summary["uniqueUrnCount"],
        "possiblyTruncatedYears": summary["possiblyTruncatedYears"],
        "firstProducts": products[:30],
        "manifest": str(OUTPUT_DIR / "all-neutral-selector-manifest.json"),
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    if "--self-test" in sys.argv[1:]:
        try:
            run_self_tests()
            raise SystemExit(0)
        except Exception as error:
            print(f"SELF-TEST FAILED: {error}", file=sys.stderr)
            raise SystemExit(1)
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1)
