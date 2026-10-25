#!/usr/bin/env python3
"""vault_gaps - "gaps & bridges" report for the Obsidian vault (InfraNodus-style, local).

Topic clusters come from links between knowledge notes (everything outside 01-Daily and
the system folders). Relatedness comes from daily notes: two knowledge notes linked from
the same journal/standup are "co-mentioned" -- the vault's equivalent of InfraNodus word
co-occurrence -- plus shared frontmatter tags. A gap is a pair of clusters that are often
co-mentioned or share tags but barely link to each other.

Usage:
    python _scripts/vault_gaps.py            # print JSON summary (dailies from the last 12 months)
    python _scripts/vault_gaps.py --report   # also write _System/Reports/Gaps & Bridges <date>.md
    python _scripts/vault_gaps.py --since 2026-01-01 | --all   # change the daily-note window

Cross-platform; stdlib + PyYAML (frontmatter, per CLAUDE.md). Read-only except --report.
"""
import functools
import json
import math
import os
import random
import re
import sys
from collections import Counter, defaultdict, deque
from datetime import date, datetime, timedelta
from itertools import combinations
from pathlib import Path
from urllib.parse import unquote

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "_System"))
import vault_lib as vl
sys.path.insert(0, str(Path(__file__).resolve().parent))
import vault_graph_rules as rules  # noqa: E402  (shared with the graph page and plugin)

FOLDERS = _FOLDERS = rules.FOLDERS   # this vault's folder names (vault_graph_rules.json)
DAILY_TOP = _FOLDERS["daily"]
# Standups name coworkers constantly: people would dominate co-mentions and form their own
# cluster. They are kept out of clustering and get their own person <-> topic section.
PEOPLE_TOP = _FOLDERS["people"]
# Only topical namespaces say two clusters are about the same thing (activity/type/... are generic)
TOPIC_TAG_PREFIXES = ("project/", "technology/", "feature/", "hardware/")
# Not knowledge notes: never clustered, never suggested
SKIP_TOP = set(_FOLDERS["skip"])
# Hubs link to everything and would glue every cluster together; reported, not clustered
HUB_NAME_RE = rules.HUB_NAME_RE
# never offered as a link: a private note (its name, or private: true), so its secrets stay in the one note
PRIVATE_RE = re.compile(rules.RULES.get("private_name") or r"$^", re.I)
FRONTMATTER_RE = re.compile(r"\A---\r?\n(.*?)\r?\n---\r?\n", re.S)

SMART_ENV = vl.VAULT / ".smart-env" / "smart_sources"
SEMANTIC_TOP_K = 5       # "similar" = each note is in the other's top-k by embedding
TOP_SEMANTIC = 20
# Same-name copies scored 0.93-0.999 with bge-micro-v2; above this, different-name pairs
# are reported as possible duplicates (for judgment, per the CLAUDE.md dedupe rule)
DUPLICATE_SIMILARITY = 0.93
WIKI_TOP = "Start Here/"
# Rejected by Jackson -- never suggest again (sorted path pairs)
NOT_DUPLICATES = {
    ("03-Resources/Technical-Docs/CVR JSON Documentation.md", "03-Resources/Technical-Docs/CVR WI API Documentation.md"),  # 2026-10-18
}
SERIES_RE = re.compile(r"[\d\s_\-–—()]+")  # dated series: "Release Notes 2026-04" vs "-06"

RECENT_DAYS = 30
CATCHALL_MIN_LINKS = 30   # a note this linked whose neighbours are mostly stubs is a task list, not a topic
CARRY_OVER_DAYS = 3     # a line seen in any of the last 3 dailies of the same kind is carried over
MIN_CLUSTER = 3
TOP_CLUSTERS = 12
TOP_GAPS = 8
TOP_BRIDGES = 15
TOP_COMENTIONS = 20
MIN_COMENTIONS = 2      # a pair needs 2+ dailies where both are named in the same list item / paragraph...
MIN_ASSOC = 0.05        # ...and that has to be a fair share of how often each is mentioned at all


# ---------------------------------------------------------------- vault -> graph

@functools.lru_cache(maxsize=None)
def _parse_fm(block: str):
    """A frontmatter block parsed once: each note's YAML was parsed about three times per run (5 s of 16)."""
    try:
        return yaml.safe_load(block) or {}
    except yaml.YAMLError:
        return None


def _tags(text: str) -> set[str]:
    m = FRONTMATTER_RE.match(text)
    if not m:
        return set()
    fm = _parse_fm(m.group(1))
    if fm is None:
        return set()
    tags = fm.get("tags") if isinstance(fm, dict) else None
    if isinstance(tags, str):
        tags = [tags]
    if not isinstance(tags, list):
        return set()
    # periodic standup/daily tags say nothing about topic
    return {str(t).strip().lower() for t in tags
            if t and not str(t).lower().endswith("/standup") and str(t).lower() != "daily"}


def _targets(text: str) -> list[str]:
    # rstrip: inside tables the alias pipe is escaped, [[Note\|alias]], leaving a trailing backslash
    out = [m.rstrip("\\ ").split("/")[-1].strip().lower() for m in vl.WIKI_RE.findall(text)]
    out += [Path(unquote(m)).stem.lower() for m in vl.MDLINK_RE.findall(text)]
    return out


def _is_hub(r: str, tags: set[str]) -> bool:
    return "meta/hub" in tags or "meta/moc" in tags or r in vl.ROOT_ALLOWED or bool(HUB_NAME_RE.search(Path(r).stem))


