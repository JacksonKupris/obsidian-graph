"""MOC alignment report: do the maps of content match the topics the graph actually finds?

    python _scripts/moc_align.py            # writes _System/Reports/MOC Alignment <date>.md (suggestions only)
    python _scripts/moc_align.py --apply "_System/Reports/MOC Alignment <date>.md"   # applies ONLY ticked rows

A MOC is a note tagged meta/moc, with `type: moc`, or named ...MOC/Hub/Index. Its members are the
knowledge notes it links to PLUS the notes its Dataview queries pull in (`FROM "folder"` / `FROM #tag`),
since several MOCs list their notes only through queries. Each MOC claims the cluster most of its
members sit in; one MOC per cluster (the one covering it best).

Rows carry a hidden %%act:{...}%% marker. --apply snapshots every file it touches to
.trash/moc-align-<date>/ first and only appends (sections, frontmatter keys, a superseded callout).
"""
import json
import re
import shutil
import sys
from collections import Counter, defaultdict
from datetime import date, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import vault_gaps as vg  # noqa: E402

vl = vg.vl
TODAY = date.today().isoformat()
MARK = "%% vault-graph:generated — edit above this line; everything below is regenerated %%"
# Which notes can be maps, and when a map claims a topic: shared rules (vault_graph_rules.json), so the plugin's
# live view and this analysis agree. 00-Inbox is allowed: the plugin's "Create map" writes there.
rules = vg.rules
NOT_MOC_NAME = rules.NOT_MAP_NAME_RE   # task lists, epics, series indexes
NO_NEW_MOC_TOP = {"Start Here"}   # do-not-touch structure
NAV_SPREAD = 0.35         # big hubs whose biggest cluster holds < 35% of their members are navigation, not topic maps
NAV_MIN = 60
OVERLAP = 0.5             # MOCs sharing half of the smaller one's members overlap
MIN_CLAIM = rules.RULES["map_min_claim"]   # a MOC needs 3+ members in a cluster to claim it (rules.claims)
DRIFT_ROWS = 12           # missing notes listed per MOC
NEW_MOC_MIN = 6           # clusters this big with no MOC get a "create MOC" row
DQL_BLOCK = re.compile(r"```dataview\s*\n(.*?)```", re.S | re.I)
DQL_FROM = re.compile(r"\bFROM\s+(.+?)(?=\s+(?:WHERE|SORT|LIMIT|GROUP|FLATTEN)\b|\s*$)", re.S | re.I)
ACT = re.compile(r"^\s*- \[([ xX\-])\] (.*?)%%act:(\{.*?\})%%", re.M)


def frontmatter(text: str) -> dict:
    m = vg.FRONTMATTER_RE.match(text)
    if not m:
        return {}
    try:
        fm = vg.yaml.safe_load(m.group(1)) or {}
    except vg.yaml.YAMLError:
        return {}
    return fm if isinstance(fm, dict) else {}


def is_moc(r: str, text: str, tags: set) -> bool:
    return rules.is_map_candidate(r, tags, frontmatter(text).get("type", ""))


def dataview_members(text: str, notes: dict[str, set]) -> set[str]:
    """Notes matched by the MOC's Dataview FROM clauses (folders and tags; WHERE filters ignored)."""
    out = set()
    for block in DQL_BLOCK.findall(text):
        for src in DQL_FROM.findall(block):
            for term in re.split(r"\s+(?:OR|AND)\s+", src.strip(), flags=re.I):
                term = term.strip().strip("()")
                if term.startswith(("-", "!")):
                    continue
                if term.startswith('"') and term.endswith('"'):
                    folder = term.strip('"').rstrip("/") + "/"
                    out |= {r for r in notes if r.startswith(folder)}
                elif term.startswith("#"):
                    tag = term[1:].lower()
                    out |= {r for r, ts in notes.items() if any(t == tag or t.startswith(tag + "/") for t in ts)}
    return out


