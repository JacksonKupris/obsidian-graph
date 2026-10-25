#!/usr/bin/env python3
"""vault_graph - the analysis behind the Vault Graph plugin: the graph data every device reads.

Node size = betweenness (influence) or recent activity, colour = topic cluster, cluster names on
the canvas, dashed edges = gap suggestions (co-mentioned in dailies or similar meaning, but unlinked).
"Hide top N" removes the most influential notes and reports what falls apart.

Usage:
    python _scripts/vault_graph.py                  # writes the graph data (files.data in vault_graph_rules.json)
    python _scripts/vault_graph.py --state          # ...and the weekly State of the Vault note
    python _scripts/vault_graph.py --since 2026-01-01 | --all   # daily-note window, as vault_gaps

The plugin itself (renderer, scenes, actions, rules code) and its build and browser tests live in their own
repository (vault-graph, ~/Projects/vault-graph): `npm run deploy` there builds it with this vault's rules file and
installs it. No third-party code; analysis comes from vault_gaps.analyze(). Works offline.
"""
import json
from collections import Counter
import re
import socket
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import vault_gaps as vg
import moc_align  # noqa: E402

OUT = (vg.vl.VAULT / vg.rules.RULES["files"]["data"]).parent   # files.data in vault_graph_rules.json


USAGE_LOG = vg.vl.VAULT / ".obsidian" / "plugins" / "graph-insight" / "data" / "usage.json"   # Advanced Graph View
ATTACHMENT_RE = re.compile(r"\.(png|jpe?g|gif|svg|webp|bmp|pdf|mp4|mov|mp3|csv|xlsx?|docx?|pptx?|zip|canvas|excalidraw)$")


def note_opens(paths: set[str]) -> tuple[dict, bool]:
    """Opens per note from Advanced Graph View's local usage log: {path: (all-time, last 90 days)}.
    Format: {path: {total, days: {YYYY-MM-DD: n}, months, years}} (days kept ~90 days, then compacted)."""
    if not USAGE_LOG.is_file():
        return {}, False
    try:
        log = json.loads(USAGE_LOG.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}, False
    since = (date.today() - timedelta(days=90)).isoformat()
    out = {}
    for path, u in log.items():
        if path in paths and isinstance(u, dict):
            days = u.get("days") or {}
            out[path] = (int(u.get("total") or 0), sum(int(n) for d, n in days.items() if d >= since))
    return out, True


WANTED_MAX = 40          # ghost nodes shown for notes linked to but never written
CODE = re.compile(r"```.*?```|`[^`\n]*`", re.S)   # [[...]] inside code is data (e.g. Odoo domains), not a link
PLACEHOLDER = re.compile(r"^(resource|link|note|page|item|example|placeholder)\s*\d*$|['\",]", re.I)
FILENAME_BAD = re.compile(r'[\\/:*?"<>|#^\[\]]')


def link_health(paths: set[str]) -> tuple[dict, list]:
    """Per knowledge note: (inbound from knowledge notes, outbound to knowledge notes, broken targets), distinct notes.
    In/out count only links between graph notes -- the same count the plugin's liveMerge makes -- so the food web,
    orphans and dead ends agree in Obsidian and on this page (counting dailies and hubs here pushed notes up the web).
    Also the "wanted" notes: link targets with no file, ranked by how many knowledge notes link them."""
    by_name: dict[str, list[str]] = {}
    for f in vg.vl.md_files():
        by_name.setdefault(f.stem.lower(), []).append(vg.vl.rel(f))
    resolve = vg._make_resolver(by_name)   # one file per link, like the analysis
    inbound: dict[str, set] = {p: set() for p in paths}
    out = {}
    wanted: dict[str, set] = {}
    spelling: dict[str, dict] = {}
    for f in vg.vl.md_files():
        r = vg.vl.rel(f)
        text = CODE.sub(" ", vg.vl.read_text(f))
        targets = set(vg._targets(text))
        resolved = resolve(r, text)
        for t in (resolved & paths) if r in paths else ():
            inbound[t].add(r)
        if r in paths:
            broken = {name for name in targets if name not in by_name and not ATTACHMENT_RE.search(name)}
            out[r] = [len((resolved & paths) - {r}), len(broken)]
            for raw in vg.vl.WIKI_RE.findall(text):
                name = raw.rstrip("\\ ").split("/")[-1].strip()
                if name.lower() in broken and 2 < len(name) < 120 and not PLACEHOLDER.search(name):
                    wanted.setdefault(name.lower(), set()).add(r)
                    spelling.setdefault(name.lower(), {}).setdefault(name, 0)
                    spelling[name.lower()][name] += 1
    ranked = sorted(wanted.items(), key=lambda kv: (-len(kv[1]), kv[0]))[:WANTED_MAX]
    wanted_out = [{"id": f"wanted:{k}", "name": max(spelling[k], key=spelling[k].get), "refs": sorted(v),
                   "creatable": not FILENAME_BAD.search(max(spelling[k], key=spelling[k].get))} for k, v in ranked]
    return {p: (len(inbound[p]), *out.get(p, [0, 0])) for p in paths}, wanted_out


DATED = re.compile(r"\d{4}-\d{2}(-\d{2})?")


def dated_series(paths: set[str]) -> list[dict]:
    """Notes that differ only by a date ("Transaction Updates 2026-05-19", "... 2026-06-29"):
    a series. Returned oldest first, so consecutive notes can link previous/next."""
    groups: dict[str, list] = {}
    for r in paths:
        name = vg._name(r)
        m = DATED.search(name)
        if m:
            key = vg.SERIES_RE.sub(" ", DATED.sub(" ", name)).strip().lower()
            groups.setdefault(key, []).append((m.group(0), r))
    out = []
    for key, members in sorted(groups.items()):
        if len(members) >= 3 and key:
            members.sort()
            out.append({"name": DATED.sub("", vg._name(members[-1][1])).strip(" -—_"), "notes": [r for _, r in members]})
    return out


TASK_OPEN = re.compile(r"^\s*[-*+] \[ \] ", re.M)
# Rule data shared with the plugin (its deploy builds the same file in)
RULES = vg.rules.RULES
STUB_WORDS = RULES["stub_words"]
STALE_DAYS = RULES["stale_days"]
is_record = vg.rules.is_record