def load_vault(since: str | None):
    files = vl.md_files()
    by_name: dict[str, list[str]] = defaultdict(list)
    for f in files:
        by_name[f.stem.lower()].append(vl.rel(f))

    resolve = _make_resolver(by_name)
    knowledge, hubs, people, tags = set(), set(), set(), {}
    raw = {}
    for f in files:
        r = vl.rel(f)
        text = vl.read_text(f)
        raw[r] = text
        top = r.split("/")[0]
        if top == DAILY_TOP or top in SKIP_TOP:
            continue
        tags[r] = _tags(text)
        if top == PEOPLE_TOP:
            (hubs if _is_hub(r, tags[r]) else people).add(r)
        else:
            (hubs if _is_hub(r, tags[r]) else knowledge).add(r)
    # Inbox notes join once a topic note links to them (a note written for a wanted link). Same rule as liveMerge.
    for r in list(knowledge):
        for t in resolve(r, raw[r]):
            if t.split("/")[0] in rules.PROVISIONAL_TOPS and t not in knowledge:
                tg = _tags(raw.get(t) or vl.read_text(vl.VAULT / t))
                if rules.joins_when_linked(t, tg) and not _is_hub(t, tg):
                    tags[t] = tg
                    knowledge.add(t)

    adj: dict[str, Counter] = {r: Counter() for r in knowledge}
    person_links: dict[str, set] = {p: set() for p in people}   # person <-> note, either direction
    comention: Counter = Counter()          # (a, b) sorted pair -> number of daily notes
    person_comention: Counter = Counter()   # (person, note) -> number of daily notes
    mentions: Counter = Counter()           # note -> number of daily notes mentioning it
    hub_degree: Counter = Counter()
    dailies = []
    for r, text in raw.items():
        resolved = resolve(r, text)
        if r.split("/")[0] == DAILY_TOP:
            d = vl.DATE_RE.search(Path(r).name)
            if d and (since is None or d.group(1) >= since):
                dailies.append((d.group(1), r, resolved))
        elif r in hubs:
            hub_degree[r] += len(resolved)
        elif r in people:
            person_links[r] |= resolved & knowledge
        elif r in knowledge:
            for t in resolved & knowledge:
                adj[r][t] += 1
                adj[t][r] += 1
            for p in resolved & people:
                person_links[p].add(r)

    # Catch-all task lists ("General Work Tasks": 115 links, 58% to stubs that link nowhere else)
    # glue unrelated stubs into a fake topic and win "influence". Treat them like hubs: shown, not clustered.
    catchalls = {r for r in knowledge if len(adj[r]) >= CATCHALL_MIN_LINKS
                 and sum(1 for t in adj[r] if len(adj[t]) == 1) >= 0.5 * len(adj[r])}
    for r in catchalls:
        hub_degree[r] = len(adj[r])
        for t in adj.pop(r):
            adj[t].pop(r, None)
        knowledge.discard(r)
        hubs.add(r)
    for p in person_links:
        person_links[p] -= catchalls

    # Dailies mostly name topics in plain text ("fixed the CVR parser") rather than linking them
    # (2026-10: "Odoo" in 338 dailies, linked in 14), so plain-text mentions count too -- but only
    # on lines new since the last few dailies of the same kind, so carried-over tasks and template
    # text don't count again every day. A daily whose link set repeats the previous one's is
    # template boilerplate (2023 dailies carried a fixed link list): its links count once.
    matcher, term_notes = _mention_matcher(knowledge, raw)
    previous: dict[str, frozenset] = {}
    earlier_lines: dict[str, deque] = defaultdict(lambda: deque(maxlen=CARRY_OVER_DAYS))
    used = 0
    recent_since = (date.today() - timedelta(days=RECENT_DAYS)).isoformat()
    recent: Counter = Counter()             # note -> daily mentions in the last RECENT_DAYS
    said_unlinked: Counter = Counter()      # note -> dailies naming it in text without linking it
    pair_days: dict = defaultdict(list)     # (a, b) -> [(day, daily path)], the evidence behind a co-mention
    mention_days: dict = defaultdict(list)  # note -> [day, ...] it was linked or named in a daily (timeline view)
    for day, r, resolved in sorted(dailies):
        kind = "standup" if "standup" in r.lower() else "journal"
        lines = _content_lines(raw[r])
        new_lines = lines.difference(*earlier_lines[kind])
        earlier_lines[kind].append(lines)
        said = {p for line in new_lines for m in matcher.finditer(line) for p in term_notes[m.group(0).lower()]} if matcher else set()
        linked_set = frozenset(resolved & (knowledge | people))
        boilerplate = linked_set == previous.get(kind)
        previous[kind] = linked_set
        linked_here = set() if boilerplate else resolved & knowledge
        people_here = set() if boilerplate else resolved & people
        here = sorted(linked_here | said)
        if not here and not people_here:
            continue
        used += 1
        said_unlinked.update(said - (resolved & knowledge))
        mentions.update(here)
        for n in here:
            mention_days[n].append(day)
        if day >= recent_since:
            recent.update(here)
        # co-mentions: notes named in the same block (list item / paragraph), counted once per daily
        here_set, block_pairs = set(here), set()
        for blk in _blocks(raw[r]):
            in_blk = resolve(r, blk) & here_set
            if matcher:
                blk_new = [l for l in blk.splitlines() if _norm_line(l) in new_lines]
                in_blk |= {p for l in blk_new for m in matcher.finditer(l) for p in term_notes[m.group(0).lower()]} & here_set
            block_pairs.update(combinations(sorted(in_blk), 2))
        comention.update(block_pairs)
        for pair in block_pairs:
            pair_days[pair].append((day, r))
        person_comention.update((p, n) for p in people_here for n in here)
    return (knowledge, hubs, tags, adj, comention, mentions, hub_degree,
            person_links, person_comention, used, recent, said_unlinked, raw,
            {"pair_days": pair_days, "term_notes": term_notes, "mention_days": mention_days})


def _make_resolver(by_name: dict[str, list[str]]):
    """Resolve a note's links to ONE file each, roughly as Obsidian does: an explicit path wins;
    otherwise a same-name copy in the linking note's folder, else the copy with the shortest path.
    (Counting a link to every same-name copy invented ~100 edges.)"""
    def folder(p: str) -> str:
        return p.rsplit("/", 1)[0] if "/" in p else ""

    def pick(src: str, cands: list[str]) -> str:
        if len(cands) == 1:
            return cands[0]
        same = [c for c in cands if folder(c) == folder(src)]
        return same[0] if same else min(cands, key=lambda c: (c.count("/"), len(c), c))

    def resolve(src: str, text: str) -> set[str]:
        out = set()
        for target in vl.WIKI_RE.findall(text):
            t = target.strip().rstrip("\\").strip().replace("\\", "/")   # table links: [[Note\|alias]]
            t = t[:-3] if t.lower().endswith(".md") else t
            cands = by_name.get(t.split("/")[-1].lower(), [])
            if "/" in t:
                cands = [c for c in cands if c.lower().endswith(t.lower() + ".md")] or cands
            if cands and (c := pick(src, cands)) != src:
                out.add(c)
        for target in vl.MDLINK_RE.findall(text):
            target = unquote(target)
            full = os.path.normpath(os.path.join(folder(src), target)).replace("\\", "/").lower()
            cands = by_name.get(Path(target).stem.lower(), [])
            exact = [c for c in cands if c.lower() == full]
            if (exact or cands) and (c := exact[0] if exact else pick(src, cands)) != src:
                out.add(c)
        return out
    return resolve


EVIDENCE_PER_PAIR = 3


def _evidence(pairs, ev_ctx: dict, raw: dict) -> dict:
    """For each suggested pair: its most recent daily notes and the line in each that names them.
    Keyed "a|b" (paths, in co-mention order) -> [[day, daily path, line], ...]."""
    terms: dict[str, set] = defaultdict(set)   # note -> lowercase ways it's named in prose or links
    for term, notes in ev_ctx["term_notes"].items():
        for n in notes:
            terms[n].add(term)
    out = {}
    for a, b in pairs:
        key = (a, b) if (a, b) in ev_ctx["pair_days"] else (b, a)
        days = sorted(ev_ctx["pair_days"].get(key, []), reverse=True)[:EVIDENCE_PER_PAIR]
        ta = terms[key[0]] | {_name(key[0]).lower()}
        tb = terms[key[1]] | {_name(key[1]).lower()}
        out[f"{key[0]}|{key[1]}"] = [[day, path, _snippet(raw.get(path, ""), ta, tb)] for day, path in days]
    return out


def _snippet(text: str, ta: set, tb: set) -> str:
    """The line of a daily note that best shows two notes together (both named > either)."""
    best, best_score = "", 0
    for line in FRONTMATTER_RE.sub("", text, count=1).splitlines():
        s = line.strip()
        if len(s) < 6 or s.startswith(("```", "|")):
            continue
        low = s.lower()
        score = any(x in low for x in ta) + any(x in low for x in tb)
        if score > best_score:
            best, best_score = s, score
            if score == 2:
                break
    best = re.sub(r"\[\[(?:[^\]|]*\|)?([^\]]*)\]\]", r"\1", best)          # [[target|alias]] -> alias
    best = re.sub(r"^\s*(?:[-*+]\s*(?:\[.\]\s*)?|\d+[.)]\s*|#+\s*)", "", best)  # list/heading markers
    best = best.replace("**", "").replace("__", "").strip()
    return best[:157] + "…" if len(best) > 160 else best


def _frontmatter(text: str) -> dict:
    m = FRONTMATTER_RE.match(text)
    fm = _parse_fm(m.group(1)) if m else None
    return dict(fm) if isinstance(fm, dict) else {}


def _mention_matcher(knowledge: set[str], raw: dict[str, str]):
    """One case-insensitive regex over every way a knowledge note is named in prose:
    its title, the topic part of '<Topic> - Context', and frontmatter `aliases`.
    Titles must be distinctive (2+ words, or an acronym/CamelCase/digit/underscore word)."""
    term_notes: dict[str, set] = defaultdict(set)
    for r in knowledge:
        name = _name(r)
        aliases = _frontmatter(raw[r]).get("aliases") or []
        aliases = [aliases] if isinstance(aliases, str) else aliases
        for k in rules.mention_names(name, aliases):   # shared with the plugin's "Link mentions"
            term_notes[k.lower()].add(r)
    if not term_notes:
        return None, term_notes
    alternation = "|".join(re.escape(t) for t in sorted(term_notes, key=len, reverse=True))
    return re.compile(r"(?<![\w-])(?:" + alternation + r")(?![\w-])", re.I), term_notes