def title(r: str, text: str) -> str:
    m = re.search(r"^# (.+)$", text, re.M)
    t = m.group(1) if m else Path(r).stem
    t = re.sub(r"\[\[(?:[^\]|]*\|)?([^\]]*)\]\]", r"\1", t)
    return re.sub(r"\s*[-–]?\s*(MOC|Hub|Map of Content.*)$", "", t, flags=re.I).strip() or Path(r).stem


def collect(a: dict | None = None):
    a = a or vg.analyze(vg._since_arg())
    g = a["_graph"]
    raw, cluster_of, bc = g["raw"], g["cluster_of"], g["betweenness"]
    by_name = defaultdict(list)
    for r in raw:
        by_name[Path(r).stem.lower()].append(r)
    resolve = vg._make_resolver(by_name)
    knowledge = set(g["adj"]) | set(g["isolated"])
    tags = {r: vg._tags(t) for r, t in raw.items()}
    ktags = {r: tags.get(r, set()) for r in knowledge}
    sizes = {c["id"]: c["size"] for c in a["clusters"]}
    members_of = defaultdict(list)
    for r, c in cluster_of.items():
        members_of[c].append(r)

    catchalls = {h for h in a["hubs_excluded"] if not vg._is_hub(h, tags.get(h, set())) or NOT_MOC_NAME.search(Path(h).stem)}
    mocs = []
    for r, text in raw.items():
        if not is_moc(r, text, tags.get(r, set())):
            continue
        static = resolve(r, text) & knowledge
        query = dataview_members(text, ktags)
        mem = static | query
        per = Counter(cluster_of[m] for m in mem if m in cluster_of)
        top = per.most_common(1)
        mocs.append({"path": r, "title": title(r, text), "static": static, "query": query, "members": mem, "per": per,
                     "top": top[0] if top else None, "nav": bool(top) and len(mem) >= NAV_MIN and top[0][1] < NAV_SPREAD * sum(per.values()) and len(per) >= 6,
                     "moc_for": frontmatter(text).get("moc_for"), "knowledge": r in knowledge})
    mocs = [m for m in mocs if m["path"] not in catchalls]
    # each cluster's MOC = the (non-navigation) MOC with most members in it; a MOC may map several clusters
    claim, owner = defaultdict(list), {}
    for c in sizes:
        best = max((m for m in mocs if not m["nav"] and m["per"].get(c, 0) >= MIN_CLAIM),
                   key=lambda m: (m["moc_for"] is not None, m["per"][c], m["path"]), default=None)
        # a map that spans many topics (a system's map) still maps a topic no narrower map claims, when it lists enough
        # of it (preferring narrow maps keeps a wide map from taking topics it only touches)
        if not (best and rules.claims(best["per"][c], sizes[c])):
            best = max((m for m in mocs if m["nav"] and m["per"].get(c, 0) >= MIN_CLAIM), key=lambda m: (m["per"][c], m["path"]), default=None)
        if best and rules.claims(best["per"][c], sizes[c]):
            owner[c] = best
            claim[best["path"]].append(c)
    return a, raw, cluster_of, bc, sizes, members_of, mocs, owner, claim, knowledge


def row(text: str, act: dict) -> str:
    return f"- [ ] {text} %%act:{json.dumps(act, ensure_ascii=False)}%%"


def link(r: str) -> str:
    return f"[[{Path(r).stem}]]"


def suggest_moc_path(ms: list[str], cluster_name: str, taken: set) -> tuple[str, str]:
    """Folder = where most of the cluster lives (never Start Here). Name = that folder when it's a real topic
    folder holding most of the cluster, "Project Contexts" for the context-note blob, else the cluster's words."""
    usable = [m for m in ms if "/" in m and m.split("/")[0] not in NO_NEW_MOC_TOP]
    folders = Counter(m.rsplit("/", 1)[0] for m in usable)
    folder, n = folders.most_common(1)[0] if folders else ("03-Resources", 0)
    leaf = re.sub(r"^\d+[-_ ]*", "", folder.split("/")[-1]).replace("-", " ").strip()
    if sum(1 for m in ms if m.endswith(" - Context.md")) >= 5:
        name = "Project Contexts"
    elif folder.count("/") >= 1 and n >= 0.5 * len(ms) and leaf.lower() not in {"active", "archive", "user stories"}:
        name = leaf
    else:
        name = " ".join(w for w in cluster_name.split(" · ")[:2])
    while f"{name} MOC".lower() in taken:
        name += " " + cluster_name.split(" · ")[-1]
    taken.add(f"{name} MOC".lower())
    return folder, name