def node_tags(tags: set) -> list:
    """Tags carried in the graph data: every status/ and type/ tag (the shared rules read them -- trimming to six
    dropped status/done from notes with many tags, so finished work still showed as stale), plus up to six others."""
    rule = sorted(t for t in tags if t.startswith(("status/", "type/")))
    return rule + sorted(t for t in tags if t not in rule)[:6]


# ---------------------------------------------------------------- real "last edited" dates
# File dates say nothing here: bulk link and tag passes and Obsidian Sync touched nearly every note in October 2026
# (12 of 674 notes were 90+ days "old"). A note's age is days since its *content* last changed: a fingerprint of the
# body without frontmatter, the Related / Merged-from sections the automation adds, "Possible duplicate" / "Overlaps
# with" lines, generated hub lists, or whitespace. The plugin keeps the log (CONTENT_LOG) current while Obsidian is
# open (same fingerprint, the plugin's contentBody); this run checks it and bootstraps missing notes from
# the git snapshot of 2026-07-03.
CONTENT_LOG = vg.vl.VAULT / RULES["files"]["content_log"]   # not indexed: stays out of recent-files lists
CONTENT_BACKUP = vg.vl.VAULT / RULES["files"]["content_backup"]   # survives a plugin reinstall wiping the plugin folder
GIT_BASELINE = "2026-07-03"
GEN_MARK = "%% vault-graph:generated"
DROP_SECTION = re.compile(r"^#{1,6}\s*(related\b|merged from\b)", re.I)
DROP_LINE = re.compile(r"possible duplicate:|overlaps with", re.I)
FM_DATE_KEYS = ("modified", "updated", "date modified", "reviewed")


def content_body(text: str) -> str:
    body = vg.FRONTMATTER_RE.sub("", text, count=1).split(GEN_MARK)[0]
    out, skip = [], False
    for line in body.splitlines():
        if line.lstrip().startswith("#"):
            skip = bool(DROP_SECTION.match(line.strip()))
            if skip:
                continue
        if skip or DROP_LINE.search(line):
            continue
        out.append(line)
    return " ".join(" ".join(out).split())


def fingerprint(text: str) -> str:
    """FNV-1a over UTF-16 code units, so the plugin (JavaScript strings) computes the same value."""
    from array import array
    units = array("H"); units.frombytes(content_body(text).encode("utf-16-le"))
    h = 0x811C9DC5
    for u in units:
        h = ((h ^ u) * 0x01000193) & 0xFFFFFFFF
    return format(h, "08x")


def _git_baseline(paths) -> dict:
    """Note text as of the git snapshot, for notes that have no fingerprint yet (one `git cat-file --batch`)."""
    import subprocess
    try:
        res = subprocess.run(["git", "-C", str(vg.vl.VAULT), "cat-file", "--batch"], input="".join(f"HEAD:{p}\n" for p in paths).encode("utf-8"),
                             capture_output=True, timeout=120)
    except (OSError, subprocess.SubprocessError):
        return {}
    out, data, i = {}, res.stdout, 0
    for p in paths:
        nl = data.find(b"\n", i)
        if nl < 0:
            break
        head = data[i:nl].decode("utf-8", "replace").split()
        i = nl + 1
        if len(head) == 3 and head[1] == "blob":
            size = int(head[2]); out[p] = data[i:i + size].decode("utf-8", "replace"); i += size + 1
    return out


def content_dates(paths: set[str], raw: dict, mention_days: dict) -> dict:
    """path -> date its content last changed (ISO). Updates the content log."""
    log = {}
    for f in (CONTENT_LOG, CONTENT_BACKUP):   # the backup when a reinstall removed the plugin folder
        try:
            log = json.loads(f.read_text(encoding="utf-8")); break
        except (OSError, ValueError):
            pass
    today = date.today().isoformat()
    missing = [p for p in sorted(paths) if p not in log]
    base = _git_baseline(missing) if missing else {}
    out = {}
    for p in sorted(paths):
        text = raw.get(p, "")
        h, e = fingerprint(text), log.get(p)
        fm = vg._frontmatter(text)
        fm_dates = [str(fm.get(k))[:10] for k in FM_DATE_KEYS if fm.get(k) and re.match(r"\d{4}-\d{2}-\d{2}", str(fm.get(k)))]
        if e and e.get("h") == h:
            since = e["since"]
        elif e:   # changed while the plugin wasn't watching: the file's date is the best guess (bulk edits don't change the fingerprint)
            try:
                since = date.fromtimestamp((vg.vl.VAULT / p).stat().st_mtime).isoformat()
            except OSError:
                since = today
        else:
            born = born_date(p, text, mention_days.get(p))
            if p in base and fingerprint(base[p]) == h:   # unchanged since the snapshot: last change on or before it
                known = [d for d in [born, *fm_dates] if d and d <= GIT_BASELINE]
                since = max(known) if known else GIT_BASELINE
            else:   # new or changed since the snapshot
                floor = GIT_BASELINE if p in base else born
                since = max([floor, *fm_dates, *[d for d in (mention_days.get(p) or []) if d <= today]] or [today])
        since = min(since, today)
        log[p] = {"h": h, "since": since}
        rv = str(fm.get("reviewed") or "")[:10]   # "Still current" in the graph stamps reviewed: it counts as fresh
        out[p] = max(since, rv) if re.match(r"\d{4}-\d{2}-\d{2}$", rv) else since
    for p in [p for p in log if p not in paths and not (vg.vl.VAULT / p).exists()]:
        del log[p]   # deleted notes
    text = json.dumps(log, indent=0, sort_keys=True) + "\n"
    for f in (CONTENT_LOG, CONTENT_BACKUP):
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(text, encoding="utf-8")
    return out


# ---------------------------------------------------------------- real task ages
TASK_ANY = re.compile(r"^\s*[-*+] \[(.)\] (.+)$", re.M)


def _task_key(t: str) -> str:
    t = re.sub(r"\[\[(?:[^\]|]*\|)?([^\]]*)\]\]", r"\1", t.lower())
    t = re.sub(r"\d{4}-\d{2}-\d{2}|https?://\S+|[^a-z0-9 ]", " ", t)
    return " ".join(t.split())[:60]


