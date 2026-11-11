#!/usr/bin/env python3
"""Zip the static wiki for a standalone preview server. Stdlib only."""
from __future__ import annotations

import argparse
import zipfile
from pathlib import Path

INCLUDE = ("index.html", "wiki.css", "wiki.js", "catalog.js", "README.md", "data", "assets")


def main() -> None:
    parser = argparse.ArgumentParser(description="Pack the static wiki preview")
    parser.add_argument("--wiki", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(args.out, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name in INCLUDE:
            path = args.wiki / name
            if path.is_file():
                archive.write(path, f"pulse-card-wiki/{name}")
                continue
            if not path.is_dir():
                raise SystemExit(f"missing {path}")
            for file in sorted(path.rglob("*")):
                if file.is_file():
                    archive.write(file, f"pulse-card-wiki/{file.relative_to(args.wiki).as_posix()}")
    print(f"wrote {args.out} ({args.out.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
