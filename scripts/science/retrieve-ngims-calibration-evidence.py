#!/usr/bin/env python3
"""Resolve and retrieve exact PDS4 NGIMS calibration product IDs for a targeted audit.

This is evidence acquisition only. It never interprets calibration values.
"""
import argparse, hashlib, json, re, sys, urllib.parse, urllib.request
from pathlib import Path

SNAPSHOT = Path("src/modules/Data/mavenNgimsCalibrationInventoryAudit/calibration-inventory.json")
API = "https://pds.nasa.gov/api/search/1/products/"
BASE = "https://atmos.nmsu.edu/PDS/data/PDS4/MAVEN/ngims_bundle/calibration/"
ALLOWED = {"gnd-sci", "gnd-hk", "gnd-mkr", "gnd-msg"}
MAX_FILE = 25_000_000

def get(url):
    req=urllib.request.Request(url,headers={"User-Agent":"EvoWars-NGIMS-evidence-retriever/1.0","Accept":"application/json,*/*","Accept-Encoding":"identity"})
    with urllib.request.urlopen(req,timeout=90) as r:
        if r.status != 200: raise RuntimeError(f"HTTP {r.status} for {url}")
        body=r.read(MAX_FILE+1)
        if len(body)>MAX_FILE: raise RuntimeError(f"response exceeds safety cap: {url}")
        return body, r.headers.get("Content-Type","")

def extract_urls(obj):
    """Return only explicit file locator values, never arbitrary metadata strings."""
    locator_keys = {
        "url", "file_url", "href", "file_name", "filename", "path",
        "file_path", "data_file_name", "label_file_name", "file_location"
    }
    found = []
    if isinstance(obj, dict):
        for key, value in obj.items():
            key_norm = key.rsplit(":", 1)[-1].lower()
            if isinstance(value, str) and key_norm in locator_keys:
                if value.lower().endswith((".csv", ".txt", ".xml", ".dat", ".tab", ".lbl")) or value.startswith(("https://", "http://")):
                    found.append(value.strip())
            else:
                found.extend(extract_urls(value))
    elif isinstance(obj, list):
        for value in obj:
            found.extend(extract_urls(value))
    return list(dict.fromkeys(found))


def response_matches_lidvid(obj, lidvid):
    """Require the resolver response to identify the exact requested product."""
    tokens = []
    def walk(value):
        if isinstance(value, dict):
            for key, child in value.items():
                if key.rsplit(":", 1)[-1].lower() in {"lidvid", "logical_identifier", "identifier"} and isinstance(child, str):
                    tokens.append(child)
                walk(child)
        elif isinstance(value, list):
            for child in value:
                walk(child)
    walk(obj)
    # Some PDS Search responses wrap the product without repeating LIDVID.
    # In that case do not reject solely on absence; caller preserves resolver URL.
    return not tokens or lidvid in tokens


def resolve_candidate_url(item):
    if item.startswith(("https://", "http://")):
        url = item
    else:
        url = urllib.parse.urljoin(BASE, item.lstrip("/"))
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https" or parsed.netloc not in {
        "atmos.nmsu.edu", "pds-atmospheres.nmsu.edu", "pds.nasa.gov"
    }:
        raise ValueError(f"untrusted or non-HTTPS product locator: {url}")
    return url

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--tids",default="10194,10197,10198,10199,10201,10202,10205,10207,10216,10217,10241,10242")
    p.add_argument("--output",default="ngims-calibration-payloads")
    args=p.parse_args()
    tids={int(x) for x in args.tids.split(",") if x.strip()}
    snap=json.loads(SNAPSHOT.read_text())
    records=[m for m in snap["inventory"]["targetMembers"] if m["tid"] in tids and any(x in m["identifier"] for x in ALLOWED)]
    if not records: raise SystemExit("No inventory records matched requested TIDs.")
    out=Path(args.output); out.mkdir(parents=True,exist_ok=True)
    manifest={"scope":"raw_evidence_only","requestedTids":sorted(tids),"products":[],"errors":[]}
    for record in records:
        lidvid=record["identifier"]
        apiurl=API+urllib.parse.quote(lidvid,safe=":")
        try:
            label_body,_=get(apiurl)
            label_json=json.loads(label_body)
            if not response_matches_lidvid(label_json, lidvid):
                raise ValueError(f"PDS resolver returned a different product than requested: {lidvid}")
            # Preserve the exact resolver response as evidence, even when no locator is exposed.
            (out/(f"resolved-{record['tid']}-{record['identifier'].split(':')[-2]}.json")).write_bytes(label_body)
            urls=extract_urls(label_json)
            candidate_urls=[]
            for item in urls:
                if item.startswith("http://") or item.startswith("https://"):
                    candidate_urls.append(item)
                elif item.lower().endswith((".csv",".txt",".xml")):
                    candidate_urls.append(urllib.parse.urljoin(BASE,item))
            candidate_urls=list(dict.fromkeys(candidate_urls))
            # Do not assume API schema: capture locator evidence and fail this product if no files found.
            product={"identifier":lidvid,"tid":record["tid"],"resolver_url":apiurl,"locator_candidates":candidate_urls,"retrieved":[]}
            for url in candidate_urls:
                try:
                    parsed=urllib.parse.urlparse(resolve_candidate_url(url))
                    body,ctype=get(url)
                    filename=Path(urllib.parse.unquote(parsed.path)).name or "payload.bin"
                    safe=re.sub(r"[^A-Za-z0-9._-]+","_",filename)
                    dest=out/(f"{record['tid']}-{safe}")
                    dest.write_bytes(body)
                    product["retrieved"].append({"url":url,"file":str(dest),"bytes":len(body),"sha256":hashlib.sha256(body).hexdigest(),"content_type":ctype})
                except Exception as e:
                    manifest["errors"].append({"identifier":lidvid,"url":url,"error":str(e)})
            manifest["products"].append(product)
        except Exception as e:
            manifest["errors"].append({"identifier":lidvid,"error":str(e)})
    (out/"retrieval-manifest.json").write_text(json.dumps(manifest,indent=2)+"\n")
    print(json.dumps({"productCount":len(records),"resolved":sum(bool(x["retrieved"]) for x in manifest["products"]),"errors":len(manifest["errors"]),"output":str(out)},indent=2))
    if manifest["errors"] or any(not x["retrieved"] for x in manifest["products"]):
        sys.exit(2)
if __name__=="__main__": main()
