#!/usr/bin/env python3
"""Build the wiki hardware catalog from a handoff cards.json and webp assets.

Strips workstation absolute paths. Does not invent Chinese names, SKUs,
stats, skills, stars, or growth links. Does not read the old 22-card
game pack or any frozen art pack.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from pathlib import Path

PREFIXES = (
    "/workspace/pulse-all-product-cards/",
    "/workspace/pulse-design-archive/",
    "/workspace/pulse_tables/",
    "/workspace/pulse-wiki-handoff/",
    "/workspace/",
)
FORBIDDEN = ("/workspace/", "/Users/", "/home/", "file://")
WEB_KEYS = ("char_webp", "card_webp", "char_thumb_webp", "card_thumb_webp")


def scrub_text(value: str) -> str:
    out = value
    for prefix in PREFIXES:
        out = out.replace(prefix, "")
    return out


def scrub(value):
    if isinstance(value, dict):
        return {k: scrub(v) for k, v in value.items()}
    if isinstance(value, list):
        return [scrub(v) for v in value]
    if isinstance(value, str):
        return scrub_text(value)
    return value


def assert_public(blob: str) -> None:
    for marker in FORBIDDEN:
        if marker in blob:
            raise SystemExit(f"refusing to publish private path marker {marker}")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_cards(path: Path) -> dict:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict) or not isinstance(data.get("cards"), list):
        raise SystemExit("cards.json must be an object with a cards array")
    return data


def validate_hardware(cards: list) -> None:
    if len(cards) != 96:
        raise SystemExit(f"expected 96 cards, got {len(cards)}")
    rids = [c.get("rid") for c in cards]
    stems = [c.get("filename_stem") for c in cards]
    if len(set(rids)) != 96 or any(not r for r in rids):
        raise SystemExit("rid values must be 96 unique non-empty ids")
    if len(set(stems)) != 96:
        raise SystemExit("filename_stem values must be unique")
    types = [c.get("type") for c in cards]
    if types.count("typeA") != 67 or types.count("typeB") != 29:
        raise SystemExit(f"expected 67 typeA and 29 typeB, got {types.count('typeA')} / {types.count('typeB')}")
    for card in cards:
        if card.get("style") != ("style-a" if card["type"] == "typeA" else "style-b"):
            raise SystemExit(f"{card.get('rid')} style does not match type")
        if card.get("preview_status") != "preview_not_accepted":
            raise SystemExit(f"{card.get('rid')} is not preview_not_accepted")
        link = card.get("official_product_link") or ""
        if not link.startswith("https://"):
            raise SystemExit(f"{card.get('rid')} missing official https link")


def logicalize_source_assets(card: dict) -> None:
    source = (card.get("assets") or {}).get("source") or {}
    for key, item in list(source.items()):
        if not isinstance(item, dict):
            continue
        raw = item.get("path")
        if isinstance(raw, str):
            item["logical_source"] = scrub_text(raw)
            del item["path"]
    audit = card.get("chip_audit_source")
    if isinstance(audit, dict) and isinstance(audit.get("audit_file"), str):
        audit["audit_file"] = scrub_text(audit["audit_file"])
    if isinstance(card.get("reuse_source"), str):
        card["reuse_source"] = scrub_text(card["reuse_source"])


def copy_webp(card: dict, assets_root: Path, out_root: Path) -> None:
    web = (card.get("assets") or {}).get("web") or {}
    if set(web) != set(WEB_KEYS):
        raise SystemExit(f"{card.get('rid')} web assets must be {WEB_KEYS}")
    for key in WEB_KEYS:
        item = web[key]
        rel = item.get("path")
        if not isinstance(rel, str) or not rel.startswith("assets/") or not rel.endswith(".webp") or ".." in rel:
            raise SystemExit(f"{card.get('rid')} bad web path for {key}: {rel}")
        src = assets_root / rel[len("assets/"):]
        dest = out_root / rel
        if not src.is_file():
            raise SystemExit(f"missing webp {src}")
        digest = sha256(src)
        if digest != item.get("sha256"):
            raise SystemExit(f"sha256 mismatch {rel}")
        if src.stat().st_size != item.get("bytes"):
            raise SystemExit(f"size mismatch {rel}")
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dest)


def main() -> None:
    parser = argparse.ArgumentParser(description="Prepare the public wiki hardware catalog")
    parser.add_argument("--cards", type=Path, required=True)
    parser.add_argument("--assets", type=Path, required=True, help="directory that contains char/, card/, thumb/")
    parser.add_argument("--out", type=Path, required=True, help="wiki directory")
    args = parser.parse_args()
    data = scrub(load_cards(args.cards))
    cards = data["cards"]
    validate_hardware(cards)
    out = args.out
    data_dir = out / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    copied = 0
    for card in cards:
        logicalize_source_assets(card)
        copy_webp(card, args.assets, out)
        copied += 4
    if copied != 384:
        raise SystemExit(f"expected to copy 384 webp files, copied {copied}")
    source = data.get("source") if isinstance(data.get("source"), dict) else {}
    data["source"] = {key: scrub_text(value) if isinstance(value, str) else value for key, value in source.items()}
    data["path_policy"] = "发布页只保留逻辑源名称和 SHA256。工作机绝对路径已去掉。浏览器下载只指向本目录里的 webp 展示图，不是原始 PNG/SVG。"
    data["wiki_role"] = "硬件图鉴壳。中文名、定位、阵营、费用、攻、耐、技能、星级和成长链由设计包注入，不在本文件里编造。"
    blob = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    assert_public(blob)
    (data_dir / "cards.json").write_text(blob, encoding="utf-8")
    print(f"wrote {data_dir / 'cards.json'} and {copied} webp files")


if __name__ == "__main__":
    main()
