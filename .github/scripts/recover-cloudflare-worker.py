#!/usr/bin/env python3
"""Extract the deployed Cloudflare Worker module from the multipart API response.

The script writes only the executable module plus a sanitized recovery manifest.
Binding values are never copied into the repository.
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
from email import policy
from email.parser import BytesParser
from pathlib import Path


def get_content_type(headers_text: str) -> str:
    matches = re.findall(r"(?im)^content-type:\s*(.+?)\s*$", headers_text)
    if not matches:
        raise RuntimeError("Cloudflare response is missing Content-Type")
    return matches[-1].strip()


def disposition_value(part, key: str) -> str | None:
    value = part.get_param(key, header="content-disposition")
    if isinstance(value, str) and value:
        return value
    header = str(part.get("Content-Disposition", ""))
    match = re.search(rf"(?:^|;)\s*{re.escape(key)}=\"([^\"]+)\"", header, re.I)
    return match.group(1) if match else None


def main() -> int:
    if len(sys.argv) != 4:
        print(
            "usage: recover-cloudflare-worker.py <headers> <body> <output-dir>",
            file=sys.stderr,
        )
        return 2

    headers_path = Path(sys.argv[1])
    body_path = Path(sys.argv[2])
    out_dir = Path(sys.argv[3])
    out_dir.mkdir(parents=True, exist_ok=True)

    content_type = get_content_type(headers_path.read_text("utf-8", errors="replace"))
    body = body_path.read_bytes()

    mime = (
        f"Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n".encode("utf-8")
        + body
    )
    message = BytesParser(policy=policy.default).parsebytes(mime)
    if not message.is_multipart():
        raise RuntimeError(f"Expected multipart Worker bundle, got {content_type}")

    metadata: dict[str, object] | None = None
    parts: list[dict[str, object]] = []
    payloads: dict[str, bytes] = {}

    for index, part in enumerate(message.iter_parts()):
        name = disposition_value(part, "name") or part.get_filename() or f"part-{index}"
        filename = disposition_value(part, "filename") or part.get_filename() or name
        raw = part.get_payload(decode=True) or b""
        content_type_part = part.get_content_type()

        payloads[name] = raw
        payloads[filename] = raw
        parts.append(
            {
                "name": name,
                "filename": filename,
                "content_type": content_type_part,
                "bytes": len(raw),
                "sha256": hashlib.sha256(raw).hexdigest(),
            }
        )

        if content_type_part == "application/json" or name.lower().startswith("metadata"):
            try:
                candidate = json.loads(raw.decode("utf-8"))
            except Exception:
                candidate = None
            if isinstance(candidate, dict) and (
                "main_module" in candidate or "body_part" in candidate or "bindings" in candidate
            ):
                metadata = candidate

    if not isinstance(metadata, dict):
        summary = ", ".join(
            f"{item['name']}:{item['content_type']}" for item in parts
        )
        raise RuntimeError(f"Worker metadata part was not found; parts={summary}")

    main_module = metadata.get("main_module") or metadata.get("body_part")
    if not isinstance(main_module, str) or not main_module:
        raise RuntimeError("Worker metadata does not declare main_module/body_part")

    source = payloads.get(main_module)
    if source is None:
        raise RuntimeError(f"Main module {main_module!r} was not found in multipart payload")

    source_text = source.decode("utf-8")
    source_path = out_dir / "src" / "index.js"
    source_path.parent.mkdir(parents=True, exist_ok=True)
    source_path.write_text(source_text, encoding="utf-8", newline="\n")

    sanitized_bindings = []
    raw_bindings = metadata.get("bindings")
    if isinstance(raw_bindings, list):
        for binding in raw_bindings:
            if not isinstance(binding, dict):
                continue
            sanitized = {
                key: value
                for key, value in binding.items()
                if key in {"name", "type", "id", "namespace_id", "bucket_name", "class_name"}
            }
            sanitized_bindings.append(sanitized)

    manifest = {
        "source": "Cloudflare Workers Scripts API",
        "main_module": main_module,
        "compatibility_date": metadata.get("compatibility_date"),
        "compatibility_flags": metadata.get("compatibility_flags", []),
        "bindings": sanitized_bindings,
        "parts": parts,
        "recovered_source": {
            "path": "worker/src/index.js",
            "bytes": len(source),
            "sha256": hashlib.sha256(source).hexdigest(),
        },
    }
    (out_dir / "recovery-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    print(f"Recovered {main_module} -> {source_path} ({len(source)} bytes)")
    print(f"sha256={manifest['recovered_source']['sha256']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