def _content_lines(text: str) -> set[str]:
    """Normalised prose lines of a daily: no frontmatter, code blocks (dataviewjs queries) or links."""
    text = FRONTMATTER_RE.sub("", text, count=1)
    text = re.sub(r"```.*?```", "", text, flags=re.S)
    text = re.sub(r"\[\[[^\]]*\]\]|\]\([^)]*\)", " ", text)
    out = set()
    for line in text.splitlines():
        if line.lstrip().startswith("|"):   # standup story tables: carried forward, status edits only
            continue
        line = re.sub(r"^\s*(?:[-*+]\s*(?:\[.\]\s*)?|\d+[.)]\s*|#+\s*|>\s*)", "", line).strip().lower()
        line = re.sub(r"\s+", " ", line)
        if len(line) >= 4:
            out.add(line)
    return out


def _norm_line(line: str) -> str:
    line = re.sub(r"\[\[[^\]]*\]\]|\]\([^)]*\)", " ", line)
    line = re.sub(r"^\s*(?:[-*+]\s*(?:\[.\]\s*)?|\d+[.)]\s*|#+\s*|>\s*)", "", line).strip().lower()
    return re.sub(r"\s+", " ", line)


def _blocks(text: str) -> list[str]:
    """A daily split into the units that are actually about one thing: each top-level list item with its
    nested lines, or each paragraph. Headings, blank lines and tables separate blocks. Two notes count as
    co-mentioned only when they share a block -- a standup covers several unrelated topics in one note."""
    text = FRONTMATTER_RE.sub("", text, count=1)
    text = re.sub(r"```.*?```", "", text, flags=re.S)
    blocks, cur = [], []
    def flush():
        if cur:
            blocks.append("\n".join(cur))
            cur.clear()
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or stripped.startswith("|") or stripped == "---":
            flush()
            continue
        if re.match(r"^(?:[-*+]|\d+[.)])\s", line):   # a new top-level item
            flush()
        cur.append(line)
    flush()
    return blocks


# ---------------------------------------------------------------- smart connections

def load_embeddings(notes: set[str]) -> dict[str, "array"]:
    """Note embeddings from the Smart Connections plugin, if it has indexed the vault.

    Format (observed 2026-10, not documented upstream): *.ajson files are append-only logs of
    `"<key>": {...},` lines (last one wins, null = deleted). Each source's
    embedding.default.<file>.file_i is a slot in the binary file <file>: float32 vectors of the
    model's `dims`, at offset file_i * dims * 4 (verified: same-name copies score 0.93-0.999).
    Slots can be unused, and re-embedded notes are appended at new slots."""
    from array import array
    log = SMART_ENV / "smart_sources.ajson"
    models = SMART_ENV.parent / "embedding_models" / "embedding_models.ajson"
    if not (log.exists() and models.exists()):
        return {}
    dims = {m.get("dims") for m in _ajson(models).values() if m and m.get("dims")}
    if len(dims) != 1:  # several models -> can't tell which file belongs to which; skip
        return {}
    d = dims.pop()
    blobs: dict[str, bytes] = {}
    vectors = {}
    for value in _ajson(log).values():
        if not (value and value.get("path") in notes):
            continue
        for file, ref in ((value.get("embedding") or {}).get("default") or {}).items():
            if not (isinstance(ref, dict) and "file_i" in ref) or "/" in file or "\\" in file:
                continue
            if file not in blobs:
                p = SMART_ENV / file
                blobs[file] = p.read_bytes() if p.is_file() else b""
            i = ref["file_i"]
            v = array("f", blobs[file][i * d * 4:(i + 1) * d * 4])
            if len(v) == d:   # slot past the end = written after we read the file
                vectors[value["path"]] = v
    return vectors


def _ajson(path: Path) -> dict:
    records = {}
    for line in path.open(encoding="utf-8"):
        line = line.strip().rstrip(",")
        if line:
            try:
                key, value = json.loads("{" + line + "}").popitem()
            except (json.JSONDecodeError, KeyError):
                continue
            records[key] = value
    return records


def _linked(a: str, b: str, adj: dict[str, Counter]) -> bool:
    """Linked in either direction, counting any same-name copy (wikilinks resolve by basename)."""
    na, nb = _name(a).lower(), _name(b).lower()
    return (any(_name(t).lower() == nb for t in adj.get(a, ()))
            or any(_name(t).lower() == na for t in adj.get(b, ())))


def _private(r: str, text: str) -> bool:
    return bool(PRIVATE_RE.search(_name(r))) or _frontmatter(text).get("private") is True


# a line of code outside a fence: SQL (upper-case keywords, so "Set up the..." stays prose) or a statement ending in ;
CODE_LINE = re.compile(r"^\s*(--\s|(SELECT|INSERT|UPDATE|DELETE|ALTER|CREATE|SET|FROM|WHERE|VALUES|ADD|JOIN|UNIQUE|PRIMARY|INTO)\b)|;\s*$")


def _mostly_code(text: str) -> bool:
    """A note that is mostly code or SQL: its embedding says what format it is, not what it's about (two SQL dumps
    read as similar in meaning). A mermaid diagram is content, not code."""
    body, fence, n, code = FRONTMATTER_RE.sub("", text, count=1), None, 0, 0
    for line in body.splitlines():
        if not line.strip():
            continue
        if line.strip().startswith("```"):
            fence = None if fence is not None else line.strip()[3:].strip().lower()
            continue
        n += 1
        code += (fence is not None and fence != "mermaid") or (fence is None and bool(CODE_LINE.search(line)))
    return n >= 5 and code / n >= 0.6


TEXT_TWIN = 0.9      # notes whose own text overlaps this much (5-word runs) are copies of each other
TEXT_TWIN_MIN = 50   # words: shorter notes (stubs, templates) aren't compared


def _shingles(text: str) -> set:
    """A note's own text as 5-word runs: no frontmatter, and no Related lists (two copies keep different ones)."""
    body = FRONTMATTER_RE.sub("", text, count=1)
    body = re.sub(r"^## Related\b.*?(?=^#{1,2} |\Z)", " ", body, flags=re.M | re.S)
    w = re.findall(r"[a-z0-9]+", body.lower())
    return {" ".join(w[i:i + 5]) for i in range(len(w) - 4)} if len(w) >= TEXT_TWIN_MIN else set()


def text_twins(notes, raw: dict, quiet: set = frozenset()) -> list:
    """Pairs of notes with the same text (90%+ of their 5-word runs shared), linked or not: a copy is a duplicate
    even when one links the other, unlike a pair that's only similar in meaning. Notes of one dated series
    (Transaction Updates 2026-05-05 / -05-19) are meant to look alike and aren't paired. [[a, b, share, "text"]]"""
    sh = {r: s for r in sorted(notes) if r not in quiet and (s := _shingles(raw.get(r, "")))}
    index: dict[str, list] = defaultdict(list)
    for r, s in sh.items():
        for x in s:
            index[x].append(r)
    shared: Counter = Counter()
    for rs in index.values():
        if 1 < len(rs) <= 50:   # a run in many notes (a template line) says nothing
            for a, b in combinations(rs, 2):
                shared[(a, b)] += 1
    out = []
    for (a, b), n in shared.items():
        j = n / len(sh[a] | sh[b])
        if j >= TEXT_TWIN and not (_series_key(a) and _series_key(a) == _series_key(b)):
            out.append([a, b, round(j, 3), "text"])
    return sorted(out, key=lambda x: (-x[2], x[0], x[1]))


