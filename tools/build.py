#!/usr/bin/env python3
"""Validate all Russian Coach data and write data/index.json.

Usage: python3 tools/build.py            (from the repo root or anywhere)
Exit code 1 if there are errors. Warnings don't fail the build.
"""
import hashlib
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

TAGS = {
    "case:nom", "case:acc", "case:gen", "case:dat", "case:inst", "case:prep", "case:plural",
    "adj", "pron", "poss", "num",
    "verb:conj", "verb:past", "verb:future", "verb:aspect", "verb:motion", "verb:reflexive", "verb:imperative", "verb:participle",
    "modal", "syn:impersonal", "syn:conditional", "syn:relative", "syn:conj",
    "vocab", "phrase",
}
LEVELS = {"A1", "A2", "B1", "B2", "C1"}
MODES = {"cloze", "produce", "recognize"}
SOURCES = {"starter", "error", "lesson", "reading"}
CARD_ID = re.compile(r"^(s\d{3,}|c\d{3,}|e\d{8}-\d+)$")
LEVEL_RANGE = re.compile(r"^(A1|A2|B1|B2|C1)([–-](A1|A2|B1|B2|C1))?$")

errors, warnings = [], []


def err(where, msg):
    errors.append(f"{where}: {msg}")


def warn(where, msg):
    warnings.append(f"{where}: {msg}")