def report() -> str:
    a, raw, cluster_of, bc, sizes, members_of, mocs, owner, claim, knowledge = collect()
    catchall_paths = {r for r in bc if len(re.findall(r"\w+", raw.get(r, ""))) > 3000 and (vl.DATE_RE.search(Path(r).name) or "/" not in r) and bc[r] > 0.1}
    info = {c["id"]: c for c in a["clusters"]}
    L = ["---", "type: report", f"created: {TODAY}", "tags:", "  - meta/cleanup", "---", "",
         f"# MOC Alignment — {TODAY}", "",
         "Do the maps of content match the topic clusters the graph finds? Tick rows to approve; "
         "`python _scripts/moc_align.py --apply \"<this file>\"` (or ask Claude) applies **only ticked rows**, "
         "snapshotting originals to `.trash/` and only appending. Edit the names/paths in a row before ticking if you like.", "",
         "MOC members = notes it links to **plus** notes its Dataview queries pull in (folder/tag `FROM`; `WHERE` filters ignored).", ""]

    # 1. overview
    L += ["## Topic clusters and their MOC", "", "| Cluster | Notes | MOC | Covered |", "|---|---|---|---|"]
    for cid in sorted(info, key=lambda c: -info[c]["size"]):
        m = owner.get(cid)
        cov = f"{len(set(members_of[cid]) & m['members'])}/{sizes[cid]}" if m else "—"
        weak = "" if m else max((x for x in mocs if not x["nav"] and x["per"].get(cid, 0) >= MIN_CLAIM), key=lambda x: x["per"][cid], default=None)
        weak = f" (closest: {link(weak['path'])}, {weak['per'][cid]}/{sizes[cid]})" if weak else ""
        L.append(f"| C{cid} {info[cid]['name']} | {sizes[cid]} | {link(m['path']) if m else '**none**' + weak} | {cov} |")
    nav = [m for m in mocs if m["nav"]]
    if nav:
        L += ["", "Navigation hubs (span many topics — fine as indexes, not as topic maps): " + ", ".join(link(m["path"]) for m in nav)]

    # 2. notes acting as fake bridges
    L += ["", "## Catch-all notes posing as bridges", "",
          "_Task dumps link everywhere, so they win \"influence\" and fill the Neural core. Treat them as hubs._", ""]
    ranked = sorted(bc, key=lambda r: -bc[r])
    flagged = 0
    for r in ranked[:10]:
        words = len(re.findall(r"\w+", raw.get(r, "")))
        dated = bool(vl.DATE_RE.search(Path(r).name))
        if words > 3000 and (dated or "/" not in r):
            flagged += 1
            L.append(f"- {link(r)} — influence {bc[r]:.3f} (next best {bc[ranked[1 if r == ranked[0] else 0]]:.3f}), {words} words")
            L.append("  " + row(f"treat {link(r)} as a hub (add tag `meta/hub`)", {"op": "tag", "path": r, "tag": "meta/hub"}))
            if "/" not in r:
                L.append("  " + row(f"move {link(r)} into `02-Systems/Work/` (it's a root stray)", {"op": "move", "path": r, "to": "02-Systems/Work"}))
    tagged_knowledge = sorted(r for r in knowledge if "meta/moc" in vg._tags(raw.get(r, "")))
    for r in tagged_knowledge:
        flagged += 1
        L.append(f"- {link(r)} is tagged as a MOC but counted as a topic note — fixed automatically once the analysis treats `meta/moc` as a hub (no edit needed)")
    if not flagged:
        L.append("- none")

    # 3. duplicate / overlapping MOCs
    L += ["", "## Overlapping MOCs", "", "_Two MOCs sharing most of their notes. Merge = the other gets a \"superseded by\" callout "
          "and its links not already in the canonical one are appended there. Nothing is deleted._", ""]
    over, seen = 0, set()
    key = lambda m: re.sub(r"[^a-z]", "", re.sub(r"(moc|hub|documentation|index)", "", Path(m["path"]).stem.lower()))
    for x in mocs:
        for y in mocs:
            if x["path"] >= y["path"] or x["nav"] or y["nav"] or not x["members"] or not y["members"]:
                continue
            shared = len(x["members"] & y["members"]) / min(len(x["members"]), len(y["members"]))
            if shared < OVERLAP and key(x) != key(y):
                continue
            canon, other = sorted((x, y), key=lambda m: (-len(m["members"]), m["path"]))
            over += 1
            extra = sorted(other["static"] - canon["members"])
            L.append(f"- {link(other['path'])} ({len(other['members'])} notes) overlaps {link(canon['path'])} ({len(canon['members'])} notes) — {round(100 * shared)}% shared")
            L.append("  " + row(f"merge {link(other['path'])} into {link(canon['path'])} ({len(extra)} links to carry over)",
                                {"op": "merge", "path": other["path"], "into": canon["path"], "links": extra}))
    if not over:
        L.append("- none")

    # 4. clusters with no MOC
    L += ["", "## Topics with no MOC", "", "_Creates a MOC (tagged `meta/moc`, `type: moc`) listing the cluster's notes below a generated marker, "
          "so the graph can refresh it later. Rename before ticking if the suggested name is off._", ""]
    none = 0
    taken = {Path(m["path"]).stem.lower() for m in mocs}
    for cid in sorted(info, key=lambda c: -info[c]["size"]):
        if cid in owner or sizes[cid] < NEW_MOC_MIN:
            continue
        none += 1
        folder, name = suggest_moc_path(members_of[cid], info[cid]["name"], taken)
        core = sorted(members_of[cid], key=lambda r: -bc.get(r, 0))[:5]
        L.append(f"- C{cid} **{info[cid]['name']}** — {sizes[cid]} notes, e.g. {', '.join(link(r) for r in core[:3])}")
        L.append("  " + row(f"create `{folder}/{name} MOC.md`", {"op": "create", "cluster": cid, "path": f"{folder}/{name} MOC.md", "name": name, "core": core}))
    if not none:
        L.append("- none")

    moc_paths = {x["path"] for x in mocs} | catchall_paths
    # 5. MOC drift
    L += ["", "## MOC drift — notes in the topic that its MOC misses", "",
          "_Ticked notes are appended to the MOC under \"## Also in this topic (added <date>)\"._", ""]
    for cid in sorted(owner, key=lambda c: -sizes[c]):
        m = owner[cid]
        missing = sorted(set(members_of[cid]) - m["members"] - moc_paths, key=lambda r: -bc.get(r, 0))
        if not missing:
            continue
        L.append(f"### {link(m['path'])} → C{cid} {info[cid]['name']} ({len(missing)} missing)")
        for r in missing[:DRIFT_ROWS]:
            L.append(row(f"{link(r)}", {"op": "add", "moc": m["path"], "note": r}))
        if len(missing) > DRIFT_ROWS:
            L.append(f"- …and {len(missing) - DRIFT_ROWS} more (see the graph's MOC coverage view)")
        L.append("")

    # 6. bridges for the top gaps
    L += ["## Bridge notes for the biggest gaps", "", "_Drafts a note in `00-Inbox/` with `type: bridge` and `bridges:` pointing at both MOCs; "
          "the graph puts bridge notes in the Neural core. File it once it's written._", ""]
    for gp in a["gaps"][:5]:
        i, j = gp["ids"]
        mi, mj = owner.get(i), owner.get(j)
        if (mi and mj and mi["path"] == mj["path"]) or info[i]["name"] == info[j]["name"]:
            continue   # one map covers both, or they share a name: a bridge would link a topic to itself
        L.append(row(f"bridge **{info[i]['name']}** ↔ **{info[j]['name']}** ({gp['comentions']} co-mentions, {gp['links']} links)",
                            {"op": "bridge", "a": i, "b": j, "moc_a": mi and mi["path"], "moc_b": mj and mj["path"],
                             "name_a": mi["title"] if mi else info[i]["name"], "name_b": mj["title"] if mj else info[j]["name"],
                             "suggest": [[x, y] for x, y, _ in gp["suggest"]], "core_a": sorted(members_of[i], key=lambda r: -bc.get(r, 0))[:5],
                             "core_b": sorted(members_of[j], key=lambda r: -bc.get(r, 0))[:5]}))
    return "\n".join(L) + "\n"