def similar_unlinked(vectors: dict, adj: dict[str, Counter], quiet: set = frozenset(), codey: set = frozenset()) -> list:
    """Mutual top-k embedding neighbours with no direct link (absolute scores from small
    embedding models are compressed, so rank agreement is the signal, not a threshold). quiet: notes never offered
    (private); codey: notes that are mostly code: two of them are not offered as similar (duplicates still are)."""
    paths = sorted(vectors)
    top = _top_neighbours(vectors, SEMANTIC_TOP_K, same_name=False)   # scores shared with clustering
    pairs = []
    for p in paths:
        for s, q in top[p]:
            if (p < q and p not in quiet and q not in quiet and any(q2 == p for _, q2 in top[q]) and not _linked(p, q, adj) and (p, q) not in NOT_DUPLICATES
                    and SERIES_RE.sub("", _name(p).lower()) != SERIES_RE.sub("", _name(q).lower())):
                pairs.append([p, q, round(s, 3)])
    # Start Here/ pages were written as reworded copies of resource notes (26 of 75 had a
    # >=0.93 twin on 2026-10-18, none linked) -- a structural pattern, reported on its own
    wiki = lambda x: x[0].startswith(WIKI_TOP) != x[1].startswith(WIKI_TOP)
    twins = _by_name((x for x in pairs if wiki(x)), 40)
    rest = [x for x in pairs if not wiki(x)]
    dupes = _by_name((x for x in rest if x[2] >= DUPLICATE_SIMILARITY), TOP_SEMANTIC)
    related = _by_name((x for x in rest if x[2] < DUPLICATE_SIMILARITY and not (x[0] in codey and x[1] in codey)), TOP_SEMANTIC)   # two code dumps alike
    return dupes, related, twins


# ---------------------------------------------------------------- topic cohesion
# Links alone split topics wherever their links happen to point: the Transaction Updates series landed in three
# clusters plus twelve unclustered notes, because the dated notes rarely link each other. Clustering also sees
# weaker ties (links stay the main signal; bridges, gaps and link counts still use links only):
SERIES_W = 1.0      # consecutive notes of a dated series ("Transaction Updates 2026-05-05" -> "... 2026-05-19")
SEMANTIC_W = 0.45   # mutual top-k meaning neighbours (Smart Connections embeddings)
FOLDER_W = 0.3      # each note's two closest-in-meaning notes in the same folder
FOLDER_MAX = 60     # bigger folders are filing buckets, not topics
SMALL_CLUSTER = 6   # a cluster smaller than this joins the topic it is most tied to...
ABSORB_SHARE = 0.25  # ...when that is at least this share of its ties
DATED_RE = re.compile(r"\d{4}-\d{2}(-\d{2})?")


def _series_key(r: str) -> str:
    name = _name(r)
    return SERIES_RE.sub(" ", DATED_RE.sub(" ", name)).strip().lower() if DATED_RE.search(name) else ""


def _dot(a, b) -> float:
    return math.sumprod(a, b) if hasattr(math, "sumprod") else sum(x * y for x, y in zip(a, b))


_SCORES: dict = {}


def _top_neighbours(vectors: dict, k: int, same_name: bool = True) -> dict[str, list]:
    """Each note's k nearest in meaning. Every pair is scored once per run and shared: clustering (same_name=True)
    and the similar-notes report (same-name copies excluded) used to score them separately (11 s of 16)."""
    import heapq
    key = (id(vectors), len(vectors))
    if key not in _SCORES:
        paths = sorted(vectors)
        scores: dict[str, list] = {p: [] for p in paths}
        for i, p in enumerate(paths):
            vp, sp = vectors[p], scores[p]
            for j in range(i + 1, len(paths)):
                q = paths[j]
                d = _dot(vp, vectors[q])
                sp.append((d, q))
                scores[q].append((d, p))
        _SCORES.clear()
        _SCORES[key] = scores
    scores = _SCORES[key]
    if same_name:
        return {p: heapq.nlargest(k, v) for p, v in scores.items()}
    low = {p: _name(p).lower() for p in scores}
    return {p: heapq.nlargest(k, (x for x in v if low[x[1]] != low[p])) for p, v in scores.items()}


def cohesion_graph(graph: dict[str, Counter], knowledge: set[str], vectors: dict) -> dict[str, Counter]:
    g: dict[str, Counter] = defaultdict(Counter)
    for r, nbrs in graph.items():
        for t, w in nbrs.items():
            g[r][t] += w
    def tie(a: str, b: str, w: float) -> None:
        if a != b:
            g[a][b] += w
            g[b][a] += w
    series: dict[str, list] = defaultdict(list)
    for r in knowledge:
        key = _series_key(r)
        if key:
            series[key].append((DATED_RE.search(_name(r)).group(0), r))
    for members in series.values():
        if len(members) >= 2:
            members.sort()
            for (_, a), (_, b) in zip(members, members[1:]):
                tie(a, b, SERIES_W)
    if vectors:
        top = _top_neighbours(vectors, SEMANTIC_TOP_K)
        for p, near in top.items():
            for _, q in near:
                if p < q and any(q2 == p for _, q2 in top.get(q, ())):
                    tie(p, q, SEMANTIC_W)
        folders: dict[str, list] = defaultdict(list)
        for r in vectors:
            if "/" in r.split("/", 1)[-1]:   # below a top-level folder: 02-Projects/X/..., not 02-Projects/...
                folders[r.rsplit("/", 1)[0]].append(r)
        for ms in folders.values():
            if 3 <= len(ms) <= FOLDER_MAX:
                for p in ms:
                    for _, q in sorted(((s, q) for s, q in top.get(p, ()) if q in ms), reverse=True)[:2]:
                        tie(p, q, FOLDER_W)
                    if not any(q in ms for _, q in top.get(p, ())):   # nothing close enough: its nearest folder-mate
                        q = max((q for q in ms if q != p), key=lambda q: _dot(vectors[p], vectors[q]))
                        tie(p, q, FOLDER_W)
    return {r: Counter(dict(sorted(nb.items()))) for r, nb in sorted(g.items()) if nb}


def absorb_small(comm: dict[str, int], g: dict[str, Counter]) -> dict[str, int]:
    """Louvain leaves fragments of 3-5 notes (one release, one crash write-up). Each joins the topic it is most
    tied to when that tie is a fair share of all of its ties; otherwise it stays a topic of its own."""
    comm = dict(comm)
    for _ in range(3):
        size = Counter(comm.values())
        changed = False
        for c in sorted((c for c, n in size.items() if n < SMALL_CLUSTER), key=lambda c: (size[c], c)):
            ms = [r for r, x in comm.items() if x == c]
            if not ms:
                continue
            ties, total = Counter(), 0.0
            for r in ms:
                for t, w in g.get(r, {}).items():
                    total += w
                    if comm.get(t, c) != c:
                        ties[comm[t]] += w
            if ties and total:
                best, w = max(ties.items(), key=lambda kv: (kv[1], -kv[0]))
                if w / total >= ABSORB_SHARE and size[best] >= size[c]:
                    for r in ms:
                        comm[r] = best
                    size[best] += size[c]
                    size[c] = 0
                    changed = True
        if not changed:
            break
    return comm


# ---------------------------------------------------------------- algorithms

def louvain(adj: dict[str, Counter], seed: int = 7) -> dict[str, int]:
    """Louvain modularity clustering (weighted, undirected). Returns node -> community."""
    rng = random.Random(seed)
    graph = {n: dict(sorted(adj[n].items())) for n in sorted(adj)}
    membership = {n: n for n in graph}           # original node -> current super-node
    while True:
        comm, moved = _louvain_level(graph, rng)
        if not moved:
            break
        membership = {n: comm[s] for n, s in membership.items()}
        agg: dict = defaultdict(lambda: defaultdict(float))
        for u, nbrs in graph.items():
            for v, w in nbrs.items():
                agg[comm[u]][comm[v]] += w
        graph = {c: dict(nb) for c, nb in agg.items()}
        for c in {comm[u] for u in comm}:
            graph.setdefault(c, {})
    ids = {c: i for i, c in enumerate(sorted(set(membership.values()), key=str))}
    return {n: ids[c] for n, c in membership.items()}


