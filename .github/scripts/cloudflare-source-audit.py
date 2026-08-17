#!/usr/bin/env python3
"""Sanitized static scan for a downloaded Cloudflare Worker source bundle.

Only structural/security signals are printed. Source lines, literal credential
values, and response bodies are intentionally excluded from the report.
"""

from __future__ import annotations

import hashlib
import re
import sys
from pathlib import Path
from urllib.parse import urlparse


def count(pattern: str, text: str, flags: int = 0) -> int:
    return len(re.findall(pattern, text, flags))


def present(pattern: str, text: str, flags: int = 0) -> bool:
    return bool(re.search(pattern, text, flags))


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

    routes = sorted(set(re.findall(r"[\"'](/api/[A-Za-z0-9_./?=&:%+\-]*)[\"']", text)))

    secret_pattern = re.compile(
        r"(?i)(api[_-]?key|token|secret|authorization)\s*[:=]\s*[\"'][^\"']{12,}[\"']"
    )
    secret_lines = [line_no for line_no, line in enumerate(lines, 1) if secret_pattern.search(line)]

    handlers = {
        "fetch": present(r"\bfetch\s*\(", text),
        "scheduled": present(r"\bscheduled\s*\(", text),
        "export_default": "export default" in text,
    }

    d1_tokens = [".prepare(", ".batch(", ".exec(", ".run(", ".all(", ".first("]
    sql_verbs = ["SELECT", "INSERT", "UPDATE", "DELETE", "CREATE", "DROP", "ALTER"]

    cors_signals = {
        "allow_origin_header": "Access-Control-Allow-Origin" in text,
        "origin_header_read": present(r"headers\.get\s*\(\s*[\"']Origin[\"']", text, re.I),
        "wildcard_cors": present(r"Access-Control-Allow-Origin[^\n]{0,160}[\"']\*[\"']", text, re.I),
        "options_method": present(r"\bOPTIONS\b", text),
    }

    request_guard_signals = {
        "new_url": present(r"new\s+URL\s*\(", text),
        "hostname": present(r"\.hostname\b", text),
        "host": present(r"\.host\b", text),
        "protocol": present(r"\.protocol\b", text),
        "hk01_domain": "hk01.com" in text,
        "hk01_includes": present(r"\.includes\s*\([^)]*hk01\.com", text, re.I),
        "hk01_startswith": present(r"\.startsWith\s*\([^)]*hk01\.com", text, re.I),
        "hk01_endswith": present(r"\.endsWith\s*\([^)]*hk01\.com", text, re.I),
        "anchored_hk01_regex": present(r"\^https?[^\n]{0,100}hk01\\?\.com", text, re.I),
        "localhost": "localhost" in text.lower(),
        "loopback": "127.0.0.1" in text,
        "link_local": "169.254." in text,
        "private_10": present(r"[\"']10\.", text),
        "private_192": "192.168." in text,
        "private_172": present(r"172\.(1[6-9]|2[0-9]|3[01])\.", text),
    }

    abuse_guard_signals = {
        "authorization_header": present(r"Authorization", text, re.I),
        "client_ip": present(r"CF-Connecting-IP|cf-connecting-ip", text, re.I),
        "rate_limit_term": present(r"rate.?limit|ratelimit|throttl", text, re.I),
        "turnstile_term": present(r"turnstile", text, re.I),
    }

    runtime_signals = {
        "wait_until_calls": count(r"\.waitUntil\s*\(", text),
        "response_text_calls": count(r"\.text\s*\(", text),
        "response_json_calls": count(r"\.json\s*\(", text),
        "array_buffer_calls": count(r"\.arrayBuffer\s*\(", text),
        "caches_default": present(r"caches\.default", text),
        "math_random": present(r"Math\.random\s*\(", text),
        "crypto_random_uuid": present(r"crypto\.randomUUID\s*\(", text),
        "pass_through_on_exception": present(r"passThroughOnException", text),
        "try_blocks": count(r"\btry\s*\{", text),
        "catch_blocks": count(r"\bcatch\s*(?:\([^)]*\))?\s*\{", text),
    }

    print(f"bytes={len(raw)} lines={len(lines)} sha256={hashlib.sha256(raw).hexdigest()}")
    print("env_refs=" + (",".join(env_refs) if env_refs else "(none)"))
    print("external_hosts=" + (",".join(sorted(hosts)) if hosts else "(none)"))
    print("api_routes=" + (",".join(routes) if routes else "(none detected)"))
    print("handlers=" + ",".join(f"{key}:{value}" for key, value in handlers.items()))
    print("d1_calls=" + ",".join(f"{token}:{text.count(token)}" for token in d1_tokens))
    print("sql_verbs=" + ",".join(f"{verb}:{count(r'\b' + verb + r'\b', text, re.I)}" for verb in sql_verbs))
    print("cors_signals=" + ",".join(f"{key}:{value}" for key, value in cors_signals.items()))
    print("url_guard_signals=" + ",".join(f"{key}:{value}" for key, value in request_guard_signals.items()))
    print("abuse_guard_signals=" + ",".join(f"{key}:{value}" for key, value in abuse_guard_signals.items()))
    print("runtime_signals=" + ",".join(f"{key}:{value}" for key, value in runtime_signals.items()))
    print(
        "hardcoded_secret_heuristic="
        + ("none" if not secret_lines else "possible lines " + ",".join(map(str, secret_lines)))
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