# ---------------------------------------------------------------- apply
def _trash_dir(name: str) -> Path:
    return vl.trash_dir(name)   # .trash, or _scripts/out/trash-fallback when .trash isn't writable


def _linked_in(text: str, note: str) -> bool:
    """The note already links to `note` (by path or name; wikilinks resolve by name)."""
    stem = Path(note).stem.lower()
    for target in re.findall(r"\[\[([^\]|#]+)", text):
        if Path(target.strip().rstrip("\\")).name.lower().removesuffix(".md") == stem:
            return True
    return False


def _snapshot(path: Path, trash: Path):
    if path.exists():
        dest = trash / vl.rel(path)
        dest.parent.mkdir(parents=True, exist_ok=True)
        if not dest.exists():
            shutil.copy2(path, dest)


def _fm_tags(block: str):
    """The tags list as YAML reads it (a single tag is a list of one); None when the frontmatter doesn't parse."""
    fm = vg._parse_fm(block)
    if not isinstance(fm, dict):
        return None
    tags = fm.get("tags")
    return [] if tags is None else [tags] if isinstance(tags, str) else list(tags) if isinstance(tags, list) else None


def _add_fm_tag(text: str, tag: str) -> str:
    """The note with `tag` added to its frontmatter tags. Any form of `tags:` (a list, [a, b], a single tag) is
    rewritten as one list with every tag it had; a frontmatter this can't read safely raises ValueError, untouched."""
    m = vg.FRONTMATTER_RE.match(text)
    if not m:
        return f"---\ntags:\n  - {tag}\n---\n" + text
    fm = m.group(1)
    old = _fm_tags(fm)
    if old is None:
        raise ValueError("its frontmatter or tags don't parse")
    if tag in old:
        return text
    lines = fm.split("\n")
    nl = "\r" if lines and lines[0].endswith("\r") else ""
    start = next((i for i, l in enumerate(lines) if re.match(r"^tags:", l)), None)
    if start is None:
        lines.append(f"tags:{nl}")
        start = end = len(lines) - 1
        end += 1
    elif re.match(r"^tags:\s*\S", lines[start]):   # [a, b] or a single tag on the key's line
        if re.match(r"^tags:\s*\[", lines[start]) and not lines[start].rstrip().endswith("]"):
            raise ValueError("its tags list spans several lines")
        end = start + 1
    else:
        end = start + 1
        while end < len(lines) and re.match(r"^\s*-", lines[end]):
            end += 1
    items = [l for l in lines[start + 1:end] if re.match(r"^\s*-", l)]
    indent = re.match(r"^(\s*)-", items[0]).group(1) if items else "  "
    lines[start:end] = [f"tags:{nl}"] + [f"{indent}- {t}{nl}" for t in [*old, tag]]
    new = "\n".join(lines)
    if _fm_tags(new) != [*old, tag]:   # every tag the note had is still there, plus the new one
        raise ValueError("its tags couldn't be rewritten safely")
    return text[:m.start(1)] + new + text[m.end(1):]