def task_ages(paths: set[str], raw: dict, born: dict) -> dict:
    """path -> [[task text, first seen (ISO)], ...] oldest first: the first journal or standup a task appears in
    (journals carry tasks forward), else the note's creation date."""
    first: dict[str, str] = {}
    daily = vg.vl.VAULT / vg.FOLDERS["daily"]
    for f in daily.rglob("*.md"):
        m = vg.vl.DATE_RE.search(f.name)
        if not m:
            continue
        try:
            text = f.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        for _, t in TASK_ANY.findall(text):
            k = _task_key(t)
            if len(k) >= 8 and (k not in first or m.group(1) < first[k]):
                first[k] = m.group(1)
    out = {}
    for p in paths:
        body = vg.FRONTMATTER_RE.sub("", raw.get(p, ""), count=1)
        items = [[t.strip()[:90], min(filter(None, [first.get(_task_key(t)), born.get(p)]), default=born.get(p))] for st, t in TASK_ANY.findall(body) if st == " "]
        if items:
            out[p] = sorted(items, key=lambda x: x[1] or "9999")
    return out


def note_quality(paths: set[str], raw: dict, edited: dict) -> dict:
    """Per note: (open tasks, words, days since its content last changed, has a `references:` property)."""
    today = date.today()
    out = {}
    for p in paths:
        text = raw.get(p, "")
        body = vg.FRONTMATTER_RE.sub("", text, count=1)
        age = (today - date.fromisoformat(edited[p])).days if p in edited else 0
        out[p] = (len(TASK_OPEN.findall(body)), len(re.findall(r"[A-Za-z0-9]+", body)), age,
                  bool(vg._frontmatter(text).get("references")))
    return out


METADATA_LINE = re.compile(r"^(-{3,}|\*{3,}|[-*+]?\s*\**[\w /&-]{2,30}\**\s*:\**\s|#[\w/-]+(\s+#[\w/-]+)*$|\|)")


SKIP_SECTION = re.compile(r"^(related|references|links|see also|backlinks|sources|tags)\b", re.I)
SQL_WORD = r"\b(?:SELECT|INSERT|UPDATE|CREATE|DELETE|ALTER|DECLARE|BEGIN|COLLATE)\b|SET @"
WIKILINK = re.compile(r"\[\[[^\]]*\]\]")


def _paragraphs(text: str) -> list[tuple[str, str]]:
    """(heading, paragraph) pairs of a note's prose: no frontmatter, code, or very short lines."""
    text = CODE.sub(" ", vg.FRONTMATTER_RE.sub("", text, count=1))
    heading, out, buf = "", [], []
    def flush():
        para = " ".join(buf).strip()
        if len(para) >= 40:
            out.append((heading, para))
        buf.clear()
    for line in text.splitlines():
        s = line.strip()
        if s.startswith("#") and not s.startswith("#meta") and " " in s:
            flush(); heading = s.lstrip("#").strip()
        elif not s or METADATA_LINE.match(s):   # "**Status**: Production", "---", tag lines: boilerplate, not prose
            flush()
        else:
            buf.append(re.sub(r"^[-+]\s*(\[.\]\s*)?|^\*\s+(\[.\]\s*)?|^\d+[.)]\s*", "", s).replace("**", ""))
    flush()
    keep = []
    for h, p in out:
        if SKIP_SECTION.match(h) or len(re.findall(SQL_WORD, p)) >= 2:
            continue   # link lists, our own Related sections, stray SQL: not where two notes "meet"
        prose = WIKILINK.sub(" ", p)
        if len(prose.strip()) < 0.5 * len(p) or len(re.findall(r"[A-Za-z]{3,}", prose)) < 6:
            continue   # mostly links
        keep.append((h, re.sub(r"\[\[(?:[^\]|]*\|)?([^\]]*)\]\]", r"\1", p)))
    return keep


def closest_passages(pairs, raw: dict) -> dict:
    """For each suggested pair, the two passages (one per note) with the most words in common
    (tf-idf cosine). Not semantic -- word overlap -- but it shows WHERE two notes meet."""
    import math
    tok = lambda s: [w for w in re.findall(r"[a-z][a-z0-9]{2,}", s.lower()) if w not in vg.TEXT_STOP]
    out = {}
    for x, y in pairs:
        px, py = _paragraphs(raw.get(x, ""))[:120], _paragraphs(raw.get(y, ""))[:120]
        if not px or not py:
            continue
        docs = [Counter(tok(p)) for _, p in px + py]
        df = Counter(w for d in docs for w in d)
        n = len(docs)
        vec = [{w: c * math.log(1 + n / df[w]) for w, c in d.items()} for d in docs]
        norm = [math.sqrt(sum(v * v for v in d.values())) or 1 for d in vec]
        best = (0.0, 0, 0)
        for i in range(len(px)):
            for j in range(len(py)):
                a, b = vec[i], vec[len(px) + j]
                s = sum(v * b.get(w, 0) for w, v in a.items()) / (norm[i] * norm[len(px) + j])
                if s > best[0]:
                    best = (s, i, j)
        if best[0] >= 0.12:
            clip = lambda t: t if len(t) <= 160 else t[:157] + "…"
            out[f"{x}|{y}"] = {"score": round(best[0], 2),
                               "a": [px[best[1]][0], clip(px[best[1]][1])], "b": [py[best[2]][0], clip(py[best[2]][1])]}
    return out


SNAP_DIR = OUT / "snapshots"


def snapshot_and_changes(data: dict) -> dict:
    """Save today's snapshot; compare with the latest earlier one: what changed since the last run."""
    nodes = {n["id"]: n for n in data["nodes"] if not n.get("ghost") and not n.get("person")}
    linked = {frozenset((l["source"], l["target"])) for l in data["links"] if l["kind"] == "link"}
    cur = {
        "date": data["date"],
        "clusters": {str(c["id"]): c["name"] for c in data["clusters"]},
        "gaps": sorted(f'{g["a"]}|{g["b"]}' for g in data["gaps"]),
        "suggested": sorted(f'{l["source"]}|{l["target"]}' for l in data["links"] if l["kind"] in ("gap", "similar")),
        "recent": sorted(p for p, n in nodes.items() if n["recent"] > 0),
        "notes": sorted(nodes),
        "linked_notes": sum(1 for n in nodes.values() if not n["isolated"]),
        "cluster_of": {p: n["cluster"] for p, n in nodes.items() if n["cluster"] >= 0},   # for replaying how topics change
    }
    SNAP_DIR.mkdir(parents=True, exist_ok=True)
    (SNAP_DIR / f"{data['date']}.json").write_text(json.dumps(cur), encoding="utf-8")
    earlier = sorted(f for f in SNAP_DIR.glob("*.json") if f.stem < data["date"])
    if not earlier:
        return {"since": None}
    prev = json.loads(earlier[-1].read_text(encoding="utf-8"))
    pn = lambda key: set(prev.get(key, []))
    acted = [p for p in pn("suggested") if frozenset(p.split("|")) in linked]
    return {
        "since": prev["date"],
        "linked_delta": cur["linked_notes"] - prev.get("linked_notes", cur["linked_notes"]),
        "new_notes": sorted(set(cur["notes"]) - pn("notes"))[:30],
        "new_clusters": [cur["clusters"][k] for k in cur["clusters"] if k not in prev.get("clusters", {})],
        "gone_clusters": [v for k, v in prev.get("clusters", {}).items() if k not in cur["clusters"]],
        "gaps_closed": sorted(pn("gaps") - set(cur["gaps"])),
        "gaps_new": sorted(set(cur["gaps"]) - pn("gaps")),
        "acted": acted[:30],
        "quiet": sorted(pn("recent") - set(cur["recent"]))[:20],
        "active": sorted(set(cur["recent"]) - pn("recent"))[:20],
    }


