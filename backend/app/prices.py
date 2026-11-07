"""Cours de bourse (Yahoo Finance, endpoint public non officiel), mis en cache en base.

Sert à calculer l'évolution du cours depuis la publication d'une déclaration :
  référence = dernière clôture AVANT la publication (heure de New York) : un dépôt publié à 22h
              se compare à la clôture du jour même, un dépôt publié à 11h à celle de la veille
  actuel    = dernier cours connu
"""
import logging
import queue
import threading
import time
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

NY = ZoneInfo("America/New_York")

from . import db, http

log = logging.getLogger("prices")
STALE_SECONDS = 15 * 60
BACKGROUND = True  # False pendant l'export statique: les cours sont rafraîchis de façon synchrone

db.execute("""CREATE TABLE IF NOT EXISTS prices (
    ticker TEXT NOT NULL, date TEXT NOT NULL, close REAL, PRIMARY KEY (ticker, date))""")
db.execute("""CREATE TABLE IF NOT EXISTS price_meta (
    ticker TEXT PRIMARY KEY, last_price REAL, last_time TEXT, fetched_at REAL, ok INTEGER)""")

_queue = queue.PriorityQueue()  # 0 = demandé par l'écran, 1 = préchauffage
_queued = {}
_qlock = threading.Lock()


def _yahoo_symbol(ticker):
    return ticker.replace(".", "-").replace("/", "-")


def fetch(ticker):
    """Télécharge 2 ans de clôtures quotidiennes + le dernier cours."""
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{_yahoo_symbol(ticker)}?range=2y&interval=1d"
    ok, last, last_time = 0, None, None
    try:
        r = http.get(url, headers={"User-Agent": "Mozilla/5.0 (13Ftracker)"}, retries=2)
        if r.status_code == 200:
            res = (r.json().get("chart", {}).get("result") or [None])[0]
            if res and res.get("timestamp"):
                closes = res["indicators"]["quote"][0].get("close") or []
                rows = [(ticker, datetime.fromtimestamp(ts, timezone.utc).date().isoformat(), c)
                        for ts, c in zip(res["timestamp"], closes) if c is not None]
                meta = res.get("meta", {})
                last = meta.get("regularMarketPrice") or (rows[-1][2] if rows else None)
                if meta.get("regularMarketTime"):
                    last_time = datetime.fromtimestamp(meta["regularMarketTime"], timezone.utc).isoformat()
                with db.tx() as con:
                    con.executemany("INSERT OR REPLACE INTO prices VALUES (?,?,?)", rows)
                ok = 1
    except Exception as e:
        log.warning("cours %s: %s", ticker, e)
    db.execute("INSERT OR REPLACE INTO price_meta VALUES (?,?,?,?,?)", (ticker, last, last_time, time.time(), ok))


def _worker():
    while True:
        prio, t = _queue.get()
        with _qlock:
            if _queued.get(t, 9) < prio:  # déjà repris avec une priorité plus haute
                continue
        try:
            fetch(t)
        finally:
            with _qlock:
                _queued.pop(t, None)


def request(tickers, max_age=STALE_SECONDS, prio=0):
    """Met en file les tickers absents du cache ou trop anciens (non bloquant)."""
    tickers = {t for t in tickers if t}
    if not tickers or not BACKGROUND:
        return
    fresh = {r["ticker"] for r in db.query(
        f"SELECT ticker FROM price_meta WHERE ticker IN ({','.join('?' * len(tickers))}) AND fetched_at > ?",
        (*tickers, time.time() - max_age))}
    with _qlock:
        for t in tickers - fresh:
            if _queued.get(t, 9) > prio:
                _queued[t] = prio
                _queue.put((prio, t))


def stale(tickers, max_age):
    tickers = {t for t in tickers if t}
    if not tickers:
        return []
    fresh = {r["ticker"] for r in db.query(
        f"SELECT ticker FROM price_meta WHERE ticker IN ({','.join('?' * len(tickers))}) AND fetched_at > ?",
        (*tickers, time.time() - max_age))}
    return sorted(tickers - fresh)


def warm_all():
    """Préchauffe le cache pour tous les tickers des transactions de l'an dernier."""
    rows = db.query("SELECT DISTINCT ticker FROM trades WHERE ticker IS NOT NULL AND filed_at >= date('now','-400 days')")
    request([r["ticker"] for r in rows], max_age=6 * 3600, prio=1)


def _ref_bound(filed):
    """(opérateur, date) de la dernière clôture connue avant publication."""
    if not filed:
        return None
    if len(filed) <= 10:  # date seule (élus): clôture du jour de dépôt
        return ("<=", filed[:10])
    try:
        ny = datetime.fromisoformat(filed.replace("Z", "+00:00")).astimezone(NY)
    except ValueError:
        return ("<=", filed[:10])
    return ("<=", ny.date().isoformat()) if ny.hour >= 16 else ("<", ny.date().isoformat())


def enrich(rows, date_key="filed_at"):
    """Ajoute price_ref / price_now / perf_pct (évolution depuis le dépôt) aux lignes."""
    tickers = {r.get("ticker") for r in rows if r.get("ticker")}
    if not tickers:
        return rows
    request(tickers)
    ph = ",".join("?" * len(tickers))
    last = {r["ticker"]: r["last_price"] for r in db.query(
        f"SELECT ticker, last_price FROM price_meta WHERE ok=1 AND ticker IN ({ph})", tuple(tickers))}
    for r in rows:
        t, d = r.get("ticker"), _ref_bound(r.get(date_key))
        if not t or not d or t not in last:
            continue
        ref = db.one(f"SELECT date, close FROM prices WHERE ticker=? AND date{d[0]}? ORDER BY date DESC LIMIT 1", (t, d[1]))
        if ref and ref["close"] and last[t]:
            r["price_ref"], r["price_ref_date"], r["price_now"] = ref["close"], ref["date"], last[t]
            r["perf_pct"] = (last[t] / ref["close"] - 1) * 100
    return rows


for _ in range(2):
    threading.Thread(target=_worker, daemon=True, name="prices").start()
