"""Calendrier : prochaines échéances de dépôt des 13F et publications de résultats des actions suivies."""
import logging
import time
from datetime import date, timedelta

from . import db, http
from .investors import ENTITIES

log = logging.getLogger("calendar")
NASDAQ = "https://api.nasdaq.com/api/calendar/earnings?date={}"
DAYS_AHEAD = 21

db.execute("""CREATE TABLE IF NOT EXISTS earnings (date TEXT, symbol TEXT, name TEXT, time TEXT, eps_forecast TEXT,
              quarter TEXT, PRIMARY KEY (date, symbol))""")


def _quarter_end(d):
    q = (d.month - 1) // 3
    return date(d.year, 3 * q + 1, 1) - timedelta(days=1)  # dernier jour du trimestre précédent


def thirteen_f():
    """Échéance légale du 13F en cours : 45 jours après la fin du trimestre (jour ouvré suivant si week-end)."""
    today = date.today()
    q_end = _quarter_end(today)
    deadline = q_end + timedelta(days=45)
    while deadline.weekday() >= 5:
        deadline += timedelta(days=1)
    funds = [e for e in ENTITIES if e["kind"] == "fund" and not e.get("inactive")]
    filed = {r["investor_id"] for r in db.query("SELECT DISTINCT investor_id FROM holdings WHERE period=?", (q_end.isoformat(),))}
    return {"quarter_end": q_end.isoformat(), "deadline": deadline.isoformat(), "days_left": (deadline - today).days,
            "filed": [{"id": e["id"], "name": e["name"]} for e in funds if e["id"] in filed],
            "pending": [{"id": e["id"], "name": e["name"]} for e in funds if e["id"] not in filed]}


def universe():
    """Actions suivies : 20 premières lignes du dernier 13F de chaque gérant + actions des alertes d'initiés US."""
    tickers = {}
    for r in db.query("""SELECT h.ticker, h.investor_id FROM holdings h
                         JOIN (SELECT investor_id, MAX(period) p FROM holdings GROUP BY investor_id) m
                           ON m.investor_id=h.investor_id AND m.p=h.period
                         WHERE h.ticker IS NOT NULL AND h.put_call='' ORDER BY h.value DESC"""):
        lst = tickers.setdefault(r["ticker"], [])
        if len(lst) < 50:
            lst.append(r["investor_id"])
    top = {}
    for inv in {r["investor_id"] for r in db.query("SELECT DISTINCT investor_id FROM holdings")}:
        for r in db.query("""SELECT ticker FROM holdings WHERE investor_id=? AND period=(SELECT MAX(period) FROM holdings WHERE investor_id=?)
                             AND ticker IS NOT NULL AND put_call='' ORDER BY value DESC LIMIT 20""", (inv, inv)):
            top.setdefault(r["ticker"], set()).add(inv)
    for r in db.query("SELECT DISTINCT ticker FROM insider_trades WHERE market='US' AND ticker IS NOT NULL"):
        top.setdefault(r["ticker"], set())
    return {t: tickers.get(t, []) for t in top}


def refresh():
    """Relit le calendrier des résultats une fois par jour (une requête par jour à venir)."""
    if time.time() - float(db.get_meta("earnings_at", 0) or 0) < 20 * 3600:
        return
    rows = []
    for i in range(DAYS_AHEAD):
        d = date.today() + timedelta(days=i)
        if d.weekday() >= 5:
            continue
        try:
            r = http.get(NASDAQ.format(d.isoformat()), headers={"User-Agent": "Mozilla/5.0 (13Ftracker)", "Accept": "application/json"},
                         timeout=30, retries=1)
            for x in ((r.json().get("data") or {}).get("rows") or []) if r.ok else []:
                rows.append((d.isoformat(), x.get("symbol"), x.get("name"), (x.get("time") or "").replace("time-", ""),
                             x.get("epsForecast"), x.get("fiscalQuarterEnding")))
        except Exception as e:
            log.warning("calendrier %s: %s", d, e)
    with db.tx() as con:
        con.execute("DELETE FROM earnings WHERE date < date('now')")
        con.executemany("INSERT OR REPLACE INTO earnings VALUES (?,?,?,?,?,?)", rows)
    db.set_meta("earnings_at", time.time())


def upcoming():
    uni = universe()
    if not uni:
        return []
    names = {e["id"]: e["name"] for e in ENTITIES}
    rows = db.query(f"SELECT * FROM earnings WHERE date >= date('now') AND symbol IN ({','.join('?' * len(uni))}) ORDER BY date, symbol",
                    tuple(uni))
    for r in rows:
        r["holders"] = [names.get(i, i) for i in uni.get(r["symbol"], [])][:6]
        r["n_holders"] = len(uni.get(r["symbol"], []))
    return rows


def get():
    return {"thirteen_f": thirteen_f(), "earnings": upcoming()}