BORN_KEYS = ("created", "date created", "date_created")


def born_date(r: str, text: str, mention_days) -> str:
    """When a note came into being, as best we can tell: the earliest of its `created:` frontmatter,
    a date in its file name, its first mention in a daily note, and its file date."""
    cands = []
    fm = vg._frontmatter(text) if hasattr(vg, "_frontmatter") else {}
    for k in BORN_KEYS:
        v = str((fm or {}).get(k) or "")
        m = re.match(r"(\d{4}-\d{2}-\d{2})", v)
        if m:
            cands.append(m.group(1))
    m = vg.vl.DATE_RE.search(Path(r).name)
    if m:
        cands.append(m.group(1))
    if mention_days:
        cands.append(min(mention_days))
    try:
        stt = (vg.vl.VAULT / r).stat()   # st_ctime is the creation time on Windows
        cands += [date.fromtimestamp(stt.st_mtime).isoformat(), date.fromtimestamp(stt.st_ctime).isoformat()]
    except OSError:
        pass
    return min(c for c in cands if c >= "2015-01-01") if any(c >= "2015-01-01" for c in cands) else date.today().isoformat()


TIMELINE_WEEKS = 26


def timeline(mention_days: dict, cid: dict, paths: set) -> dict:
    """Daily-note mentions per week for the last half year: per cluster, and for the 40 most-mentioned notes."""
    start = date.today() - timedelta(days=date.today().weekday() + 7 * (TIMELINE_WEEKS - 1))
    weeks = [(start + timedelta(weeks=i)).isoformat() for i in range(TIMELINE_WEEKS)]
    def bucket(day):
        i = (date.fromisoformat(day) - start).days // 7
        return i if 0 <= i < TIMELINE_WEEKS else None
    clusters, notes = {}, {}
    for r, days in mention_days.items():
        if r not in paths:
            continue
        row = [0] * TIMELINE_WEEKS
        for d in days:
            i = bucket(d)
            if i is not None:
                row[i] += 1
        if not any(row):
            continue
        notes[r] = row
        c = cid.get(r, -1)
        if c >= 0:
            clusters[c] = [x + y for x, y in zip(clusters.get(c, [0] * TIMELINE_WEEKS), row)]
    top = sorted(notes, key=lambda r: -sum(notes[r]))[:40]
    return {"weeks": weeks, "clusters": {str(c): v for c, v in clusters.items()}, "notes": {r: notes[r] for r in top}}


STANDUP_RE = re.compile(r"Daily Standup (\d{4}-\d{2}-\d{2})\.md$")
_STOP = set("""the and for with that this from into onto then than have has had was were are will would could should
not but its it's out off our their there them they you your about after before again also more most some any all
can just get got make made making work working done doing look looked looking continue continued finish finished
start started need needs needed sure still today tomorrow next week day days new up down over under via per
what when where which while who how why each other same see set use used using way well back""".split())


def _words(text: str) -> set:
    text = re.sub(r"\[\[([^\]|]*\|)?([^\]]*)\]\]", r"\2", text.lower())
    out = set()
    for w in re.findall(r"[a-z0-9][a-z0-9_-]{2,}", text):
        if w in _STOP or w.isdigit():
            continue
        if len(w) > 4:   # crude stem: "outages" ~ "outage", "validating" ~ "validate"
            w = re.sub(r"(ings?|ed|es|s)$", "", w).rstrip("e")
        out.add(w)
    return out


def _section(text: str, head: str) -> str:
    m = re.search(rf"^## \d+\.\s*{head}[^\n]*\n(.*?)(?=^## |\Z)", text, re.S | re.M)
    return m.group(1) if m else ""


def _items(sec: str) -> list[str]:
    """Top-level numbered items, each with its nested lines folded in (they carry the detail)."""
    items, cur = [], None
    for line in sec.splitlines():
        if re.match(r"^\d+\.\s+\S", line):
            if cur:
                items.append(cur)
            cur = re.sub(r"^\d+\.\s+", "", line).strip()
        elif cur is not None and re.match(r"^\s+(\d+\.|[-*])\s+\S", line):
            cur += " · " + re.sub(r"^\s+(\d+\.|[-*])\s+", "", line).strip()
    if cur:
        items.append(cur)
    return [i.replace("**", "") for i in items if len(_words(i)) >= 2]