def _louvain_level(graph: dict, rng: random.Random):
    k = {u: sum(nb.values()) for u, nb in graph.items()}
    m2 = sum(k.values())
    comm = {u: u for u in graph}
    tot = dict(k)
    if m2 == 0:
        return comm, False
    moved_any, improved = False, True
    nodes = sorted(graph, key=str)  # set/dict order is hash-randomized per process
    while improved:
        improved = False
        rng.shuffle(nodes)
        for u in nodes:
            cu = comm[u]
            w_to: dict = defaultdict(float)
            for v, w in graph[u].items():
                if v != u:
                    w_to[comm[v]] += w
            tot[cu] -= k[u]
            best, best_gain = cu, w_to.get(cu, 0.0) - tot[cu] * k[u] / m2
            for c, w in w_to.items():
                gain = w - tot[c] * k[u] / m2
                if gain > best_gain + 1e-12:
                    best, best_gain = c, gain
            tot[best] += k[u]
            if best != cu:
                comm[u] = best
                improved = moved_any = True
    return comm, moved_any


def betweenness(adj: dict[str, Counter]) -> dict[str, float]:
    """Brandes betweenness centrality on the unweighted link graph."""
    bc = dict.fromkeys(adj, 0.0)
    for s in adj:
        stack, preds = [], defaultdict(list)
        sigma = dict.fromkeys(adj, 0)
        dist = dict.fromkeys(adj, -1)
        sigma[s], dist[s] = 1, 0
        q = deque([s])
        while q:
            v = q.popleft()
            stack.append(v)
            for w in adj[v]:
                if dist[w] < 0:
                    dist[w] = dist[v] + 1
                    q.append(w)
                if dist[w] == dist[v] + 1:
                    sigma[w] += sigma[v]
                    preds[w].append(v)
        delta = dict.fromkeys(adj, 0.0)
        while stack:
            w = stack.pop()
            for v in preds[w]:
                delta[v] += sigma[v] / sigma[w] * (1 + delta[w])
            if w != s:
                bc[w] += delta[w]
    n = len(adj)
    scale = 1 / ((n - 1) * (n - 2)) if n > 2 else 1
    return {v: b * scale for v, b in bc.items()}


# ---------------------------------------------------------------- analysis

@functools.lru_cache(maxsize=None)
def _name(r: str) -> str:
    return Path(r).stem


TITLE_STOP = set("the and for with from into how to of in on a an vs via notes note context overview guide "
                 "process documentation draft new old final complete part pages page md readme "
                 "fix address investigate create update updates issue issues add bug".split())
TEXT_STOP = TITLE_STOP | set("""this that these those there their them they then than when where which while what who
    will would should could can cannot not are was were been being have has had does did doing done also just only
    very more most some such each other into onto over under after before about above below between through during
    all any both few many much own same your you our its it's we he she his her him use used using uses make made
    one two three first second next last need needs needed get gets got set sets via per out off yes no now see
    like well back way new add added adding remove removed check checked work worked working run runs running
    file files table column value values data type name names list item items step steps note notes page link
    links section example time date today yesterday tomorrow week status todo task tasks http https www com""".split())


def _note_words(text: str) -> set[str]:
    """Distinct content words of a note body (no frontmatter, code, links or URLs)."""
    text = FRONTMATTER_RE.sub("", text, count=1)
    text = re.sub(r"```.*?```|`[^`]*`|\[\[[^\]]*\]\]|\]\([^)]*\)|https?://\S+", " ", text[:6000], flags=re.S)
    return {w for w in re.findall(r"[A-Za-z][A-Za-z0-9]{2,}", text) if w.lower() not in TEXT_STOP}


def _cluster_names(clusters: list[list[str]], raw: dict | None = None) -> list[str]:
    """2-3 words per cluster that are frequent in its notes but rare in other clusters' (tf-idf).
    Title words weigh 3; a body word counts only if it appears in several of the cluster's notes
    (>= 2 and >= 15%), so one long note can't name the cluster."""
    spelling: dict[str, Counter] = defaultdict(Counter)   # keep the notes' own casing (EC2, RTI, Odoo)
    stem = lambda w: w.lower().rstrip("s") if len(w) > 4 else w.lower()
    words = []
    for m in clusters:
        title_c, body_c = Counter(), Counter()
        for r in m:
            title = {tok for tok in re.findall(r"[A-Za-z][A-Za-z0-9]{2,}", _name(r)) if stem(tok) not in TITLE_STOP}
            body = {tok for tok in (_note_words(raw[r]) if raw and r in raw else set())
                    if stem(tok) not in TEXT_STOP and tok.lower() not in TEXT_STOP}
            for tok in title:
                title_c[stem(tok)] += 1; spelling[stem(tok)][tok] += 1
            for s in {stem(tok) for tok in body}:
                body_c[s] += 1
            for tok in body:
                spelling[stem(tok)][tok] += 1
        floor = max(2, 0.15 * len(m))
        c = Counter({w: 3 * n for w, n in title_c.items()})
        for w, n in body_c.items():
            if n >= floor:
                c[w] += n
        words.append(c)
    df = Counter(w for c in words for w in c)
    names = []
    for c in words:
        scored = sorted(c, key=lambda w: (-(c[w] * math.log((1 + len(words)) / df[w])), w))
        shown = [spelling[w].most_common(1)[0][0] for w in scored[:3]]
        names.append(" · ".join(s if any(ch.isupper() for ch in s) else s.capitalize() for s in shown) or "(untitled)")
    return names


NAME_LEAD_RE = re.compile(r"^[\W\d_]+")   # "01 - ", "⚠️ ", "3. " before a title
PHRASE_STOP = set("the and for with from into how to of in on a an vs via md readme context draft final copy".split())   # lighter than TITLE_STOP: "Updates", "Notes" make good names


def _clean_title(r: str) -> str:
    t = DATED_RE.sub(" ", _name(r))
    t = re.sub(r"\(.*?\)|\s-\s*Context$|\s+Context$", " ", t)
    t = re.sub(r"(?<=\w)[-_](?=\w)", " ", t)   # Kiosk-Maintenance-Menu -> Kiosk Maintenance Menu
    return re.sub(r"\s+", " ", NAME_LEAD_RE.sub("", t)).strip(" -—_·,")


def _readable_names(clusters: list[list[str]], keywords: list[str], core: list[list[str]]) -> list[str]:
    """Names people would give: the phrase most of a topic's titles share ("Transaction Updates", "Inventory
    Flow"), else its most central note's title. The tf-idf keywords ("Scute · Aim · Certain") read as word salad;
    they stay on as `keywords`. Two topics never share a name: the second gets its top keyword added."""
    stem = lambda w: w.lower().rstrip("s") if len(w) > 4 else w.lower()
    grams_of = []
    for m in clusters:
        g: dict[str, Counter] = defaultdict(Counter)   # stemmed phrase -> spellings seen
        for r in m:
            toks = re.findall(r"[A-Za-z][A-Za-z0-9&+.]*", _clean_title(r))
            seen = set()
            for n in (3, 2, 1):
                for i in range(len(toks) - n + 1):
                    ph = toks[i:i + n]
                    if ph[0].lower() in PHRASE_STOP or ph[-1].lower() in PHRASE_STOP or (n == 1 and (len(ph[0]) < 3 or stem(ph[0]) in TITLE_STOP)):
                        continue
                    key = " ".join(stem(t) for t in ph)
                    if key not in seen:
                        seen.add(key)
                        g[key][" ".join(ph)] += 1
        grams_of.append(g)
    df = Counter(k for g in grams_of for k in g if sum(g[k].values()) >= 2)
    names = []
    for m, g, kw, cr in zip(clusters, grams_of, keywords, core):
        best, bs = None, 0.0
        for key, spell in g.items():
            cov = sum(spell.values()) / len(m)
            if sum(spell.values()) < 2 or cov < 0.25:
                continue
            score = cov * (1 + 0.35 * (key.count(" "))) / (1 + 0.5 * max(0, df[key] - 1))   # longer and distinctive wins
            if score > bs:
                best, bs = spell.most_common(1)[0][0], score
        if best:
            name = best if any(c.isupper() for c in best) else best.title()
            if " " not in name:   # one word ("Kiosk") says little: add the topic's most distinctive keyword
                extra = next((w for w in kw.split(" · ") if stem(w) != stem(name) and w.lower() not in name.lower()), None)
                name = f"{name} · {extra}" if extra else name
        else:
            name = _clean_title(cr[0]) if cr else kw.split(" · ")[0]
            if len(name) > 34:
                name = name[:33].rsplit(" ", 1)[0] + "…"
        names.append(name or kw)
    taken = Counter()
    for i, n in enumerate(names):
        taken[n.lower()] += 1
        if taken[n.lower()] > 1:
            extra = next((w for w in keywords[i].split(" · ") if w.lower() not in n.lower()), str(i))
            names[i] = f"{n} · {extra}"
    return names


