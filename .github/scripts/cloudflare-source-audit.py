#!/usr/bin/env python3
"""Sanitized static scan for a downloaded Cloudflare Worker source bundle.

The script intentionally prints metadata and structural signals only. It never
prints source lines, string literal values, or suspected credential values.
"""

from __future__ import annotations

import hashlib
import re
import sys
from pathlib import Path
from urllib.parse import urlparse


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: cloudflare-source-audit.py <worker-source>", file=sys.stderr)
        return 2

    path = Path(sys.argv[1])
    raw = path.read_bytes()
    text = raw.decode("utf-8", "replace")
    lines = text.splitlines()

    env_refs = sorted(set(re.findall(r"\benv\.([A-Za-z_][A-Za-z0-9_]*)", text)))

    hosts: set[str] = set()
    for url in re.findall(r"https?://[^\s\"'<>]+", text):
        hostname = urlparse(url).hostname
        if hostname:
            hosts.add(hostname)

    routes = sorted(
        set(re.findall(r"[\"'](/api/[A-Za-z0-9_./?=&:%+\-]*)[\"']", text))
    )

    secret_pattern = re.compile(
        r"(?i)(api[_-]?key|token|secret|authorization)\s*[:=]\s*[\"'][^\"']{12,}[\"']"
    )
    secret_lines = [
        line_no
        for line_no, line in enumerate(lines, 1)
        if secret_pattern.search(line)
    ]

    handlers = {
        "fetch": bool(re.search(r"\bfetch\s*\(", text)),
        "scheduled": bool(re.search(r"\bscheduled\s*\(", text)),
        "export_default": "export default" in text,
    }

    d1_tokens = [".prepare(", ".batch(", ".exec(", ".run(", ".all(", ".first("]
    sql_verbs = ["SELECT", "INSERT", "UPDATE", "DELETE", "CREATE", "DROP", "ALTER"]

    print(f"bytes={len(raw)} lines={len(lines)} sha256={hashlib.sha256(raw).hexdigest()}")
    print("env_refs=" + (",".join(env_refs) if env_refs else "(none)"))
    print("external_hosts=" + (",".join(sorted(hosts)) if hosts else "(none)"))
    print("api_routes=" + (",".join(routes) if routes else "(none detected)"))
    print("handlers=" + ",".join(f"{key}:{value}" for key, value in handlers.items()))
    print(
        "d1_calls="
        + ",".join(f"{token}:{text.count(token)}" for token in d1_tokens)
    )
    print(
        "sql_verbs="
        + ",".join(
            f"{verb}:{len(re.findall(r'\\b' + verb + r'\\b', text, re.I))}"
            for verb in sql_verbs
        )
    )
    print(
        "hardcoded_secret_heuristic="
        + (
            "none"
            if not secret_lines
            else "possible lines " + ",".join(map(str, secret_lines))
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