def followthrough(days: int = 150) -> dict:
    """Standup follow-through: each "Work Expected Tomorrow" item, matched against the completed work of the
    next standups. Done next day / done later / carried forward (still planned, not yet done) / dropped."""
    files = {}
    for p in (vg.vl.VAULT / vg.FOLDERS["daily"]).rglob("Daily Standup *.md"):
        m = STANDUP_RE.search(p.name)
        if m:
            files[m.group(1)] = p
    dates = sorted(files)
    cutoff = (date.today() - timedelta(days=days)).isoformat()
    parsed = {}
    for d in dates:
        t = files[d].read_text(encoding="utf-8", errors="ignore")
        done_lines = []
        for item in _items(_section(t, "Work Completed")):
            head, *subs = item.split(" · ")
            done_lines += [head + " " + s for s in subs] or [head]   # each detail line, with its project header
            if len(subs) > 1:
                done_lines.append(" ".join([head] + subs))   # and the whole project block: evidence is often spread over lines
        parsed[d] = {"exp": _items(_section(t, "Work Expected")), "done": [(x, _words(x)) for x in done_lines]}

    # Rare words carry the match: "elastic" says far more than "server", which is in half the standups
    import math
    df = Counter(w for d in dates for _, cw in parsed[d]["done"] for w in cw)
    n_lines = max(1, sum(len(parsed[d]["done"]) for d in dates))
    idf = lambda w: math.log((n_lines + 1) / (df.get(w, 0) + 1)) + 0.1

    def overlap(ws, cw):
        key = sorted(ws, key=idf, reverse=True)[:6]   # long plans: their 6 most telling words are plenty
        shared = [w for w in key if w in cw]
        return (sum(map(idf, shared)) / max(1e-9, sum(map(idf, key)))) if len(shared) >= 2 else 0.0

    def best(ws, lines):
        sc, hit = 0.0, ""
        for text, cw in lines:
            s = overlap(ws, cw)
            if s > sc:
                sc, hit = s, text
        return sc, hit

    out = []
    for i, d in enumerate(dates):
        if d < cutoff or i == len(dates) - 1:
            continue
        for item in parsed[d]["exp"]:
            ws, hw = _words(item), _words(item.split(" · ")[0])   # the whole plan, and just its headline
            status, when, match, carried = "dropped", None, "", 0
            for j, d2 in enumerate(dates[i + 1:i + 8], 1):
                sc, hit = max(best(ws, parsed[d2]["done"]), best(hw, parsed[d2]["done"]) if len(hw) >= 2 else (0, ""))
                if sc >= 0.38:
                    status, when, match = ("next" if j == 1 else "later"), d2, hit
                    break
                if any(overlap(ws, _words(e)) >= 0.5 for e in parsed[d2]["exp"]):
                    carried += 1
            if status == "dropped" and carried:
                status = "carried"
            if status == "dropped" and i >= len(dates) - 2:
                status = "pending"   # the most recent plan: tomorrow hasn't been written yet
            out.append({"d": d, "t": item[:220], "s": status, "w": when, "m": match[:200], "c": carried})
    return {"items": out, "standups": len([d for d in dates if d >= cutoff]), "days": days}


# ---------------------------------------------------------------- code <-> docs
# Git history (file paths and dates only: no code is read) matched against the files and components your
# notes mention. Repos are the git folders under ~/Documents/VSCode with commits in the window; on a
# machine without them (the Windows home PC) this is simply empty.
CODE_ROOTS = [Path(p).expanduser() for p in vg.rules.RULES.get("code_roots", [])]   # where your git repos live
CODE_DAYS = 365
CODE_EXT = r"(?:jsx?|tsx?|py|java|sql|sh|cjs|mjs|css)"
SKIP_CODE = re.compile(r"(^|/)(node_modules|\.next|dist|build|__pycache__|coverage|\.git)/|package-lock\.json$|\.min\.js$")
DOC_SKIP = re.compile(r"^(\.trash|\.obsidian|_scripts|_templates|01-Daily)/")
POINT_IN_TIME = re.compile(r"Release[- ]Notes|Scopes? of Work|Retrospective|Standup|Show and Tell|\d{4}-\d{2}-\d{2}", re.I)


def _git(repo: Path, *args) -> str:
    import subprocess
    try:
        return subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True, timeout=120).stdout
    except Exception:
        return ""


def code_docs() -> dict:
    roots = [r for r in CODE_ROOTS if r.is_dir()]
    if not roots:
        return {"repos": [], "roots": [str(r) for r in CODE_ROOTS]}
    since = (date.today() - timedelta(days=CODE_DAYS)).isoformat()
    d90 = (date.today() - timedelta(days=90)).isoformat()
    repos, touches, tracked = [], {}, {}   # "repo/path" -> [dates of commits touching it]
    for repo in sorted(p for r in roots for p in r.iterdir() if (p / ".git").exists()):
        log = _git(repo, "log", f"--since={since}", "--no-merges", "--name-only", "--format=@@%ad", "--date=short")
        if "@@" not in log:
            continue
        repos.append(repo.name)
        day = None
        for line in log.splitlines():
            if line.startswith("@@"):
                day = line[2:].strip()
            elif line.strip() and day and re.search(rf"\.{CODE_EXT}$", line) and not SKIP_CODE.search(line):
                touches.setdefault(f"{repo.name}/{line.strip()}", []).append(day)
        for f in _git(repo, "ls-files").splitlines():
            if re.search(rf"\.{CODE_EXT}$", f) and not SKIP_CODE.search(f):
                tracked[f"{repo.name}/{f}"] = True
    if not repos:
        return {"repos": [], "roots": [str(r) for r in CODE_ROOTS]}
    files = set(tracked) | set(touches)
    by_base, by_stem = {}, {}
    for f in files:
        base = f.rsplit("/", 1)[-1]
        by_base.setdefault(base.lower(), []).append(f)
        stem = base.rsplit(".", 1)[0]
        if re.fullmatch(r"[A-Z][a-z]+(?:[A-Z][a-z0-9]+)+", stem) and len(stem) >= 8:   # components: AlertSidebar, FulfillmentDetailModal
            by_stem.setdefault(stem, []).append(f)

    def resolve(mention: str) -> list:
        m = mention.strip("`'\"()[],.:;").replace("\\", "/")
        if "/" in m:   # a path: match by suffix (src/app/api/x/route.js, job-fulfillment/route.js)
            suf = "/" + m.lstrip("./").lower()
            hits = [f for f in files if f.lower().endswith(suf)]
            return hits if 0 < len(hits) <= 3 else []
        hits = by_base.get(m.lower(), [])
        return hits if len(hits) == 1 else []   # a bare "route.js" or "index.js" is ambiguous: skip it

    path_re = re.compile(rf"(?<![\w/])((?:[\w.\[\]@-]+/)*[\w.\[\]@-]+\.{CODE_EXT})\b")
    comp_re = re.compile(r"\b([A-Z][a-z]+(?:[A-Z][a-z0-9]+)+)\b")
    doc_files, doc_edit = {}, {}
    for p in vg.vl.VAULT.rglob("*.md"):
        rel = p.relative_to(vg.vl.VAULT).as_posix()
        if DOC_SKIP.match(rel):
            continue
        try:
            text = p.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        hit = set()
        for m in path_re.findall(text):
            hit.update(resolve(m))
        for c in set(comp_re.findall(text)):
            if len(by_stem.get(c, [])) == 1:
                hit.update(by_stem[c])
        if hit:
            doc_files[rel] = sorted(hit)
            doc_edit[rel] = date.fromtimestamp(p.stat().st_mtime).isoformat()
    docs_of = {}
    for rel, fs in doc_files.items():
        for f in fs:
            docs_of.setdefault(f, []).append(rel)

    # areas = folders of code: how often they change, and which notes describe any file in them
    areas = {}
    for f, days in touches.items():
        a = areas.setdefault(f.rsplit("/", 1)[0], {"c90": 0, "c365": 0, "last": "", "files": set(), "docs": set()})
        a["c365"] += len(days); a["c90"] += sum(1 for x in days if x >= d90)
        a["last"] = max(a["last"], max(days)); a["files"].add(f)
    for f, rels in docs_of.items():
        if f.rsplit("/", 1)[0] in areas:
            areas[f.rsplit("/", 1)[0]]["docs"].update(rels)
    area_out = sorted(([k, a["c90"], a["c365"], a["last"], len(a["files"]), sorted(a["docs"])] for k, a in areas.items() if a["c365"] >= 3),
                      key=lambda x: (-x[1], -x[2]))[:80]
    # notes behind their code: commits to the files a note names, made after the note was last edited
    behind = []
    for rel, fs in doc_files.items():
        if POINT_IN_TIME.search(rel):   # release notes, scopes, dated plans describe the code as it was then
            continue
        rows = [[f, sum(1 for x in touches.get(f, []) if x > doc_edit[rel]), max(touches.get(f, [""]))] for f in fs]
        rows = sorted((r for r in rows if r[1]), key=lambda r: -r[1])
        if rows:
            behind.append([rel, doc_edit[rel], sum(r[1] for r in rows), rows[:8]])
    behind.sort(key=lambda b: -b[2])
    hot = sorted(([f, len(d), sum(1 for x in d if x >= d90), max(d), docs_of.get(f, [])] for f, d in touches.items()), key=lambda x: (-x[2], -x[1]))[:60]
    return {"repos": repos, "days": CODE_DAYS, "areas": area_out, "behind": behind[:60], "hot": hot,
            "docs": len(doc_files), "files": len(files)}