# A topic's stack: the technology (else project) tag most of its notes carry and few other topics do. Its name leads
# the topic's name ("Odoo · Inventory Stock", "AWS SES · Bounce Handling"), so topics read by the system they're about.
STACK_SKIP = set("api backend frontend automation programming refactor upgrade stack server storage memory hardware database "
                 "kiosk stack excalidraw clickup git github".split())
STACK_WORDS = {"aws": "AWS", "ses": "SES", "ec2": "EC2", "rds": "RDS", "s3": "S3", "iam": "IAM", "sns": "SNS", "sql": "SQL", "ssl": "SSL",
               "ssh": "SSH", "vpn": "VPN", "voip": "VoIP", "ci-cd": "CI/CD", "rti": "RTI", "cvr": "CVR", "odoo": "Odoo", "nextjs": "Next.js",
               "mysql": "MySQL", "postgres": "Postgres", "github-actions": "GitHub Actions", "us-cellular": "US Cellular", "t-mobile": "T-Mobile",
               "google-maps": "Google Maps", "cloudwatch": "CloudWatch", "cloudtrail": "CloudTrail", "javascript": "JavaScript", "rti-console": "RTI Console"}
STACK_PLATFORMS = {"project/odoo", "project/cvr", "project/resgrid"}   # project tags that name a platform, not a piece of work
STACK_MIN_SHARE = {"technology/": 0.2, "project/": 0.3}   # technology tags are sparser, and name a stack better


def _stack_name(tag: str) -> str:
    parts = tag.split("/")[1:]
    if parts[0] == "aws" and len(parts) > 1:
        return "AWS " + STACK_WORDS.get(parts[1], parts[1].upper())
    w = parts[-1]
    return STACK_WORDS.get(w) or " ".join(STACK_WORDS.get(x, x.capitalize()) for x in w.split("-"))


def _stacks(clusters: list[list[str]], tags: dict[str, set]) -> list[str]:
    """One stack name per topic, or "" when no technology/project tag covers enough of it. Technology tags win
    (and deeper ones: aws/ses over aws); a project tag counts only if few topics share it ("Kiosk Systems" is everywhere)."""
    share = []
    for m in clusters:
        c = Counter(t for r in m for t in tags.get(r, ()) if t.startswith(("technology/", "project/")) and t.split("/")[-1] not in STACK_SKIP)
        share.append({t: n / len(m) for t, n in c.items()})
    kind = lambda t: "technology/" if t.startswith("technology/") or t in STACK_PLATFORMS else "project/"
    df = Counter(t for sh in share for t, v in sh.items() if v >= STACK_MIN_SHARE[kind(t)])
    out = []
    for sh in share:
        best = sorted(((v + (0.25 if kind(t) == "technology/" else 0) + 0.1 * (t.count("/") - 1), t) for t, v in sh.items()
                       if v >= STACK_MIN_SHARE[kind(t)] and (kind(t) == "technology/" or df[t] <= 3)), reverse=True)
        out.append(_stack_name(best[0][1]) if best else "")
    return out


def _with_stack(name: str, stack: str) -> str:
    if not stack or any(w.lower() in name.lower() for w in stack.split() if len(w) > 2):
        return name
    return f"{stack} · {name}"


def _label(members: list[str], adj: dict[str, Counter], tags: dict[str, set]) -> dict:
    inside = set(members)
    deg = {r: sum(w for t, w in adj.get(r, {}).items() if t in inside) for r in members}   # unlinked members: 0
    folders = Counter("/".join(r.split("/")[:2]) if r.count("/") >= 2 else r.split("/")[0] for r in members)
    tag_counts = Counter(t for r in members for t in tags.get(r, ()))
    return {
        "core": sorted(members, key=lambda r: (-deg[r], r))[:4],
        "folder": folders.most_common(1)[0][0],
        "tags": [t for t, _ in tag_counts.most_common(3)],
    }


def _topic_tags(ts: set[str]) -> set[str]:
    return {t for t in ts if t.startswith(TOPIC_TAG_PREFIXES)}


DISMISSED_FILE = vl.VAULT / rules.RULES["files"]["dismissed"]   # written by the Vault Graph plugin
# each device's ledger of its marks (VGRules.ledgerAdd): a dismissal there counts even if Sync kept another copy of DISMISSED_FILE
LEDGER_DIR = vl.VAULT / rules.RULES["files"]["device_ledgers"]
_DISMISSED_CACHE = None


def ledger_dismissed() -> list:
    out = []
    for f in sorted(LEDGER_DIR.glob("*.json")) if LEDGER_DIR.is_dir() else []:
        try:
            out += json.loads(f.read_text(encoding="utf-8")).get("dismissed", [])
        except (OSError, ValueError, AttributeError):
            continue
    return out


def _dismissed() -> set:
    """Pairs Jackson dismissed (graph "Dismiss" button, or [-] rows via the gardener), by note name."""
    global _DISMISSED_CACHE
    if _DISMISSED_CACHE is None:
        try:
            pairs = json.loads(DISMISSED_FILE.read_text(encoding="utf-8")).get("pairs", [])
        except (OSError, ValueError):
            pairs = []
        pairs += ledger_dismissed()
        _DISMISSED_CACHE = {frozenset((_name(p["a"]).lower(), _name(p["b"]).lower())) for p in pairs if p.get("a") and p.get("b")}
        _DISMISSED_CACHE |= {frozenset((_name(a).lower(), _name(b).lower())) for a, b in NOT_DUPLICATES}
    return _DISMISSED_CACHE


def _by_name(pairs, limit: int, rank=None) -> list:
    """Collapse (a, b, n) path pairs to unique basename pairs (same-name copies resolve together).
    Ordered by rank(pair) if given, else by n; ties by path so runs are stable."""
    seen, out = set(), []
    dismissed = _dismissed()
    for a, b, n in sorted(pairs, key=lambda x: (-(rank(x) if rank else x[2]), x[0], x[1])):
        key = frozenset((_name(a).lower(), _name(b).lower()))
        if len(key) == 2 and key not in seen and key not in dismissed:
            seen.add(key)
            out.append([a, b, n])
        if len(out) == limit:
            break
    return out


CLUSTER_STATE = vl.CACHE / "cluster-state.json"


def stable_cluster_ids(clusters: list[list[str]]) -> list[int]:
    """Louvain renumbers clusters every run; keep each topic's id (and so its colour) by matching it
    to last run's cluster with the most member overlap (Jaccard >= 0.3). New topics get the
    smallest free id, biggest first, so the palette's colours go to the large ones."""
    try:
        prev = json.loads(CLUSTER_STATE.read_text(encoding="utf-8")).get("clusters", {})
    except (OSError, ValueError):
        prev = {}
    sets = [set(m) for m in clusters]
    pairs = sorted(((len(s & set(pm)) / len(s | set(pm)), i, int(pid))
                    for i, s in enumerate(sets) for pid, pm in prev.items()), key=lambda x: (-x[0], x[1], x[2]))
    out: list = [None] * len(clusters)
    taken = set()
    for score, i, pid in pairs:
        if score < 0.3:
            break
        if out[i] is None and pid not in taken:
            out[i] = pid
            taken.add(pid)
    free = (n for n in range(10 ** 6) if n not in taken)
    return [o if o is not None else next(free) for o in out]


