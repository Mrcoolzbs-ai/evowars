#!/usr/bin/env python3
"""Freeze PDS MAVEN/NGIMS calibration collection inventory for targeted TIDs.

This downloads the official collection inventory and label only. It does not
retrieve calibration science payloads, fit sensitivities, or enable density
conversion.
"""
from __future__ import annotations
import csv, hashlib, io, json, re, sys, urllib.request
from datetime import datetime, timezone
from pathlib import Path

BASE = "https://atmos.nmsu.edu/PDS/data/PDS4/MAVEN/ngims_bundle/calibration/"
SOURCES = {
    "inventory_csv": BASE + "collection_ngims_calibration_inventory.csv",
    "collection_label": BASE + "collection_ngims_calibration_inventory.xml",
}
OUTPUT = Path("src/modules/Data/mavenNgimsCalibrationInventoryAudit/calibration-inventory.json")
TARGET_TIDS = {10191,10194,10197,10198,10199,10201,10202,10205,10207,10216,10217,10241,10242}
TID_RE = re.compile(r"(?:mvn_ngi_[a-z0-9_-]*?|tid[-_])(?P<tid>\d{4,6})(?:[_:]|\b)", re.I)
MAX_BYTES = 10_000_000

def download(url: str) -> tuple[bytes,dict]:
    req=urllib.request.Request(url,headers={"User-Agent":"EvoWars-NGIMS-Calibration-Inventory/1.0","Accept":"text/csv,text/xml,*/*","Accept-Encoding":"identity"})
    with urllib.request.urlopen(req,timeout=90) as res:
        if res.status != 200: raise RuntimeError(f"HTTP {res.status}: {url}")
        body=res.read(MAX_BYTES+1)
        if len(body)>MAX_BYTES: raise RuntimeError(f"payload exceeds cap: {url}")
        return body,{"url":url,"status":res.status,"contentType":res.headers.get("Content-Type"),"bytes":len(body),"sha256":hashlib.sha256(body).hexdigest()}

def parse_inventory(body:bytes) -> dict:
    text=body.decode("utf-8-sig",errors="strict")
    rows=list(csv.reader(io.StringIO(text,newline="")))
    members=[]; diagnostics=[]
    for i,row in enumerate(rows,1):
        if not row or all(not x.strip() for x in row): continue
        if len(row)<2:
            diagnostics.append({"line":i,"reason":"short_record","raw":row});continue
        status,lidvid=row[0].strip(),row[1].strip()
        if status not in {"P","S"}:
            diagnostics.append({"line":i,"reason":"unknown_member_status","status":status,"identifier":lidvid});continue
        tid_match=re.search(r"(?:mvn_ngi_[a-z0-9_-]*?)(\d{4,6})(?:[_:]|\b)",lidvid,re.I)
        tid=int(tid_match.group(1)) if tid_match else None
        members.append({"status":status,"identifier":lidvid,"tid":tid,"target":tid in TARGET_TIDS if tid is not None else False})
    return {"recordCount":len(members),"primaryCount":sum(m["status"]=="P" for m in members),"secondaryCount":sum(m["status"]=="S" for m in members),"targetTidCounts":{str(t):sum(m["tid"]==t for m in members) for t in sorted(TARGET_TIDS)},"targetMembers":[m for m in members if m["target"]],"unparsedTidCount":sum(m["tid"] is None for m in members),"diagnostics":diagnostics,"members":members}

def self_test():
    sample=b'P,urn:nasa:pds:maven_ngims:calibration:mvn_ngi_l1a_gnd_sci_010191_20120923T000000_v01_r01::1.0\nS,urn:nasa:pds:maven_ngims:calibration:mvn_ngi_l1a_gnd_hk_010194_20120923T000000_v01_r01::1.0\n'
    result=parse_inventory(sample)
    assert result["recordCount"]==2
    assert result["targetTidCounts"]["10191"]==1 and result["targetTidCounts"]["10194"]==1
    assert result["primaryCount"]==1 and result["secondaryCount"]==1
    print("self-test passed")

def main():
    if "--self-test" in sys.argv: self_test();return
    fetched={}
    meta={}
    for key,url in SOURCES.items():
        body,source_meta=download(url);meta[key]=source_meta
        fetched[key]=body
    parsed=parse_inventory(fetched["inventory_csv"])
    snapshot={"schemaVersion":1,"retrievedAtUtc":datetime.now(timezone.utc).isoformat(),"scope":"inventory_only_not_calibration","sources":meta,"inventory":parsed,"limitations":["Inventory identifiers are not proof that payloads were retrieved or validated.","No science spectra, calibration values, chamber pressure, external gauge, C_EN, flight applicability, or CPS-to-density conversion is derived."]}
    OUTPUT.parent.mkdir(parents=True,exist_ok=True)
    OUTPUT.write_text(json.dumps(snapshot,indent=2,sort_keys=True)+"\n",encoding="utf-8")
    print(f"Saved {OUTPUT}: {parsed['recordCount']} members; {len(parsed['targetMembers'])} targeted TID entries")
if __name__=="__main__": main()