def rhythm(g: dict) -> dict:
    """When each topic comes up: daily-note mentions by weekday (Mon-Sun) and by month (Jan-Dec), per cluster.
    Dailies have dates, not times, so the heat clock's rings are days and months, not hours."""
    out: dict = {}
    for r, days in g["mention_days"].items():
        c = g["cluster_of"].get(r)
        if c is None:
            continue
        t = out.setdefault(str(c), {"wd": [0] * 7, "mo": [0] * 12})
        for d in days:
            try:
                dt = date.fromisoformat(str(d)[:10])
            except ValueError:
                continue
            t["wd"][dt.weekday()] += 1
            t["mo"][dt.month - 1] += 1
    return out


def graph_data(a: dict) -> dict:
    g = a["_graph"]
    adj, bc, cid = g["adj"], g["betweenness"], g["cluster_of"]
    paths = set(adj) | set(g["isolated"])
    opens, has_usage = note_opens(paths)
    health, wanted = link_health(paths)
    series = dated_series(paths)
    edited = content_dates(paths, g["raw"], g["mention_days"])
    quality = note_quality(paths, g["raw"], edited)
    borns = {r: born_date(r, g["raw"].get(r, ""), g["mention_days"].get(r)) for r in paths}
    tasks_dated = task_ages(paths, g["raw"], borns)
    nodes = [{
        "id": r, "name": vg._name(r), "cluster": cid.get(r, -1),
        "bc": round(bc.get(r, 0.0), 5), "folder": "/".join(r.split("/")[:-1]),
        "mentions": g["mentions"].get(r, 0), "recent": g["recent"].get(r, 0),
        "opens": opens.get(r, (0, 0))[0], "opens90": opens.get(r, (0, 0))[1],
        "inlinks": health[r][0], "outlinks": health[r][1], "broken": health[r][2],
        "tasks": quality[r][0], "words": quality[r][1], "age": quality[r][2], "refs": quality[r][3],
        "isolated": r not in adj, "tags": node_tags(vg._tags(g["raw"].get(r, ""))),
        "born": borns[r], "edited": edited.get(r),
        **({"taskAge": (date.today() - date.fromisoformat(tasks_dated[r][0][1])).days, "taskItems": tasks_dated[r][:12]} if r in tasks_dated and tasks_dated[r][0][1] else {}),
    } for r in sorted(paths)]
    # people: shown as their own layer, linked to the notes their person note links (or that link them)
    for p, notes in sorted(g["people"].items()):
        nodes.append({"id": p, "name": vg._name(p), "person": True, "cluster": -1, "bc": 0, "folder": "/".join(p.split("/")[:-1]),
                      "mentions": sum(n for (pp, _), n in g["person_comention"].items() if pp == p), "recent": 0,
                      "opens": 0, "opens90": 0, "inlinks": 0, "outlinks": len(notes), "broken": 0,
                      "tasks": 0, "words": 0, "age": 0, "refs": True, "isolated": False})
    links = [{"source": r, "target": t, "w": w, "kind": "link"}
             for r in sorted(adj) for t, w in sorted(adj[r].items()) if r < t]
    seen = set()

    evidence = a.get("evidence", {})

    def gap_edge(x, y, kind, why):
        key = frozenset((x, y))
        if key not in seen and x != y:
            seen.add(key)
            edge = {"source": x, "target": y, "w": 1, "kind": kind, "why": why}
            ev = evidence.get(f"{x}|{y}") or evidence.get(f"{y}|{x}")
            if ev:   # the daily notes behind a co-mention: [[day, path, line], ...]
                edge["ev"] = ev
            links.append(edge)
    for x, y, n in a["unlinked_comentions"]:
        gap_edge(x, y, "gap", f"{n}× together in daily notes")
    for gap in a["gaps"]:
        for x, y, n in gap["suggest"]:
            gap_edge(x, y, "gap", f"{n}× together in daily notes")
    for x, y, s in a["similar_unlinked"]:
        gap_edge(x, y, "similar", f"similar meaning ({s})")
    passages = closest_passages([(l["source"], l["target"]) for l in links if l["kind"] in ("gap", "similar")], g["raw"])
    for l in links:
        ps = passages.get(f'{l["source"]}|{l["target"]}')
        if ps:   # where the two notes meet: [heading, passage] in each
            l["pa"], l["pb"] = ps["a"], ps["b"]
    for p, notes in sorted(g["people"].items()):   # sorted: the same data writes the same file (no new synced version)
        links.extend({"source": p, "target": t, "w": 1, "kind": "person"} for t in sorted(notes))
    for w in wanted:
        links.extend({"source": r, "target": w["id"], "w": 1, "kind": "wanted"} for r in w["refs"][:12])
    # maps of content: shown as their own layer, linked to the members in the clusters they map
    gm = moc_align.graph_mocs(a)
    by_id = {n["id"]: n for n in nodes}
    for m in gm["mocs"]:
        if m["nav"]:
            continue
        own = {r for r in m["members"] if cid.get(r, -1) in m["clusters"]}
        nodes.append({"id": m["id"], "name": m["title"], "moc": True, "cluster": m["clusters"][0], "bc": 0, "folder": "/".join(m["id"].split("/")[:-1]),
                      "mentions": 0, "recent": 0, "opens": 0, "opens90": 0, "inlinks": 0, "outlinks": len(own), "broken": 0,
                      "tasks": 0, "words": 0, "age": 0, "refs": True, "isolated": False})
        links.extend({"source": m["id"], "target": r, "w": 1, "kind": "moc"} for r in sorted(own))
    for r, targets in gm["bridges"].items():
        if r in by_id:
            by_id[r]["bridge"] = True
            by_id[r]["bridges"] = targets
    out = {
        "vault": vg.vl.VAULT.name, "date": a["date"], "since": a["since"], "recent_days": vg.RECENT_DAYS,
        "has_usage": has_usage,
        "dailies_used": a["dailies_used"],
        "said_unlinked": [[r, n] for r, n in a["said_unlinked"] if r in paths],
        "wanted": wanted, "series": series, "rhythm": rhythm(g),
        "nodes": nodes, "links": links,
        "mocs": gm["mocs"],
        "clusters": [{"id": c["id"], "name": c["name"], "keywords": c.get("keywords", ""), "stack": c.get("stack", ""), "label": gm["labels"].get(c["id"]), "size": c["size"], "folder": c["folder"],
                      "core": [vg._name(r) for r in c["core"][:3]]} for c in a["clusters"]],
        "gaps": [{"a": gp["ids"][0], "b": gp["ids"][1], "links": gp["links"],
                  "comentions": gp["comentions"],
                  "suggest": [[x, y, n] for x, y, n in gp["suggest"]]} for gp in a["gaps"]],
        "quality": {"stub_words": STUB_WORDS, "stale_days": STALE_DAYS},
        "pairs": g["pairs"],
        "snapshots": sorted(f.stem for f in SNAP_DIR.glob("*.json")) if SNAP_DIR.exists() else [],
        "timeline": timeline(g["mention_days"], cid, paths),
        "followthrough": followthrough(),
        "near_dupes": [x for x in a.get("near_duplicates", []) if x[0] in paths and x[1] in paths],   # [a, b, share] or [a, b, share, "text"]
        "code": code_docs(),
        "scenes": scene_blocks(),
    }
    out["changes"] = snapshot_and_changes(out)
    return out