def save_cluster_state(a: dict) -> None:
    """Remember this run's clusters (id -> members) so the next run can keep their ids."""
    state = {"date": a["date"], "clusters": {str(c["id"]): m for c, m in zip(a["clusters"], a["cluster_members"])}}
    vl.write_if_changed(CLUSTER_STATE, json.dumps(state, ensure_ascii=False))


def analyze(since: str | None) -> dict:
    (knowledge, hubs, tags, adj, comention, mentions, hub_degree,
     person_links, person_comention, dailies_used, recent, said_unlinked, raw, ev_ctx) = load_vault(since)
    linked = {r for r in knowledge if adj[r]}
    graph = {r: Counter({t: w for t, w in sorted(adj[r].items()) if t in linked}) for r in sorted(linked)}
    vectors = load_embeddings(knowledge)
    cohesive = cohesion_graph(graph, knowledge, vectors)   # links + series, meaning and folder ties: topics only
    comm = absorb_small(louvain(cohesive), cohesive)
    bc = betweenness(graph)

    members: dict[int, list[str]] = defaultdict(list)
    for r, c in comm.items():
        members[c].append(r)
    clusters = sorted((sorted(m) for m in members.values() if len(m) >= MIN_CLUSTER),
                      key=lambda m: (-len(m), m[0]))
    cid = {r: i for i, m in enumerate(clusters) for r in m}           # index, used internally
    sid = stable_cluster_ids(clusters)                                  # shown ids/colours, stable across runs
    shown = {r: sid[i] for r, i in cid.items()}
    keywords = _cluster_names(clusters, raw)
    labels = [_label(m, graph, tags) for m in clusters]
    stacks = _stacks(clusters, tags)
    names = [_with_stack(n, st) for n, st in zip(_readable_names(clusters, keywords, [lb["core"] for lb in labels]), stacks)]
    info = [{"id": sid[i], "size": len(m), "name": names[i], "stack": stacks[i], "keywords": keywords[i], **labels[i]} for i, m in enumerate(clusters)]

    # cluster-pair links vs relatedness (co-mentions in dailies + shared tags)
    # Rank co-mentions by association, not raw count: a note named in most dailies ("kiosk")
    # co-occurs with everything, like a stopword. Cosine: n / sqrt(dailies(a) * dailies(b)).
    assoc = lambda x: x[2] / math.sqrt(max(mentions[x[0]], 1) * max(mentions[x[1]], 1))
    # A pair is only "related" when it shares enough blocks (list items / paragraphs) for how busy both notes
    # are: association = n / sqrt(mentions(a) * mentions(b)). Day-level co-mentions were mostly coincidence
    # (CVR Integration and Sticker Contractor Jobs shared 7 busy dailies but never one bullet).
    significant = lambda a, b, n: n >= MIN_COMENTIONS and assoc((a, b, n)) >= MIN_ASSOC
    links, related, related_assoc, examples = Counter(), Counter(), Counter(), defaultdict(Counter)
    for r in graph:
        for t, w in graph[r].items():
            if r < t and r in cid and t in cid and cid[r] != cid[t]:
                links[tuple(sorted((cid[r], cid[t])))] += w
    for (a, b), n in comention.items():
        if a in cid and b in cid and cid[a] != cid[b] and not _linked(a, b, adj) and significant(a, b, n):
            pair = tuple(sorted((cid[a], cid[b])))
            related[pair] += n
            related_assoc[pair] += assoc((a, b, n))
            examples[pair][(a, b)] += n
    tag_sets = [Counter(t for r in m for t in _topic_tags(tags.get(r, set()))) for m in clusters]
    gaps = []
    for i, j in combinations(range(len(clusters)), 2):
        shared = set(tag_sets[i]) & set(tag_sets[j])
        rel_score = 10 * related_assoc[(i, j)] + 0.5 * len(shared)
        if rel_score < 2:
            continue
        density = links[(i, j)] / (len(clusters[i]) * len(clusters[j]))
        gaps.append({
            "clusters": [i, j],
            "ids": [sid[i], sid[j]],
            "comentions": related[(i, j)],
            "shared_tags": sorted(shared)[:5],
            "links": links[(i, j)],
            "score": round(rel_score / (1 + 25 * density), 2),
            "suggest": _by_name(((a, b, n) for (a, b), n in examples[(i, j)].items() if not (_private(a, raw.get(a, "")) or _private(b, raw.get(b, "")))), 3, assoc),
        })
    gaps.sort(key=lambda g: (-g["score"], g["clusters"]))

    quiet = {r for r in knowledge if _private(r, raw.get(r, ""))}       # never offered as a link
    codey = {r for r in knowledge if _mostly_code(raw.get(r, ""))}        # not "similar in meaning" by format alone
    unlinked = _by_name(((a, b, n) for (a, b), n in comention.items()
                         if not _linked(a, b, adj) and significant(a, b, n) and a not in quiet and b not in quiet), TOP_COMENTIONS, assoc)
    near_dupes, semantic, wiki_twins = similar_unlinked(vectors, adj, quiet, codey) if vectors else ([], [], [])
    # copies by their text first (linked or not), then the pairs only embeddings find
    twins = text_twins(knowledge, raw, quiet)
    seen_pairs = {frozenset(x[:2]) for x in twins}
    near_dupes = twins + [x for x in near_dupes if frozenset(x[:2]) not in seen_pairs]
    person_topics = _by_name(((p, r, n) for (p, r), n in person_comention.most_common()
                              if _name(r).lower() not in {_name(x).lower() for x in person_links[p]} and n >= 3), TOP_COMENTIONS)
    neglected = sorted((r for r in knowledge if not adj[r] and mentions[r] >= 3),
                       key=lambda r: (-mentions[r], r))[:15]
    components = _components(graph)
    return {
        "date": date.today().isoformat(),
        "since": since,
        "dailies_used": dailies_used,
        "knowledge_notes": len(knowledge),
        "linked_notes": len(graph),
        "unlinked_notes": len(knowledge) - len(graph),
        "hubs_excluded": sorted(hubs, key=lambda r: (-hub_degree[r], r)),
        "components": [len(c) for c in components[:10]],
        "clusters": info,
        "cluster_members": clusters,
        "bridges": [[r, round(bc[r], 4), shown.get(r)] for r in sorted(bc, key=lambda r: (-round(bc[r], 6), r))[:TOP_BRIDGES]],
        "gaps": gaps[:TOP_GAPS],
        "unlinked_comentions": unlinked,
        "embedded_notes": len(vectors),
        "similar_unlinked": semantic,
        "near_duplicates": near_dupes,
        "wiki_twins": wiki_twins,
        "person_topics": person_topics,
        "neglected": [[r, mentions[r]] for r in neglected],
        "said_unlinked": [[r, n] for r, n in sorted(said_unlinked.items(), key=lambda kv: (-kv[1], kv[0])) if n >= 3][:TOP_COMENTIONS],
        "evidence": _evidence([(x, y) for x, y, _ in unlinked] + [(x, y) for gp in gaps[:TOP_GAPS] for x, y, _ in gp["suggest"]],
                              ev_ctx, raw),
        # full structures for _scripts/vault_graph.py (not printed)
        "_graph": {"adj": graph, "betweenness": bc, "cluster_of": shown,
                   "isolated": sorted(knowledge - set(graph)), "mentions": mentions, "recent": recent,
                   "people": {p: sorted(v & knowledge) for p, v in person_links.items() if v & knowledge},
                   "person_comention": person_comention, "raw": raw, "mention_days": ev_ctx["mention_days"],
                   # every cluster pair: [id, id, links between them, co-mentions in dailies] (topic matrix)
                   "pairs": [[sid[i], sid[j], links[(i, j)], related[(i, j)]] for i, j in combinations(range(len(clusters)), 2)
                             if links[(i, j)] or related[(i, j)]]},
    }


