#!/usr/bin/env python3
"""Inspect the official PDS Atmospheres NGIMS selection form (no data download).
Trigger the one-shot workflow with [inspect-ngims-retrieval-form] in a commit subject.

Trigger this diagnostic once with [inspect-ngims-retrieval-form] in a commit
subject. The output contains only public form names/actions and option values.
"""
from __future__ import annotations

import json
import urllib.request
from html.parser import HTMLParser

URL = "https://pds-atmospheres.nmsu.edu/data_and_services/atmospheres_data/MAVEN/ngims_data_search.html"


class FormInspector(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.forms = []
        self.current = None
        self.current_select = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag.lower() == "form":
            self.current = {"tag": "form", **attrs, "inputs": [], "selects": [], "buttons": []}
            self.forms.append(self.current)
        elif self.current is not None and tag.lower() == "input":
            self.current["inputs"].append(attrs)
        elif self.current is not None and tag.lower() == "select":
            self.current_select = {"attrs": attrs, "options": []}
            self.current["selects"].append(self.current_select)
        elif self.current is not None and tag.lower() == "option" and self.current_select is not None:
            self.current_select["options"].append({"attrs": attrs, "text": ""})
        elif self.current is not None and tag.lower() in {"button", "textarea"}:
            self.current["buttons"].append({"tag": tag, "attrs": attrs, "text": ""})

    def handle_data(self, data):
        if self.current_select and self.current_select["options"]:
            self.current_select["options"][-1]["text"] += data.strip()
        elif self.current and self.current["buttons"]:
            self.current["buttons"][-1]["text"] += data.strip()

    def handle_endtag(self, tag):
        if tag.lower() == "select":
            self.current_select = None
        elif tag.lower() == "form":
            self.current = None
            self.current_select = None


def main() -> int:
    req = urllib.request.Request(
        URL,
        headers={"User-Agent": "EvoWars-NGIMS-Form-Inspector/1.0", "Accept": "text/html"},
    )
    with urllib.request.urlopen(req, timeout=45) as response:
        html = response.read(4_000_001)
        if len(html) > 4_000_000:
            raise RuntimeError("NGIMS search page exceeded diagnostic safety limit")
        print(json.dumps({
            "url": response.geturl(),
            "status": response.status,
            "contentType": response.headers.get("Content-Type"),
            "byteLength": len(html),
        }, indent=2))
    parser = FormInspector()
    parser.feed(html.decode("utf-8", errors="replace"))
    print(json.dumps({"forms": parser.forms}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