# Scenes written in notes (```vault-graph-scene blocks), for the page; the plugin collects the same list live
# (sceneBlocks) and VGRules.sceneSpec checks both. raw = the block's YAML as parsed.
SCENE_BLOCK = re.compile(r"^```vault-graph-scene[^\S\n]*\n(.*?)^```", re.M | re.S)


def scene_blocks() -> list[dict]:
    out = []
    for f in vg.vl.md_files():
        text = vg.vl.read_text(f)
        if "```vault-graph-scene" not in text:
            continue
        for i, m in enumerate(SCENE_BLOCK.finditer(text)):
            try:
                raw = vg.yaml.safe_load(m.group(1)) or {}
            except vg.yaml.YAMLError as e:
                raw = {"name": "", "_yaml": str(e)}
            out.append({"path": vg.vl.rel(f), "i": i, "raw": raw})
    return out


# ---------------------------------------------------------------- weekly State of the vault (--state)
# The maps' headlines as a note: what's heating up, what's waiting, which keystone notes are going stale, when each topic
# comes up, the biggest gaps and what changed. The gardener writes one every Friday; the plugin command "Add map
# snapshots to the latest State of the vault note" adds pictures of Weather, Radar and Food web under ## Maps.
WD_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def state_note(d: dict) -> str:
    nodes = {n["id"]: n for n in d["nodes"]}
    notes = [n for n in d["nodes"] if not n.get("person") and not n.get("moc")]
    cname = {c["id"]: (c.get("label") or c["name"]) for c in d["clusters"]}
    stale = d["quality"]["stale_days"] if "quality" in d else 180
    names = {}
    for n in notes:
        names[n["name"]] = names.get(n["name"], 0) + 1
    link = lambda n: f"[[{n['id'][:-3]}|{n['name']}]]" if names.get(n["name"], 0) > 1 else f"[[{n['name']}]]"
    L = ["---", f"created: {date.today().isoformat()}", "type: report", "tags:", "  - meta/cleanup", "---", "",
         f"# State of the vault: {date.today().isoformat()}", "",
         "_Written by `vault_graph.py --state` from the same data as the Vault Graph maps. \"Unchanged\" means the note's text, "
         "not its file date (bulk link and tag passes don't count)._", ""]
    linked = sum(1 for n in notes if not n.get("isolated"))
    L += [f"**{len(notes)} notes** · {linked} linked · {len(notes) - linked} unlinked · {len(d['clusters'])} topics · "
          f"{sum(1 for n in notes if n.get('age', 0) > stale)} unchanged for {stale}+ days", ""]
    # weather
    T = d.get("timeline") or {"weeks": [], "clusters": {}}
    w = []
    for c, ser in T["clusters"].items():
        if len(ser) < 6 or int(c) not in cname:
            continue
        recent, base = sum(ser[-3:]) / 3, sum(ser[:-3]) / max(1, len(ser) - 3)
        w.append(((recent + 0.5) / (base + 0.5), int(c), recent, base, ser[-1]))
    w.sort(reverse=True)
    L += ["## Weather: what your dailies are talking about", ""]
    hot = [x for x in w if x[0] >= 1.4 and x[2] >= 1][:4]   # at least a mention a week: 0 -> 0.3 isn't news
    cold = [x for x in sorted(w) if x[0] <= 0.6 and x[3] >= 1][:3]
    L += [f"- 🔴 **{cname[c]}**: {r:.1f}× its usual over the last three weeks ({rec:.1f} vs {base:.1f} mentions a week)" + (" · ⛈ burst this week" if last >= 4 and last >= 2.5 * (base + 0.5) else "") for r, c, rec, base, last in hot] or ["- Nothing unusually busy."]
    L += [f"- 🔵 **{cname[c]}** has gone quiet ({rec:.1f} vs {base:.1f} a week)" for r, c, rec, base, last in cold]
    L.append("")
    # radar
    tn = sorted([n for n in notes if n.get("taskAge") is not None], key=lambda n: -n["taskAge"])
    L += ["## Radar: open tasks", "",
          f"{sum(n.get('tasks', 0) for n in notes)} open tasks in {sum(1 for n in notes if n.get('tasks'))} notes · "
          f"{sum(1 for n in tn if n['taskAge'] > 90)} notes with tasks waiting 90+ days. Oldest:", ""]
    for n in tn[:5]:
        t, since = n["taskItems"][0]
        L.append(f"- {link(n)}: “{t[:80]}” · waiting since {since} ({n['taskAge']} days)")
    L.append("")
    # food web keystones
    lvl = vg.rules.trophic_levels([n for n in notes if not n.get("isolated")])   # same levels as the food web view
    adj: dict = {}
    for l in d["links"]:
        if l.get("kind") == "link" and l["source"] in lvl and l["target"] in lvl:
            adj.setdefault(l["source"], set()).add(l["target"]); adj.setdefault(l["target"], set()).add(l["source"])
    def deps(x):
        seen, q = {x}, [x]
        while q:
            y = q.pop()
            for m in adj.get(y, ()):
                if m not in seen and lvl[m] > lvl[y]:
                    seen.add(m); q.append(m)
        return len(seen) - 1
    ks = sorted(((deps(n["id"]), n) for n in notes if n["id"] in lvl and n.get("age", 0) > stale and not is_record(n)), key=lambda x: (-x[0], -x[1].get("age", 0)))
    ks = [x for x in ks if x[0] >= 3]
    L += ["## Food web: keystone notes at risk", "", "_Notes many others depend on whose text hasn't changed in a long while: worth a look, or a `Still current` in the graph._", ""]
    L += [f"- {link(n)}: {k} notes depend on it · unchanged for {n.get('age')} days" for k, n in ks[:6]] or ["- None: every note others lean on is current."]
    L.append("")
    # heat clock
    rh = d.get("rhythm") or {}
    if rh:
        tot = [0] * 7
        for v in rh.values():
            for i, x in enumerate(v["wd"]):
                tot[i] += x
        L += ["## Heat clock: when you work on what", "", f"Busiest day: **{WD_NAMES[tot.index(max(tot))]}**.", ""]
        for i, day in enumerate(WD_NAMES[:5]):
            tops = sorted(((v["wd"][i] / max(1, sum(v["wd"])), int(c)) for c, v in rh.items() if int(c) in cname and sum(v["wd"]) >= 5), reverse=True)[:2]
            if tops:
                L.append(f"- {day}: " + ", ".join(cname[c] for _, c in tops))
        L.append("")
    # gaps and changes
    if d.get("gaps"):
        L += ["## Gaps: topics that belong together but barely link", ""]
        L += [f"- {cname.get(g['a'], g['a'])} ↔ {cname.get(g['b'], g['b'])} · {(str(g['comentions']) + ' co-mentions in your dailies') if g['comentions'] else 'related by shared tags'}, {g['links']} links" for g in d["gaps"][:3]]
        L.append("")
    ch = d.get("changes") or {}
    if ch:
        L += [f"## Since {ch.get('since', 'last run')}", "",
              f"- {ch.get('linked_delta', 0):+d} linked notes · {len(ch.get('new_notes', []))} new notes · {len(ch.get('gaps_closed', []))} gaps closed · {len(ch.get('acted', []))} suggestions acted on", ""]
    L += ["## Maps", "", "_Run **Vault Graph: Add map snapshots to the latest State of the vault note** in Obsidian to add pictures here._", ""]
    return "\n".join(L)


