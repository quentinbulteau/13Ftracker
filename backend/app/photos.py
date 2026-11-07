"""Photos des investisseurs: Wikipédia / Wikimedia Commons, mises en cache sur disque."""
import hashlib
import logging
from urllib.parse import quote

from . import http
from .config import PHOTO_DIR

log = logging.getLogger("photos")
_EXTS = (".jpg", ".png", ".webp")


def cached(inv_id):
    for ext in _EXTS:
        p = PHOTO_DIR / f"{inv_id}{ext}"
        if p.exists() and p.stat().st_size > 0:
            return p
    return None


def initials_svg(inv):
    """Avatar de remplacement (initiales sur dégradé) quand aucune photo libre n'existe."""
    initials = "".join(w[0] for w in inv["name"].split()[:2]).upper()
    hue = int(hashlib.md5(inv["id"].encode()).hexdigest()[:2], 16) * 360 // 256
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 400">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl({hue},45%,32%)"/>
<stop offset="1" stop-color="hsl({(hue + 40) % 360},50%,14%)"/></linearGradient></defs>
<rect width="300" height="400" fill="url(#g)"/>
<text x="150" y="215" font-family="Inter,Arial,sans-serif" font-size="110" font-weight="700" fill="rgba(255,255,255,.85)" text-anchor="middle">{initials}</text></svg>"""


def _source_urls(inv):
    if inv.get("photo_file"):
        return [f"https://commons.wikimedia.org/wiki/Special:FilePath/{quote(inv['photo_file'])}?width=500"]
    if inv.get("wiki"):
        r = http.get(f"https://en.wikipedia.org/api/rest_v1/page/summary/{quote(inv['wiki'])}")
        if r.ok:
            j = r.json()
            img = j.get("thumbnail") or j.get("originalimage")
            if img:
                # vignette plus grande si disponible, sinon celle par défaut (330px)
                return [img["source"].replace("/330px-", "/500px-"), img["source"]]
    return []


def fetch(inv):
    """Télécharge la photo si absente. Retourne le chemin local ou None."""
    p = cached(inv["id"])
    if p:
        return p
    missing = PHOTO_DIR / f"{inv['id']}.none"
    if missing.exists():
        return None
    try:
        for url in _source_urls(inv):
            r = http.get(url, timeout=30, retries=1)
            ctype = r.headers.get("Content-Type", "")
            if r.ok and ctype.startswith("image/"):
                ext = ".png" if "png" in ctype else ".webp" if "webp" in ctype else ".jpg"
                path = PHOTO_DIR / f"{inv['id']}{ext}"
                path.write_bytes(r.content)
                return path
            if r.status_code == 429:
                return None  # limité: on réessaiera plus tard
        missing.touch()  # aucune photo libre: on affichera les initiales
    except Exception as e:
        log.warning("photo %s: %s", inv["id"], e)
    return None
