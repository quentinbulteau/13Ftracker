"""Médias détenus par les milliardaires français.

Source : « Médias français, qui possède quoi ? » (Le Monde diplomatique & Acrimed), licence ODC-By.
On parcourt le graphe de propriété personne -> sociétés -> médias pour reconstituer la chaîne de détention.
"""
import csv
import io
import logging
import time
from functools import lru_cache
from pathlib import Path

from . import http
from .config import DATA_DIR

log = logging.getLogger("media")
RAW = "https://raw.githubusercontent.com/mdiplo/Medias_francais/master/{}"
VENDORED = Path(__file__).resolve().parents[1] / "data" / "mdiplo"
CACHE = DATA_DIR / "mdiplo"
FILES = ["medias.tsv", "personne-organisation.tsv", "organisation-organisation.tsv",
         "personne-media.tsv", "organisation-media.tsv"]
SOURCE = {"title": "Le Monde diplomatique & Acrimed — « Médias français, qui possède quoi ? » (licence ODC-By)",
          "url": "https://github.com/mdiplo/Medias_francais"}


def refresh():
    """Télécharge la dernière version (au plus une fois par jour)."""
    CACHE.mkdir(exist_ok=True)
    stamp = CACHE / ".fetched"
    if stamp.exists() and time.time() - stamp.stat().st_mtime < 86400:
        return
    try:
        for f in FILES:
            r = http.get(RAW.format(f), timeout=30, retries=1)
            if r.status_code == 200 and "\t" in r.text:
                (CACHE / f).write_text(r.text, encoding="utf-8")
        stamp.touch()
        _graph.cache_clear()
    except Exception as e:
        log.warning("mdiplo: %s", e)


def _read(name):
    p = CACHE / name if (CACHE / name).exists() else VENDORED / name
    return list(csv.DictReader(io.StringIO(p.read_text(encoding="utf-8")), delimiter="\t"))


@lru_cache(maxsize=1)
def _graph():
    medias = {r["Nom"]: r for r in _read("medias.tsv")}
    edges = {}
    for f in FILES[1:]:
        for r in _read(f):
            edges.setdefault(r["origine"].strip(), []).append(
                (r["cible"].strip(), r.get("qualificatif", "").strip(), r.get("valeur", "").strip()))
    return medias, edges


def _link(q, v):
    return v.replace(".00", "") if v else ("contrôle" if q == "contrôle" else q or "participation")


def held_by(person):
    """Liste des médias atteints depuis une personne, avec la chaîne de détention."""
    if not person:
        return []
    medias, edges = _graph()
    out, seen = {}, {person}
    stack = [(person, [])]
    while stack:
        node, path = stack.pop(0)  # parcours en largeur : chaîne la plus courte
        for target, q, v in edges.get(node, []):
            step = {"from": node, "to": target, "share": _link(q, v)}
            if target in medias:
                m = medias[target]
                if m.get("Disparu"):
                    continue
                if target not in out or len(path) + 1 < len(out[target]["path"]):
                    out[target] = {"media": target, "type": (m.get("Type") or "").strip(), "path": path + [step]}
            elif target not in seen:
                seen.add(target)
                stack.append((target, path + [step]))
    return sorted(out.values(), key=lambda x: (len(x["path"]), x["type"], x["media"]))
