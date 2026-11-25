#!/usr/bin/env python3
"""Inspect the official PDS Atmospheres NGIMS selection form (no data download).
Trigger the one-shot workflow with [inspect-ngims-retrieval-form] in a commit subject.

Trigger this diagnostic once with [inspect-ngims-retrieval-form] in a commit
subject. The output contains only public form names/actions and option values.
"""
from __future__ import annotations

import json
import urllib.parse
import urllib.request
from html.parser import HTMLParser

URL = "https://pds-atmospheres.nmsu.edu/data_and_services/atmospheres_data/MAVEN/ngims_data_search.html"


class FormInspector(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.forms = []
        self.current = None
        self.current_select = None
        self.scripts = []
        self.in_script = False
        self.script_text = ""
        self.page_buttons = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag.lower() == "script":
            self.in_script = True
            self.script_text = ""
        if tag.lower() in {"button"}:
            self.page_buttons.append({"attrs": attrs, "text": ""})
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
        if self.in_script:
            self.script_text += data
        if self.current_select and self.current_select["options"]:
            self.current_select["options"][-1]["text"] += data.strip()
        elif self.current and self.current["buttons"]:
            self.current["buttons"][-1]["text"] += data.strip()

    def handle_endtag(self, tag):
        if tag.lower() == "script":
            if self.script_text.strip():
                self.scripts.append(self.script_text)
            self.in_script = False
            self.script_text = ""
        if tag.lower() == "select":
            self.current_select = None
        elif tag.lower() == "form":
            self.current = None
            self.current_select = None



class LinkCollector(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.links = []
        self.text_parts = []
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag.lower() == "a":
            self.links.append({"href": attrs.get("href"), "text": ""})
    def handle_data(self, data):
        stripped = data.strip()
        if stripped:
            self.text_parts.append(stripped)
            if self.links:
                self.links[-1]["text"] += stripped

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
    print(json.dumps({
        "forms": parser.forms,
        "scriptsWithFormValidation": [
            block for block in parser.scripts
            if "function check" in block or "Start Time" in block or "postForm" in block
        ],
        "pageButtons": parser.page_buttons,
    }, ensure_ascii=False, indent=2))

    post_url = "https://atmos.nmsu.edu:8443/maven_test/NGIMS_Browser"
    post_fields = [
        ("slice_start", "0"),
        ("slice_size", "100"),
        ("Product type4", "cso-abund"),
        ("Start Time", "2014-12-11T15:45:25"),
        ("Stop Time", "2014-12-11T17:29:43"),
        ("Martian Year", "32"),
    ]
    encoded = urllib.parse.urlencode(post_fields).encode("utf-8")
    post_request = urllib.request.Request(
        post_url,
        data=encoded,
        headers={
            "User-Agent": "EvoWars-NGIMS-Form-Inspector/1.0",
            "Accept": "text/html,*/*",
            "Content-Type": "application/x-www-form-urlencoded",
            "Referer": URL,
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(post_request, timeout=90) as response:
            body = response.read(12_000_001)
            if len(body) > 12_000_000:
                raise RuntimeError("PDS NGIMS selector response exceeds 12 MB")
            response_text = body.decode("utf-8", errors="replace")
            links = LinkCollector()
            links.feed(response_text)
            print(json.dumps({
                "post": {
                    "url": response.geturl(),
                    "status": response.status,
                    "contentType": response.headers.get("Content-Type"),
                    "byteLength": len(body),
                    "requestedFields": post_fields,
                    "responseTitle": (
                        response_text.split("<title>", 1)[1].split("</title>", 1)[0]
                        if "<title>" in response_text and "</title>" in response_text
                        else None
                    ),
                    "links": links.links[:200],
                    "responseTextExcerpt": response_text[:16000],
                }
            }, ensure_ascii=False, indent=2))
    except Exception as error:
        print(json.dumps({"postError": repr(error), "requestedFields": post_fields}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