def norm(s):
    s = s.lower().replace("ё", "е").replace("́", "")
    s = re.sub(r"[.,!?;:«»\"“”„()…–—]", " ", s)
    s = re.sub(r"(^|\s)-+|-+(\s|$)", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def load_json(path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:  # noqa: BLE001
        err(path.relative_to(ROOT), f"invalid JSON ({e})")
        return None


def is_str(v):
    return isinstance(v, str) and v.strip() != ""


def check_tags(where, tags):
    if not isinstance(tags, list) or not tags:
        err(where, "tags must be a non-empty list")
        return
    for t in tags:
        if t not in TAGS:
            err(where, f"unknown tag '{t}'")


def check_question(where, q, need_tag_level):
    t = q.get("type")
    if t not in {"fill", "mcq", "translate", "open"}:
        err(where, f"unknown question type '{t}'")
        return
    if not is_str(q.get("prompt")):
        err(where, "missing prompt")
    if need_tag_level:
        if q.get("tag") not in TAGS:
            err(where, f"tag missing or unknown ('{q.get('tag')}')")
        if q.get("level") not in LEVELS:
            err(where, f"level missing or invalid ('{q.get('level')}')")
    if t == "fill":
        if q.get("prompt", "").count("___") != 1:
            err(where, "fill prompt must contain exactly one ___")
        a = q.get("answer")
        if not isinstance(a, list) or not a or not all(is_str(x) for x in a):
            err(where, "fill answer must be a non-empty list of strings")
    elif t == "mcq":
        opts, a = q.get("options"), q.get("answer")
        if not isinstance(opts, list) or len(opts) < 2 or not all(is_str(o) for o in opts):
            err(where, "mcq needs at least 2 string options")
        elif len({norm(o) for o in opts}) != len(opts):
            err(where, "mcq options are not unique")
        if not isinstance(a, int) or not isinstance(opts, list) or not (0 <= a < len(opts)):
            err(where, "mcq answer must be a valid 0-based index")
    elif t == "translate":
        a = q.get("answer")
        if not isinstance(a, list) or not a or not all(is_str(x) for x in a):
            err(where, "translate answer must be a non-empty list of strings")
    if t != "open" and not is_str(q.get("explain")):
        warn(where, "no explain text")


def parse_front_matter(text):
    m = re.match(r"^---\n(.*?)\n---\n", text, re.S)
    if not m:
        return None, text
    meta = {}
    for line in m.group(1).splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            meta[k.strip()] = v.strip()
    return meta, text[m.end():]


def main():
    index = {"sheets": [], "tests": [], "readings": []}
    hasher = hashlib.sha1()

    # ---- tests (first, so sheets can reference them) ----
    test_ids = set()
    for p in sorted((DATA / "tests").glob("*.json")):
        hasher.update(p.read_bytes())
        where = p.relative_to(ROOT)
        t = load_json(p)
        if t is None:
            continue
        if t.get("id") != p.stem:
            err(where, f"id '{t.get('id')}' must equal file name '{p.stem}'")
        for k in ("title", "level"):
            if not is_str(t.get(k)):
                err(where, f"missing {k}")
        if is_str(t.get("level")) and not LEVEL_RANGE.match(t["level"]):
            err(where, f"level '{t['level']}' should look like A1 or A1–B1")
        check_tags(where, t.get("tags"))
        if t.get("feedback") not in {"each", "end"}:
            err(where, "feedback must be 'each' or 'end'")
        qs = t.get("questions")
        if not isinstance(qs, list) or not qs:
            err(where, "questions must be a non-empty list")
            qs = []
        for i, q in enumerate(qs):
            check_question(f"{where} q{i + 1}", q, need_tag_level=True)
        test_ids.add(p.stem)
        index["tests"].append({
            "id": p.stem, "title": t.get("title"), "level": t.get("level"), "tags": t.get("tags", []),
            "sheet": t.get("sheet"), "feedback": t.get("feedback"), "count": len(qs),
            "placement": p.stem == "placement",
        })

    # ---- grammar sheets ----
    sheet_ids = set()
    for p in sorted((DATA / "grammar").glob("*.md")):
        hasher.update(p.read_bytes())
        where = p.relative_to(ROOT)
        text = p.read_text(encoding="utf-8")
        meta, body = parse_front_matter(text)
        if meta is None:
            err(where, "missing front matter")
            continue
        for k in ("id", "title", "level", "tags"):
            if not meta.get(k):
                err(where, f"front matter missing '{k}'")
        if meta.get("id") != p.stem:
            err(where, f"id '{meta.get('id')}' must equal file name '{p.stem}'")
        tags = [x.strip() for x in meta.get("tags", "").split(",") if x.strip()]
        check_tags(where, tags)
        tests = [x.strip() for x in meta.get("test", "").split(",") if x.strip()]
        for tid in tests:
            if tid not in test_ids:
                err(where, f"references unknown test '{tid}'")
        if re.search(r"<[a-zA-Z/][^>]*>", body):
            warn(where, "contains HTML tags (not rendered)")
        sheet_ids.add(p.stem)
        index["sheets"].append({"id": p.stem, "title": meta.get("title"), "level": meta.get("level"),
                                "tags": tags, "tests": tests})
    for t in index["tests"]:
        if t["sheet"] and t["sheet"] not in sheet_ids:
            err(f"data/tests/{t['id']}.json", f"references unknown sheet '{t['sheet']}'")

    # ---- deck ----
    deck_count = 0
    deck_path = DATA / "deck.json"
    if deck_path.exists():
        hasher.update(deck_path.read_bytes())
        deck = load_json(deck_path)
        cards = (deck or {}).get("cards")
        if not isinstance(cards, list):
            err("data/deck.json", "must contain a 'cards' list")
            cards = []
        seen = set()
        for i, c in enumerate(cards):
            cid = c.get("id", f"#{i}")
            where = f"data/deck.json card {cid}"
            if not isinstance(c.get("id"), str) or not CARD_ID.match(c["id"]):
                err(where, "id must look like s001, c001 or e20261110-1")
            if cid in seen:
                err(where, "duplicate id")
            seen.add(cid)
            if c.get("mode") not in MODES:
                err(where, f"mode must be one of {sorted(MODES)}")
            for k in ("ru", "en"):
                if not is_str(c.get(k)):
                    err(where, f"missing {k}")
            check_tags(where, c.get("tags"))
            if c.get("level") not in LEVELS:
                err(where, f"invalid level '{c.get('level')}'")
            if c.get("source") not in SOURCES:
                err(where, f"source must be one of {sorted(SOURCES)}")
            if "alt" in c and not (isinstance(c["alt"], list) and all(is_str(x) for x in c["alt"])):
                err(where, "alt must be a list of strings")
            if c.get("mode") == "cloze":
                cz = c.get("cloze", "")
                if len(re.findall(r"\{\{[^{}]+\}\}", cz)) != 1:
                    err(where, "cloze must contain exactly one {{answer}}")
                else:
                    rebuilt = re.sub(r"\}\}\s*\([^)]*\)", "}}", cz, count=1)
                    rebuilt = rebuilt.replace("{{", "").replace("}}", "")
                    if is_str(c.get("ru")) and norm(rebuilt) != norm(c["ru"]):
                        warn(where, f"cloze filled in ('{rebuilt}') differs from ru ('{c['ru']}')")
            elif "cloze" in c:
                warn(where, "has a cloze field but mode is not cloze")
        deck_count = len(cards)
    else:
        warn("data/deck.json", "missing")

    # ---- readings ----
    for p in sorted((DATA / "reading").glob("*.json")):
        hasher.update(p.read_bytes())
        where = p.relative_to(ROOT)
        r = load_json(p)
        if r is None:
            continue
        if r.get("id") != p.stem:
            err(where, f"id '{r.get('id')}' must equal file name '{p.stem}'")
        for k in ("title", "title_en", "topic"):
            if not is_str(r.get(k)):
                err(where, f"missing {k}")
        if r.get("level") not in LEVELS:
            err(where, f"invalid level '{r.get('level')}'")
        paras = r.get("paragraphs")
        if not isinstance(paras, list) or not paras or not all(is_str(x) for x in paras):
            err(where, "paragraphs must be a non-empty list of strings")
            paras = []
        words = norm(" ".join(paras)).split()
        wordset = set(words)
        gl = r.get("glossary", {})
        if not isinstance(gl, dict):
            err(where, "glossary must be an object")
            gl = {}
        for key, val in gl.items():
            if key != key.lower():
                err(where, f"glossary key '{key}' must be lowercase")
            if not isinstance(val, dict) or not is_str(val.get("en")):
                err(where, f"glossary '{key}' needs an 'en' string")
            if all(part not in wordset for part in norm(key).split()):
                warn(where, f"glossary key '{key}' does not appear in the text")
        qs = r.get("questions", [])
        if not isinstance(qs, list) or not qs:
            err(where, "questions must be a non-empty list")
            qs = []
        for i, q in enumerate(qs):
            if q.get("type") == "fill":
                err(f"{where} q{i + 1}", "readings support mcq, translate and open questions only")
            check_question(f"{where} q{i + 1}", q, need_tag_level=False)
        index["readings"].append({"id": p.stem, "title": r.get("title"), "title_en": r.get("title_en"),
                                  "level": r.get("level"), "topic": r.get("topic"), "words": len(words),
                                  "questions": len(qs)})

    # ---- writing / speaking ----
    counts = {}
    for fname, key, req in (("writing.json", "prompts", ("id", "level", "title", "prompt_ru", "prompt_en")),
                            ("speaking.json", "topics", ("id", "level", "title", "prompt_ru", "prompt_en"))):
        p = DATA / fname
        if not p.exists():
            warn(f"data/{fname}", "missing")
            counts[key] = 0
            continue
        hasher.update(p.read_bytes())
        d = load_json(p) or {}
        items = d.get(key)
        if not isinstance(items, list):
            err(f"data/{fname}", f"must contain a '{key}' list")
            items = []
        ids = set()
        for it in items:
            where = f"data/{fname} {it.get('id', '?')}"
            for k in req:
                if not is_str(it.get(k)):
                    err(where, f"missing {k}")
            if it.get("level") not in LEVELS:
                err(where, f"invalid level '{it.get('level')}'")
            if it.get("id") in ids:
                err(where, "duplicate id")
            ids.add(it.get("id"))
            for t in it.get("focus", []):
                if t not in TAGS:
                    err(where, f"unknown focus tag '{t}'")
        counts[key] = len(items)

    # ---- profile (optional here: may live in the private data repo) ----
    prof = DATA / "profile.json"
    if prof.exists():
        hasher.update(prof.read_bytes())
        pr = load_json(prof) or {}
        for k in ("levels", "weak_points", "focus", "plan", "history"):
            if k not in pr:
                err("data/profile.json", f"missing '{k}'")
        for t in pr.get("focus", []):
            if t not in TAGS:
                err("data/profile.json", f"unknown focus tag '{t}'")
        if len(pr.get("focus", [])) > 3:
            err("data/profile.json", "focus has more than 3 tags")

    index.update({
        "version": hasher.hexdigest()[:10],
        "built": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "deck": deck_count,
        "writing": counts.get("prompts", 0),
        "speaking": counts.get("topics", 0),
        "tags": sorted(TAGS),
    })

    for w in warnings:
        print("WARN ", w)
    for e in errors:
        print("ERROR", e)
    if errors:
        print(f"\n{len(errors)} error(s), {len(warnings)} warning(s). index.json NOT written.")
        sys.exit(1)
    (DATA / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"OK: {len(index['sheets'])} sheets, {len(index['tests'])} tests, {len(index['readings'])} readings, "
          f"{deck_count} cards, {counts.get('prompts', 0)} writing prompts, {counts.get('topics', 0)} speaking topics. "
          f"{len(warnings)} warning(s). version {index['version']}")


if __name__ == "__main__":
    main()