def _append_section(text: str, heading: str, body: list[str]) -> str:
    nl = "\r\n" if "\r\n" in text else "\n"
    if heading in text:   # same-day section exists: add to it
        at = text.index(heading) + len(heading)
        end = text.find(nl + "#", at)
        end = len(text) if end < 0 else end
        return text[:end].rstrip() + nl + nl.join(body) + nl + text[end:]
    return text.rstrip() + nl + nl + heading + nl + nl + nl.join(body) + nl


def apply(report_path: str) -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    rp = vl.VAULT / report_path if not Path(report_path).is_absolute() else Path(report_path)
    text = vl.read_text(rp)
    trash = _trash_dir(f"moc-align-{TODAY}")
    done, skipped, already = [], 0, 0
    adds = defaultdict(list)
    for match in ACT.finditer(text):
        mark, label, act = match.groups()
        prev_line = text[:match.start()].rstrip("\n").rsplit("\n", 1)[-1]
        if mark not in "xX":
            skipped += 1
            continue
        act = json.loads(act)
        op = act["op"]
        if op == "add":
            adds[act["moc"]].append(act["note"])
            continue
        if op == "tag":
            p = vl.VAULT / act["path"]
            if not p.exists():   # moved since (e.g. by a "move" row on an earlier run): follow it by name
                moved = [m for m in vl.VAULT.rglob(p.name) if ".trash" not in m.parts and "_scripts" not in m.parts]
                if len(moved) != 1:
                    done.append(f"skipped tag on {act['path']} (not found)")
                    continue
                p = moved[0]
            if act["tag"] in vg._tags(vl.read_text(p)):
                already += 1
                continue
            try:
                tagged = _add_fm_tag(vl.read_text(p), act["tag"])
            except ValueError as e:
                done.append(f"skipped tag on {act['path']} ({e}; add {act['tag']} by hand)")
                continue
            _snapshot(p, trash)
            p.write_text(tagged, encoding="utf-8", newline="")
            done.append(f"tagged {act['path']} {act['tag']}")
        elif op == "move":
            p = vl.VAULT / act["path"]; dest = vl.VAULT / act["to"] / p.name
            if dest.exists() and not p.exists():
                already += 1
                continue
            if dest.exists():
                done.append(f"skipped move of {act['path']} ({vl.rel(dest)} already exists)")
                continue
            _snapshot(p, trash); dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(p, dest)
            done.append(f"moved {act['path']} → {act['to']}/ (wikilinks resolve by name, so nothing breaks)")
        elif op == "merge":
            src, dst = vl.VAULT / act["path"], vl.VAULT / act["into"]
            if "Superseded by" in vl.read_text(src) and not [r for r in act["links"] if not _linked_in(vl.read_text(dst), r)]:
                already += 1
                continue
            _snapshot(src, trash); _snapshot(dst, trash)
            s = vl.read_text(src)
            m = vg.FRONTMATTER_RE.match(s)
            callout = f"> [!note] Superseded by [[{Path(act['into']).stem}]] ({TODAY}) — keep using that one.\n\n"
            if "Superseded by" not in s:
                s = (s[:m.end()] + callout + s[m.end():]) if m else callout + s
                src.write_text(s, encoding="utf-8", newline="")
            dst_text = vl.read_text(dst)
            new_links = [r for r in act["links"] if not _linked_in(dst_text, r)]   # skip what the map already lists
            if new_links:
                d = _append_section(dst_text, f"## Merged from [[{Path(act['path']).stem}]] ({TODAY})", [f"- {link(r)}" for r in new_links])
                dst.write_text(d, encoding="utf-8", newline="")
            done.append(f"merged {act['path']} into {act['into']} ({len(new_links)} new links)")
        elif op == "create":
            global _CACHE
            _CACHE = _CACHE or collect()
            a, raw, cluster_of, bc, sizes, members_of, mocs, owner, *_ = _CACHE
            p = vl.VAULT / act["path"]
            if p.exists():
                already += 1
                continue
            # Cluster numbers change every time the analysis runs, so find the topic by its notes: the row's
            # "core" list (new reports) or the example notes on the line above it (older reports).
            core = act.get("core") or []
            if not core:
                names = {n.strip().lower() for n in re.findall(r"\[\[([^\]|#]+)", prev_line)}
                core = [r for r in cluster_of if Path(r).stem.lower() in names]
            votes = Counter(cluster_of[r] for r in core if r in cluster_of)
            cid, hits = votes.most_common(1)[0] if votes else (None, 0)
            if cid is None or hits < max(2, (len(core) + 1) // 2) or len(members_of[cid]) < 3:
                done.append(f"skipped create {act['path']} (its topic changed since the report — re-run moc_align.py for a fresh row)")
                continue
            if cid in owner:   # the topic merged into one that already has a map: don't make a second map for it
                done.append(f"skipped create {act['path']} (that topic is now covered by {Path(owner[cid]['path'] if isinstance(owner[cid], dict) else owner[cid]).stem})")
                continue
            ms = sorted(members_of[cid], key=lambda r: -bc.get(r, 0))
            body = ["---", f"created: {TODAY}", "tags:", "  - meta/moc", "type: moc", "---", "", f"# {act['name']}", "",
                    "> Map of content. Write an overview here; everything below the marker is regenerated by Vault Graph.", "",
                    MARK, "", "## Core", *[f"- {link(r)}" for r in ms[:6]], "", "## All notes", *[f"- {link(r)}" for r in ms], ""]
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text("\n".join(body), encoding="utf-8")
            done.append(f"created {act['path']} ({len(ms)} notes)")
        elif op == "bridge":
            if act["name_a"] == act["name_b"]:
                done.append(f"skipped bridge {act['name_a']} ↔ itself")
                continue
            name = f"Bridge — {act['name_a']} ↔ {act['name_b']}"
            p = vl.VAULT / "00-Inbox" / (re.sub(r'[\\/:*?"<>|#^\[\]]', "", name) + ".md")
            if p.exists():
                done.append(f"skipped {vl.rel(p)} (exists)")
                continue
            mocs = [f'  - "[[{Path(x).stem}]]"' for x in (act["moc_a"], act["moc_b"]) if x]
            body = ["---", f"created: {TODAY}", "type: bridge", *(["bridges:", *mocs] if mocs else []), "---", "", f"# {name}", "",
                    "> Drafted from the MOC alignment report. These topics come up together in your dailies but barely link. "
                    "Fill this in, then link it from both MOCs.", "",
                    f"## {act['name_a']}", *[f"- {link(r)}" for r in act["core_a"]], "",
                    f"## {act['name_b']}", *[f"- {link(r)}" for r in act["core_b"]], ""]
            if act["suggest"]:
                body += ["## Where they already meet", *[f"- {link(x)} ↔ {link(y)}" for x, y in act["suggest"]], ""]
            body += ["## Questions", f"- How does {act['name_a']} depend on {act['name_b']}, or the other way round?",
                     "- Which decisions in one changed the other?", "- Is there a process or person that already connects them?", "", "## Notes", ""]
            p.write_text("\n".join(body), encoding="utf-8")
            done.append(f"drafted {vl.rel(p)}")
    for moc, notes in adds.items():
        p = vl.VAULT / moc
        current = vl.read_text(p)
        fresh = [r for i, r in enumerate(notes) if r not in notes[:i] and not _linked_in(current, r)]
        already += len(notes) - len(fresh)
        if not fresh:
            continue
        _snapshot(p, trash)
        p.write_text(_append_section(current, f"## Also in this topic (added {TODAY})", [f"- {link(r)}" for r in fresh]),
                     encoding="utf-8", newline="")
        done.append(f"added {len(fresh)} notes to {moc}")
    print("\n".join(done) or "nothing new to apply")
    print(f"({skipped} unticked rows left alone; {already} ticked rows were already done; originals in {vl.rel(trash)})")
    return 0


_CACHE = None


SUPERSEDED = "> [!warning] Superseded by [[{new}]]"


def supersede_older(new: Path) -> list[str]:
    """Clustering changes from run to run, so an older report's rows go stale (on 2026-10-19 all four "create"
    rows of the previous report were skipped because their topics had changed). Point older reports at the new one;
    only a callout under the frontmatter is added."""
    marked = []
    for old in sorted((vl.VAULT / vl.FOLDERS["reports"]).glob("MOC Alignment *.md")):
        if old == new:
            continue
        text = vl.read_text(old)
        if "Superseded by [[" in text:
            continue
        m = vg.FRONTMATTER_RE.match(text)
        callout = (SUPERSEDED.format(new=new.stem) + f" ({TODAY})\n> Topics were re-clustered since this report. Ticked rows here were "
                   "applied or skipped already; tick in the new report instead.\n\n")
        old.write_text((text[:m.end()] + callout + text[m.end():]) if m else callout + text, encoding="utf-8", newline="")
        marked.append(vl.rel(old))
    return marked


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    if "-h" in sys.argv or "--help" in sys.argv:
        print("moc_align.py              write _System/Reports/MOC Alignment <date>.md (older reports are marked superseded)\n"
              "moc_align.py --apply FILE apply only the ticked rows of a report")
        return 0
    if "--apply" in sys.argv:
        return apply(sys.argv[sys.argv.index("--apply") + 1])
    out = vl.VAULT / vl.FOLDERS["reports"] / f"MOC Alignment {TODAY}.md"
    out.parent.mkdir(parents=True, exist_ok=True)
    if out.exists() and re.search(r"^\s*- \[[xX\-]\]", vl.read_text(out), re.M):
        out = out.with_name(f"MOC Alignment {TODAY} {datetime.now():%H%M}.md")
    out.write_text(report(), encoding="utf-8")
    print(f"Wrote {vl.rel(out)}")
    for r in supersede_older(out):
        print(f"Marked superseded: {r}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


def graph_mocs(a: dict) -> dict:
    """For vault_graph.graph_data: MOCs with the clusters they map, their members and what they miss,
    plus bridge notes (`type: bridge`) and the MOCs they connect."""
    a, raw, cluster_of, bc, sizes, members_of, mocs, owner, claim, knowledge = collect(a)
    out = []
    for m in mocs:
        cl = claim.get(m["path"], [])
        if not cl and not m["nav"]:
            continue
        out.append({"id": m["path"], "title": m["title"], "nav": m["nav"] and not cl, "clusters": cl,   # a wide map that claims a topic is that topic's map
                    "members": sorted(x for x in m["members"] if x in knowledge),
                    "missing": {str(c): sorted(set(members_of[c]) - m["members"], key=lambda r: (-bc.get(r, 0), r)) for c in cl}})
    bridges = {}
    by_stem = {Path(m["path"]).stem.lower(): m["path"] for m in mocs}
    for r in knowledge:
        fm = frontmatter(raw.get(r, ""))
        if str(fm.get("type", "")).lower() == "bridge":
            targets = [re.sub(r"^\[\[|\]\]$|\|.*$", "", str(x)).split("/")[-1].lower() for x in (fm.get("bridges") or [])]
            bridges[r] = [by_stem[x] for x in targets if x in by_stem]
    labels = {}
    for c, m in owner.items():
        if len(claim[m["path"]]) == 1:
            labels[c] = m["title"]
            continue
        # one map, several topics: tell them apart by the topic's own name, or by a keyword when the name repeats the title
        cl = next(x for x in a["clusters"] if x["id"] == c)
        own, title_words = cl["name"].split(" · ")[0], set(re.findall(r"\w+", m["title"].lower()))
        words = (cl.get("keywords") or cl["name"]).split(" · ")
        tag = own if not set(re.findall(r"\w+", own.lower())) & title_words else next((w for w in words if w.lower() not in title_words), words[0])
        labels[c] = f'{m["title"]} · {tag}'
    return {"mocs": out, "bridges": bridges, "labels": labels}