def _components(graph: dict) -> list[set]:
    seen, out = set(), []
    for s in graph:
        if s in seen:
            continue
        comp, q = set(), [s]
        while q:
            v = q.pop()
            if v in comp:
                continue
            comp.add(v)
            q.extend(graph[v])
        seen |= comp
        out.append(comp)
    return sorted(out, key=len, reverse=True)


# ---------------------------------------------------------------- report

def _cl(info: dict) -> str:
    core = ", ".join(f"[[{_name(r)}]]" for r in info["core"][:3])
    return f"**C{info['id']}** ({info['size']} notes · `{info['folder']}`) — {core}"


def _evidence_md(a: dict, x: str, y: str, indent: str) -> list[str]:
    """One example daily-note line under a suggestion, so the report shows why."""
    ev = a.get("evidence", {}).get(f"{x}|{y}") or a.get("evidence", {}).get(f"{y}|{x}") or []
    for day, path, line in ev:
        if line:
            return [f"{indent}- e.g. [[{_name(path)}]]: “{line}”"]
    return []


def report_md(a: dict) -> str:
    info = a["clusters"]
    lines = [
        "---", "type: report", f"created: {a['date']}", "tags:", "  - meta/cleanup", "---", "",
        f"# Gaps & Bridges — {a['date']}", "",
        "Local, InfraNodus-style structure report. **Clusters** come from links between knowledge notes; "
        "**gaps** are cluster pairs that your journals/standups keep mentioning together (or that share tags) "
        "but that barely link to each other. Suggestions only — nothing was edited.", "",
        f"- Daily notes used: **{a['dailies_used']}** (since {a['since'] or 'the beginning'}; "
        "links plus plain-text mentions of titles/aliases; carried-over lines and repeated template link lists counted once)",
        f"- Knowledge notes: **{a['knowledge_notes']}** · linked: **{a['linked_notes']}** · "
        f"no links to other knowledge notes: **{a['unlinked_notes']}**",
        f"- Clusters (≥{MIN_CLUSTER} notes): **{len(info)}** · connected components: "
        f"{', '.join(map(str, a['components'][:6]))}",
        f"- Hubs excluded from clustering: {len(a['hubs_excluded'])} "
        f"({', '.join(f'[[{_name(h)}]]' for h in a['hubs_excluded'][:6])}…)", "",
        "## Gaps — related but unlinked topic clusters",
    ]
    if not a["gaps"]:
        lines.append("- none found")
    for g in a["gaps"]:
        i, j = g["clusters"]
        why = []
        if g["comentions"]:
            why.append(f"{g['comentions']} co-mentions in daily notes")
        if g["shared_tags"]:
            why.append("shared tags " + ", ".join(f"`{t}`" for t in g["shared_tags"]))
        lines += [
            f"- {_cl(info[i])}",
            f"  ↔ {_cl(info[j])}",
            f"  - {'; '.join(why)} · only **{g['links']}** link(s) between them",
        ]
        for x, y, n in g["suggest"]:
            lines.append(f"  - [ ] consider linking [[{_name(x)}]] ↔ [[{_name(y)}]] ({n}× together in dailies)")
            lines += _evidence_md(a, x, y, "    ")
    lines += ["", "## Bridge notes — what holds topics together",
              "_Highest betweenness: removing or neglecting these splits the graph. Keep them current._", ""]
    for r, score, c in a["bridges"]:
        lines.append(f"- [[{_name(r)}]] — {score}" + (f" (C{c})" if c is not None else ""))
    lines += ["", "## Frequently co-mentioned, never linked",
              "_Pairs linked from the same daily notes again and again, with no direct link between them._", ""]
    for x, y, n in a["unlinked_comentions"]:
        lines.append(f"- [ ] [[{_name(x)}]] ↔ [[{_name(y)}]] — {n}×")
        lines += _evidence_md(a, x, y, "  ")
    lines += ["", "## Similar meaning, never linked (Smart Connections)"]
    if a["embedded_notes"]:
        lines += [f"_Each note is in the other's top {SEMANTIC_TOP_K} by embedding similarity "
                  f"({a['embedded_notes']} knowledge notes embedded), with no direct link. "
                  "Catches related notes that never show up in the same daily note._", ""]
        lines += [f"- [ ] [[{_name(x)}]] ↔ [[{_name(y)}]] — {s}" for x, y, s in a["similar_unlinked"]] or ["- none"]
        if a["near_duplicates"]:
            lines += ["", "## Possible duplicates under different names",
                      f"_Similarity ≥ {DUPLICATE_SIMILARITY} (same-name copies score 0.93–0.999). "
                      "The duplicate scan only compares same-name files, so these are new. "
                      "Judgment only — never merged automatically._", ""]
            lines += [f"- [ ] `{x[0]}` ↔ `{x[1]}` — {'same text, ' if x[3:] == ['text'] else ''}{x[2]}" for x in a["near_duplicates"]]
        if a["wiki_twins"]:
            lines += ["", "## Start Here wiki ↔ source twins",
                      "_A `Start Here` page and a note elsewhere that say nearly the same thing, with no link "
                      "between them. Decide per pair: link wiki → source, or pick one canonical copy._", ""]
            lines += [f"- [ ] `{x}` ↔ `{y}` — {s}" for x, y, s in a["wiki_twins"]]
    else:
        lines.append("- Smart Connections index not found (`.smart-env/`); section skipped.")
    if a["said_unlinked"]:
        lines += ["", "## Mentioned in dailies, never linked there",
                  "_Daily notes that name a topic in plain text (title, context name or alias) without linking it — "
                  "the topic's note never hears about that work. Linking the first mention in a standup fixes it._", ""]
        lines += [f"- [[{_name(r)}]] — named in {n} daily notes without a link" for r, n in a["said_unlinked"][:12]]
    if a["person_topics"]:
        lines += ["", "## People ↔ topics, unlinked",
                  "_Person and note named together in ≥3 daily notes, but neither links the other. "
                  "Candidates for the person's \"Current Projects & Relations\" section._", ""]
        lines += [f"- [ ] [[{_name(p)}]] ↔ [[{_name(r)}]] — {n}×" for p, r, n in a["person_topics"]]
    if a["neglected"]:
        lines += ["", "## Talked about, but isolated",
                  "_Mentioned in ≥3 daily notes yet linked to no other knowledge note._", ""]
        lines += [f"- [[{_name(r)}]] — {n} daily mentions" for r, n in a["neglected"]]
    lines += ["", "## Topic clusters", ""]
    for c in info[:TOP_CLUSTERS]:
        tag_txt = f" · tags: {', '.join(f'`{t}`' for t in c['tags'])}" if c["tags"] else ""
        lines.append(f"- {_cl(c)}{tag_txt}")
    return "\n".join(lines) + "\n"


def _since_arg() -> str | None:
    if "--all" in sys.argv:
        return None
    if "--since" in sys.argv:
        return sys.argv[sys.argv.index("--since") + 1]
    return (date.today() - timedelta(days=365)).isoformat()


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")  # note names contain em-dashes; Windows console is cp1252
    a = analyze(_since_arg())
    summary = {k: v for k, v in a.items() if k not in ("cluster_members", "_graph")}
    print(json.dumps(summary, indent=2, ensure_ascii=False))
    if "--report" in sys.argv:
        out = vl.VAULT / _FOLDERS["reports"] / f"Gaps & Bridges {a['date']}.md"
        out.parent.mkdir(parents=True, exist_ok=True)
        # Jackson approves rows by ticking them in the report; never overwrite those decisions
        if out.exists() and re.search(r"^\s*- \[[x\-]\]", vl.read_text(out), re.M):
            out = out.with_name(f"Gaps & Bridges {a['date']} {datetime.now():%H%M}.md")
        out.write_text(report_md(a), encoding="utf-8")
        save_cluster_state(a)
        print(f"\nWrote {vl.rel(out)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