def newest_note() -> float:
    """The newest note's modified time: an analysis is only as current as the newest note it read."""
    times = []
    for p in vg.vl.md_files():
        try:
            times.append(p.stat().st_mtime)
        except OSError:
            continue
    return max(times, default=0.0)


def newer_analysis(path: Path, built: dict) -> str | None:
    """The PC whose analysis is in `path` when it was built from newer notes than this run read, else None.
    Every PC re-analyses as you edit; one that hasn't had the other's edits synced yet would put back suggestions
    already acted on, on every device. Its own edits still show at once through the plugin's live merge."""
    try:
        old = json.loads(path.read_text(encoding="utf-8")).get("built") or {}
    except (OSError, ValueError):
        return None
    host, newest = old.get("host"), old.get("newest") or 0
    return host if host and host != built["host"] and newest > built["newest"] else None


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    a = vg.analyze(vg._since_arg())
    data = graph_data(a)
    data["built"] = {"host": socket.gethostname(), "newest": round(newest_note(), 3)}
    OUT.mkdir(exist_ok=True)
    vg.save_cluster_state(a)
    other = newer_analysis(OUT / "vault-graph.json", data["built"])
    if other:
        print(f"Kept {vg.vl.rel(OUT / 'vault-graph.json')} from {other}: it was built from newer notes than this PC has yet")
    else:
        vg.vl.write_if_changed(OUT / "vault-graph.json", json.dumps(data, ensure_ascii=False))   # synced: the phone's graph
        print(f"Wrote {vg.vl.rel(OUT / 'vault-graph.json')}  ({len(data['nodes'])} notes, {len(data['links'])} edges)")
    if "--state" in sys.argv:   # the weekly State of the vault note (the gardener runs this on Fridays)
        out = vg.vl.VAULT / vg.FOLDERS["reports"] / f"State of the Vault {date.today().isoformat()}.md"
        out.parent.mkdir(parents=True, exist_ok=True)
        if out.exists():
            out = out.with_name(f"State of the Vault {date.today().isoformat()} {datetime.now():%H%M}.md")
        out.write_text(state_note(data), encoding="utf-8")
        print(f"Wrote {vg.vl.rel(out)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
