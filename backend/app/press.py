"""Presse & rumeurs (NON OFFICIEL).

- Articles récupérés automatiquement via Google News (RSS public) pour chaque entité suivie.
- Déclarations non réglementaires / rumeurs saisies à la main dans backend/data/curated.json, avec leurs sources.
- Rachats de startups (curated.json) avec les articles de presse associés, recherchés automatiquement.
Rien de tout cela n'est une déclaration officielle : l'interface le signale systématiquement.
"""
import hashlib
import json
import logging
import time
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.parse import quote

from lxml import etree

from . import db, http
from .investors import BY_ID, ENTITIES

log = logging.getLogger("press")
CURATED = Path(__file__).resolve().parents[1] / "data" / "curated.json"
RSS = "https://news.google.com/rss/search?q={q}&hl={hl}&gl={gl}&ceid={gl}:{hl}"
PER_QUERY = 12
MAX_AGE = 25 * 60

db.execute("""CREATE TABLE IF NOT EXISTS articles (
    uid TEXT PRIMARY KEY, entity_id TEXT, ref TEXT, title TEXT, source TEXT, url TEXT, published TEXT)""")
db.execute("CREATE INDEX IF NOT EXISTS ix_articles ON articles(entity_id, ref, published)")


def curated():
    return json.loads(CURATED.read_text(encoding="utf-8"))


def _fetch(query, lang):
    hl, gl = ("fr", "FR") if lang == "fr" else ("en-US", "US")
    r = http.get(RSS.format(q=quote(query + " when:180d"), hl=hl, gl=gl), timeout=30, retries=1)
    if r.status_code != 200:
        log.warning("Google News %s: HTTP %s", query, r.status_code)
        return []
    root = etree.fromstring(r.content)
    out = []
    for it in root.iter("item"):
        title = it.findtext("title") or ""
        source = it.findtext("source") or ""
        if source and title.endswith(f" - {source}"):
            title = title[: -len(source) - 3]
        try:
            pub = parsedate_to_datetime(it.findtext("pubDate")).isoformat()
        except Exception:
            pub = None
        out.append({"title": title, "source": source, "url": it.findtext("link"), "published": pub})
    out.sort(key=lambda a: a["published"] or "", reverse=True)
    return out[:PER_QUERY]


def _store(entity_id, ref, articles):
    with db.tx() as con:
        for a in articles:
            uid = hashlib.sha1(f"{entity_id}|{ref}|{a['url']}".encode()).hexdigest()
            con.execute("INSERT OR IGNORE INTO articles VALUES (?,?,?,?,?,?,?)",
                        (uid, entity_id, ref, a["title"], a["source"], a["url"], a["published"]))


def _due(key, max_age):
    last = float(db.get_meta(key, 0) or 0)
    return time.time() - last > max_age


def refresh():
    for e in ENTITIES:
        key = f"press:{e['id']}"
        if not _due(key, MAX_AGE):
            continue
        try:
            _store(e["id"], "", _fetch(e["press"], e.get("lang", "fr")))
            db.set_meta(key, time.time())
        except Exception as ex:
            log.warning("presse %s: %s", e["id"], ex)
    # articles associés à chaque rachat (rafraîchis une fois par jour)
    for a in curated()["acquisitions"]:
        key = f"press:acq:{a['id']}"
        if not _due(key, 86400):
            continue
        acq = BY_ID[a["acquirer"]]["name"]
        try:
            _store(a["acquirer"], a["id"], _fetch(f'"{acq}" "{a["target"]}"', "en")[:4]
                   + _fetch(f'"{acq}" "{a["target"]}"', "fr")[:2])
            db.set_meta(key, time.time())
        except Exception as ex:
            log.warning("presse rachat %s: %s", a["id"], ex)


def articles(entity_id, limit=30):
    return db.query("SELECT title, source, url, published FROM articles WHERE entity_id=? AND ref='' "
                    "ORDER BY published DESC LIMIT ?", (entity_id, limit))


def acquisitions(acquirer=None):
    rows = [dict(a) for a in curated()["acquisitions"] if not acquirer or a["acquirer"] == acquirer]
    for a in rows:
        a["acquirer_name"] = BY_ID[a["acquirer"]]["name"]
        a["articles"] = db.query("SELECT title, source, url, published FROM articles WHERE ref=? "
                                 "ORDER BY published DESC LIMIT 4", (a["id"],))
    rows.sort(key=lambda a: a["date"], reverse=True)
    return rows


def unofficial(entity_id=None):
    c = curated()
    rows = [dict(u, kind="claim") for u in c["unofficial"] if not entity_id or u["entity"] == entity_id]
    rows += [dict(m, kind="media_deal") for m in c["media_deals"] if not entity_id or m["entity"] == entity_id]
    for r in rows:
        r["entity_name"] = BY_ID[r["entity"]]["name"]
        r["entity_type"] = BY_ID[r["entity"]]["type"]
    rows.sort(key=lambda r: r["date"], reverse=True)
    return rows


def latest(entity_type=None, limit=40):
    """Derniers articles toutes entités confondues (pour l'accueil et le flux « Presse & rumeurs »)."""
    ids = [e["id"] for e in ENTITIES if not entity_type or e["type"] == entity_type]
    rows = db.query(f"""SELECT entity_id, title, source, url, published FROM articles WHERE ref='' AND entity_id IN
                        ({','.join('?' * len(ids))}) ORDER BY published DESC LIMIT ?""", (*ids, limit))
    for r in rows:
        r["entity_name"] = BY_ID[r["entity_id"]]["name"]
        r["entity_type"] = BY_ID[r["entity_id"]]["type"]
    return rows
