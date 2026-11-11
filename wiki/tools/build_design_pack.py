#!/usr/bin/env python3
"""Map pcg.clash.roster.v0 onto the wiki by rid.

Hardware fields stay in cards.json. This writes only game design, growth,
and the chip-derived controller class. It does not infer stars from version
strings and does not invent a third star.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

SOURCE_COMMIT = "9171f2594608b5e43b1aef66ed04feb21c902cf6"
FORBIDDEN = ("/workspace/", "/Users/", "/home/", "file://")
PLAYTEST_IDS = ("xiao_yin", "hou_ke", "dian_zhen", "qiao_jian", "xuan_niu")
PLAYTEST_KEYS = (
    "kind", "cost", "attack", "durability", "guard", "attack_bonus",
    "grants_guard", "bypass_guard", "effect",
)


def fail(message: str) -> None:
    raise SystemExit(message)


def load(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def assert_public(blob: str) -> None:
    for marker in FORBIDDEN:
        if marker in blob:
            fail(f"private path marker {marker}")


def effect_amount(card: dict) -> int:
    if "effect_amount" in card and card["effect_amount"] is not None:
        return card["effect_amount"]
    return card.get("amount") or 0


def check_playtest(roster_by_tid: dict, playtest_path: Path) -> None:
    play = load(playtest_path)
    if play.get("ruleset_id") != "pcg.clash.v0":
        fail("playtest ruleset is not pcg.clash.v0")
    found = {card["template_id"]: card for card in play["cards"]}
    for template_id in PLAYTEST_IDS:
        baseline = found.get(template_id)
        roster = roster_by_tid.get(template_id)
        if not baseline or not roster:
            fail(f"baseline template {template_id} missing")
        for key in PLAYTEST_KEYS:
            if baseline.get(key) != roster.get(key):
                fail(f"{template_id}.{key} differs from the 12-card playtest")
        if effect_amount(baseline) != effect_amount(roster):
            fail(f"{template_id} effect amount differs from the 12-card playtest")


def chain_graph(cards: list[dict]) -> None:
    by_rid = {card["rid"]: card for card in cards}
    seen_families = {}
    for card in cards:
        growth = card["growth"]
        kind = growth["kind"]
        star = growth["star"]
        if kind == "chain":
            if star not in (1, 2):
                fail(f"{card['rid']} chain star must be 1 or 2")
            family = growth["family"]
            seen_families.setdefault(family, []).append(card["rid"])
        elif kind == "lateral":
            if star is not None or growth["prev_rid"] or growth["next_rid"]:
                fail(f"{card['rid']} lateral card has a promotion link")
            if not growth["family"]:
                fail(f"{card['rid']} lateral card has no family")
        elif kind == "solo":
            if star is not None or growth["family"] or growth["prev_rid"] or growth["next_rid"]:
                fail(f"{card['rid']} solo card is linked")
        else:
            fail(f"{card['rid']} unknown growth kind")
        if star == 3:
            fail("a three-star card was produced")
    if len(seen_families) != 9:
        fail(f"expected 9 growth chains, got {len(seen_families)}")
    for family, members in seen_families.items():
        if len(members) != 2:
            fail(f"{family} does not have exactly two cards")
        rows = [by_rid[rid] for rid in members]
        starts = [row for row in rows if row["growth"]["prev_rid"] is None]
        ends = [row for row in rows if row["growth"]["next_rid"] is None]
        if len(starts) != 1 or len(ends) != 1:
            fail(f"{family} is not a single path")
        if starts[0]["growth"]["star"] != 1 or ends[0]["growth"]["star"] != 2:
            fail(f"{family} stars are not 1 then 2")
        if starts[0]["growth"]["next_rid"] != ends[0]["rid"] or ends[0]["growth"]["prev_rid"] != starts[0]["rid"]:
            fail(f"{family} prev/next do not meet")
        walk = starts[0]["rid"]
        visited = []
        while walk:
            if walk in visited:
                fail(f"{family} has a cycle")
            visited.append(walk)
            walk = by_rid[walk]["growth"]["next_rid"]
        if visited != [starts[0]["rid"], ends[0]["rid"]]:
            fail(f"{family} walk is {visited}")


def build_card(raw: dict, by_tid: dict) -> dict:
    role = raw["game_role"]
    if role not in ("main", "attachment") or raw["kind"] != role:
        fail(f"{raw['rid']} kind and game_role disagree")
    if not raw["game_name_zh"] or not raw["game_description"] or not raw["faction"] or not raw["growth_basis"]:
        fail(f"{raw['rid']} is missing a design field")
    if raw["design_status"] != "playtest_draft":
        fail(f"{raw['rid']} is not playtest_draft")
    prev = by_tid[raw["prev_template_id"]]["rid"] if raw["prev_template_id"] else None
    nxt = by_tid[raw["next_template_id"]]["rid"] if raw["next_template_id"] else None
    if role == "main":
        if raw["attack"] <= 0 or raw["durability"] <= 0:
            fail(f"{raw['rid']} main is missing attack or durability")
        if raw["attack_bonus"] or raw["grants_guard"] or raw["bypass_guard"]:
            fail(f"{raw['rid']} main carries an attachment effect")
    else:
        if raw["attack"] or raw["durability"] or raw["guard"] or raw["rush"] or raw["effect"]:
            fail(f"{raw['rid']} attachment uses a main-unit stat")
        if not (raw["attack_bonus"] or raw["grants_guard"] or raw["bypass_guard"]):
            fail(f"{raw['rid']} attachment has no effect")
    return {
        "template_id": raw["template_id"],
        "baseline_template_id": raw["baseline_template_id"],
        "design_status": "playtest_draft",
        "identity": {
            "game_name_zh": raw["game_name_zh"],
            "game_description": raw["game_description"],
            "balance_intent": raw["balance_intent"],
            "faction": raw["faction"],
            "v8_game_name_zh": raw["v8_game_name_zh"],
            "v8_template_id": raw["v8_template_id"],
            "v8_change": raw["v8_change"],
        },
        "gameplay": {
            "role": role,
            "cost": raw["cost"],
            "attack": raw["attack"] if role == "main" else None,
            "durability": raw["durability"] if role == "main" else None,
            "guard": raw["guard"] if role == "main" else None,
            "rush": raw["rush"] if role == "main" else None,
            "effect": raw["effect"] if role == "main" else None,
            "effect_amount": raw["effect_amount"] if role == "main" and raw["effect"] else None,
            "attack_bonus": raw["attack_bonus"] if role == "attachment" else None,
            "grants_guard": raw["grants_guard"] if role == "attachment" else None,
            "bypass_guard": raw["bypass_guard"] if role == "attachment" else None,
            "cost_band": raw.get("cost_band"),
            "cost_line": raw.get("cost_line"),
            "series_confidence": raw.get("series_confidence"),
            "cost_note": raw.get("cost_note"),
        },
        "growth": {
            "family": raw["growth_family"],
            "kind": raw["growth_kind"],
            "star": raw["star"],
            "prev_rid": prev,
            "next_rid": nxt,
            "basis": raw["growth_basis"],
        },
        "hardware_class": {
            "controller": raw["hardware_controller"],
            "note": raw["hardware_controller_note"],
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Build wiki/data/design-pack.json from the roster")
    parser.add_argument("--roster", type=Path, required=True)
    parser.add_argument("--cards", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--playtest", type=Path)
    args = parser.parse_args()
    roster_doc = load(args.roster)
    hardware = load(args.cards)
    raw_cards = roster_doc["cards"]
    wiki_cards = {card["rid"]: card for card in hardware["cards"]}
    if roster_doc.get("ruleset_id") != "pcg.clash.v0" or roster_doc.get("design_status") != "playtest_draft":
        fail("roster is not the playtest_draft clash ruleset")
    if len(raw_cards) != 96 or len(wiki_cards) != 96:
        fail("both catalogs must contain 96 cards")
    if set(wiki_cards) != {card["rid"] for card in raw_cards}:
        fail("rid sets differ")
    by_tid = {}
    for card in raw_cards:
        wiki = wiki_cards[card["rid"]]
        if card["official_product_name_en"] != wiki["official_product_name_en"]:
            fail(f"{card['rid']} official name differs from wiki metadata")
        if card["art_type"] != wiki["type"] or card["art_style"] != wiki["style"]:
            fail(f"{card['rid']} art type differs from wiki metadata")
        if (card["product_series"] or "") != (wiki["product_series"] or ""):
            fail(f"{card['rid']} series differs from wiki metadata")
        if card["template_id"] in by_tid:
            fail("duplicate template_id")
        by_tid[card["template_id"]] = card
    if args.playtest:
        check_playtest(by_tid, args.playtest)
    built = [build_card(card, by_tid) for card in raw_cards]
    # resolve prev/next after all cards exist; build_card already used by_tid
    chain_graph([{"rid": raw["rid"], "growth": built[index]["growth"]} for index, raw in enumerate(raw_cards)])
    families = {}
    for raw, card in zip(raw_cards, built):
        family = card["growth"]["family"]
        if not family:
            continue
        bucket = families.setdefault(family, {
            "id": family,
            "growth_kind": card["growth"]["kind"],
            "members": [],
            "label": None,
            "summary": card["growth"]["basis"],
        })
        if bucket["growth_kind"] != card["growth"]["kind"]:
            fail(f"{family} mixes growth kinds")
        bucket["members"].append(raw["rid"])
        if card["growth"]["kind"] == "chain" and card["growth"]["star"] == 1:
            bucket["label"] = card["identity"]["game_name_zh"]
        if card["growth"]["kind"] == "lateral" and bucket["label"] is None:
            bucket["label"] = card["identity"]["game_name_zh"]
    for family, bucket in families.items():
        if not bucket["label"]:
            fail(f"{family} has no label")
    pack = {
        "pack_id": "pcg.clash.roster.v0",
        "ruleset_id": "pcg.clash.v0",
        "status": "integrated",
        "design_status": "playtest_draft",
        "balance": "playtest_unverified",
        "label": "首版设计 · 待试玩",
        "source_commit": SOURCE_COMMIT,
        "source_repo": "zhuzhe1983/pulse_card_game_prompt",
        "note": "中文名、阵营、费用、技能和星级是 playtest_draft。不是官方规格，也不是网页里已经打完的 96 张实战。玩法正在接入，以实现的引擎版本为准。",
        "growth_rules": roster_doc["growth_rules"],
        "classification": roster_doc["classification"],
        "families": families,
        "counts": {
            "cards": 96,
            "chain_cards": sum(1 for card in built if card["growth"]["kind"] == "chain"),
            "chains": 9,
            "lateral": sum(1 for card in built if card["growth"]["kind"] == "lateral"),
            "solo": sum(1 for card in built if card["growth"]["kind"] == "solo"),
            "star1": sum(1 for card in built if card["growth"]["star"] == 1),
            "star2": sum(1 for card in built if card["growth"]["star"] == 2),
            "unstarred": sum(1 for card in built if card["growth"]["star"] is None),
        },
        "cards": {raw["rid"]: card for raw, card in zip(raw_cards, built)},
    }
    blob = json.dumps(pack, ensure_ascii=False, indent=2) + "\n"
    assert_public(blob)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(blob, encoding="utf-8")
    print(f"wrote {args.out} chains={pack['counts']['chains']} star1={pack['counts']['star1']} star2={pack['counts']['star2']}")


if __name__ == "__main__":
    main()
