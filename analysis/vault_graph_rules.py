"""vault_graph_rules.py - loads vault_graph_rules.json, the one source of Vault Graph rule data, for the Python
side (vault_gaps, moc_align, vault_graph). The plugin gets the same file built in at deploy (its repository's src/rules.js)."""
import json
import math
import re
from pathlib import Path

RULES = json.loads((Path(__file__).resolve().parent / "vault_graph_rules.json").read_text(encoding="utf-8"))
FOLDERS = RULES["folders"]   # this vault's folder names (inbox, daily, people, archive, skip)
HUB_NAME_RE = re.compile(RULES["hub_name"], re.I)
NOT_MAP_NAME_RE = re.compile(RULES["not_map_name"], re.I)
NOT_MAP_TOPS = frozenset(RULES["not_map_tops"])
PROVISIONAL_TOPS = frozenset(RULES["provisional_tops"])   # join the graph once a topic note links to them
_PROVISIONAL_SKIP = re.compile(RULES["provisional_skip_tags"])


def joins_when_linked(r: str, tags) -> bool:
    """A note in a provisional folder (00-Inbox) that may join the graph once a topic note links to it: not a vault
    maintenance note or report. Same rule as VGRules.joinsWhenLinked."""
    return r.split("/")[0] in PROVISIONAL_TOPS and not any(_PROVISIONAL_SKIP.search(t) for t in tags)
CONTEXT_SUFFIX_RE = re.compile(RULES["context_suffix"], re.I)


def mention_names(name: str) -> set:
    """How prose names a note: its title, and the topic of a '<Topic> - Context' note. Same as VGRules.mentionNames."""
    return {k.strip() for k in (name, CONTEXT_SUFFIX_RE.sub("", name)) if k.strip()}


_RECORD_TAG, _RECORD_PATH, _DATED = (re.compile(RULES[k]) for k in ("record_tags", "record_paths", "dated_name"))


def is_record(n: dict) -> bool:
    """Finished work, release notes, meetings, reports, dated logs: never stale. Same rule as VGRules.isRecord."""
    return (any(_RECORD_TAG.search(t) for t in n.get("tags") or []) or bool(_RECORD_PATH.search(n["id"]))
            or bool(_DATED.search(n.get("name") or "")))


def is_map_candidate(r: str, tags: set, doc_type: str = "") -> bool:
    """Could this note be a topic map? Same rule as VGRules.isMapCandidate."""
    if "/" not in r or r.split("/")[0] in NOT_MAP_TOPS or f"/{FOLDERS['archive']}/" in r or NOT_MAP_NAME_RE.search(Path(r).stem):
        return False
    return "meta/moc" in tags or str(doc_type).lower() == "moc" or bool(HUB_NAME_RE.search(Path(r).stem))


def claims(count: int, size: int) -> bool:
    """A map claims a topic when it lists enough of it. Same rule as VGRules.claims."""
    return count >= RULES["map_min_claim"] and count >= RULES["map_min_cover"] * size


def trophic_levels(notes: list) -> dict:
    """Food-web level 0 (producers: relied on, link out little) .. 4 (apex: logs, plans, task lists) per linked note.
    By rank of a smoothed out-share, so a note with two outlinks no longer tops the web. Same as VGRules.trophicLevels."""

    def score(n):
        i, o = n.get("inlinks", 0), n.get("outlinks", 0)
        return (o + 1) / (i + o + 2) + 0.01 * math.log1p(i + o) * (1 if o >= i else -1)
    ranked = sorted(notes, key=lambda n: (score(n), n["id"]))
    cuts, low = RULES["trophic_cuts"], RULES["trophic_min_degree"]
    out = {}
    for k, n in enumerate(ranked):
        lv = sum(k / len(ranked) >= c for c in cuts)
        if n.get("inlinks", 0) + n.get("outlinks", 0) < low:
            lv = min(max(lv, 1), len(cuts) - 1)
        out[n["id"]] = lv
    return out
