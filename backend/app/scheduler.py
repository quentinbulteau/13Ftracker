"""Boucles de scraping en arrière-plan.

- Flux EDGAR "temps réel" (toutes les 60 s): détecte un nouveau 13F ou Form 4 d'un
  investisseur suivi quelques minutes après sa publication et le traite aussitôt.
- Index de la Chambre (toutes les 15 min): nouveaux PTR des élus suivis.
- Rafraîchissement complet périodique (filet de sécurité).
"""
import logging
import threading
import time
from datetime import datetime, timezone

from . import amf, db, house, insiders, media, photos, press, prices, sec
from .config import FULL_REFRESH_INTERVAL, HOUSE_INTERVAL, LIVE_FEED_INTERVAL
from .investors import BY_ID, INVESTORS

log = logging.getLogger("scheduler")
_busy = threading.Lock()


def _now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def refresh_one(inv_id):
    inv = BY_ID[inv_id]
    try:
        photos.fetch(inv)
        if inv.get("cik"):
            sec.refresh_investor(inv)
    except Exception:
        log.exception("refresh %s", inv_id)


def full_refresh():
    with _busy:
        log.info("rafraîchissement complet…")
        sec.normalize_thousands()
        for inv in INVESTORS:
            refresh_one(inv["id"])
        for name, fn in (("house", house.refresh), ("amf", amf.refresh), ("initiés", insiders.refresh), ("presse", press.refresh),
                         ("médias", media.refresh)):
            try:
                fn()
            except Exception:
                log.exception(name)
        prices.warm_all()
        db.set_meta("last_full_refresh", _now())
        db.set_meta("last_house_refresh", _now())
        log.info("rafraîchissement complet terminé")


def _loop(fn, interval, name):
    while True:
        time.sleep(interval)
        try:
            fn()
        except Exception:
            log.exception(name)


def _live():
    hits = sec.poll_live_feed()
    db.set_meta("last_live_poll", _now())
    for inv_id in hits:
        log.info("nouveau dépôt EDGAR détecté pour %s", inv_id)
        refresh_one(inv_id)


def _house():
    n = house.refresh()
    db.set_meta("last_house_refresh", _now())
    if n:
        log.info("%d nouvelles transactions d'élus", n)


def _fr_and_press():
    amf.refresh()
    insiders.refresh()
    press.refresh()


def start():
    threading.Thread(target=full_refresh, daemon=True, name="initial").start()
    threading.Thread(target=_loop, args=(_live, LIVE_FEED_INTERVAL, "live"), daemon=True, name="live").start()
    threading.Thread(target=_loop, args=(_house, HOUSE_INTERVAL, "house"), daemon=True, name="house").start()
    threading.Thread(target=_loop, args=(_fr_and_press, HOUSE_INTERVAL, "amf+presse"), daemon=True, name="amf").start()
    threading.Thread(target=_loop, args=(full_refresh, FULL_REFRESH_INTERVAL, "full"), daemon=True, name="full").start()
