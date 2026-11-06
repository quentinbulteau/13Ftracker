"""API HTTP + service du front."""
import hashlib
import logging
import threading
from collections import defaultdict

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

from . import db, photos, scheduler
from .config import DISABLE_SCHEDULER, FRONTEND_DIR
from .investors import BY_ID, INVESTORS

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
app = FastAPI(title="13F Tracker")

SOURCE_INFO = {
    "13F": {"label": "13F", "delay": "trimestriel, publié ≤45 j après la fin du trimestre"},
    "FORM4": {"label": "Form 4", "delay": "publié ≤2 jours ouvrés après l'opération"},
    "HOUSE": {"label": "STOCK Act", "delay": "publié ≤45 j après l'opération (montants par tranches)"},
}


@app.on_event("startup")
def _startup():
    if not DISABLE_SCHEDULER:
        scheduler.start()


def _summary(inv):
    i = inv["id"]
    period = db.one("SELECT MAX(period) p FROM holdings WHERE investor_id=?", (i,))["p"]
    agg = db.one("SELECT SUM(value) v, COUNT(*) n FROM holdings WHERE investor_id=? AND period=?", (i, period)) if period else {}
    last = db.one("SELECT MAX(filed_at) f FROM filings WHERE investor_id=? AND (source!='FORM4' OR accession IN "
                  "(SELECT substr(uid,4,20) FROM trades WHERE investor_id=? AND source='FORM4'))", (i, i))
    last_trade = db.one("SELECT MAX(filed_at) f FROM trades WHERE investor_id=?", (i,))
    n_trades = db.one("SELECT COUNT(*) n FROM trades WHERE investor_id=?", (i,))["n"]
    return {
        "id": i, "name": inv["name"], "subtitle": inv.get("subtitle"), "kind": inv["kind"], "cik": inv.get("cik"),
        "photo": f"/api/photo/{i}",
        "period": period, "portfolio_value": (agg or {}).get("v"), "positions": (agg or {}).get("n") or 0,
        "last_filing": max(filter(None, [last["f"], last_trade["f"]]), default=None), "trade_count": n_trades,
    }


@app.get("/api/investors")
def investors(kind: str | None = None):
    return [_summary(i) for i in INVESTORS if not kind or i["kind"] == kind]


def _inv(inv_id):
    inv = BY_ID.get(inv_id)
    if not inv:
        raise HTTPException(404, "investisseur inconnu")
    return inv


@app.get("/api/investors/{inv_id}")
def investor(inv_id: str):
    inv = _inv(inv_id)
    s = _summary(inv)
    s["sources"] = [SOURCE_INFO[r["source"]] | {"source": r["source"]} for r in
                    db.query("SELECT DISTINCT source FROM filings WHERE investor_id=?", (inv_id,))]
    s["unparsed"] = db.query("""SELECT f.url, f.filed_at FROM house_docs h JOIN filings f ON f.accession='HOUSE-'||h.doc_id
                               WHERE h.investor_id=? AND h.status!='ok' ORDER BY f.filed_at DESC""", (inv_id,))
    s["sec_url"] = f"https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK={inv['cik']}" if inv.get("cik") else None
    return s


@app.get("/api/investors/{inv_id}/trades")
def trades(inv_id: str, limit: int = 300, source: str | None = None):
    _inv(inv_id)
    sql = "SELECT * FROM trades WHERE investor_id=?"
    params = [inv_id]
    if source:
        sql += " AND source=?"
        params.append(source)
    sql += " ORDER BY trade_date DESC, filed_at DESC LIMIT ?"
    return db.query(sql, (*params, limit))


@app.get("/api/investors/{inv_id}/portfolio")
def portfolio(inv_id: str):
    inv = _inv(inv_id)
    if inv["kind"] == "politician":
        return _estimated_portfolio(inv_id)
    periods = [r["period"] for r in db.query(
        "SELECT DISTINCT period FROM holdings WHERE investor_id=? ORDER BY period DESC LIMIT 2", (inv_id,))]
    if not periods:
        return {"type": "13F", "period": None, "positions": []}
    cur = db.query("SELECT * FROM holdings WHERE investor_id=? AND period=? ORDER BY value DESC", (inv_id, periods[0]))
    prev = {(r["cusip"], r["put_call"]): r for r in db.query(
        "SELECT * FROM holdings WHERE investor_id=? AND period=?", (inv_id, periods[1]))} if len(periods) > 1 else {}
    total = sum(r["value"] or 0 for r in cur) or 1
    # Form 4 publiés après la fin du trimestre: position plus récente que le 13F
    f4 = {}
    for r in db.query("""SELECT ticker, shares_after, trade_date, action FROM trades WHERE investor_id=? AND source='FORM4'
                         AND trade_date>? ORDER BY trade_date ASC, filed_at ASC""", (inv_id, periods[0])):
        f4[r["ticker"]] = r
    out = []
    for r in cur:
        p = prev.get((r["cusip"], r["put_call"]))
        out.append({
            "ticker": r["ticker"], "issuer": r["issuer"], "title": r["title"], "cusip": r["cusip"], "put_call": r["put_call"] or None,
            "shares": r["shares"], "value": r["value"], "weight": (r["value"] or 0) / total * 100,
            "prev_shares": p["shares"] if p else None,
            "change": "NEW" if (prev and not p) else (None if not p else
                       "ADD" if r["shares"] > p["shares"] else "REDUCE" if r["shares"] < p["shares"] else None),
            "after_13f": f4.get(r["ticker"]) if r["ticker"] else None,
        })
    return {"type": "13F", "period": periods[0], "prev_period": periods[1] if len(periods) > 1 else None,
            "total_value": total, "positions": out}


def _estimated_portfolio(inv_id):
    """Les élus ne publient pas de portefeuille en continu: estimation à partir des transactions."""
    rows = db.query("SELECT * FROM trades WHERE investor_id=? ORDER BY trade_date ASC, uid ASC", (inv_id,))
    pos = defaultdict(lambda: {"low": 0.0, "high": 0.0, "buys": 0, "sells": 0, "closed": False})
    for r in rows:
        key = r["ticker"] or r["issuer"]
        p = pos[key]
        p.update(ticker=r["ticker"], issuer=r["issuer"], asset_type=r["asset_type"], last_date=r["trade_date"], last_action=r["action"])
        if r["action"] == "BUY":
            p["buys"] += 1
            p["low"] += r["value_low"] or 0
            p["high"] += r["value_high"] or r["value_low"] or 0
            p["closed"] = False
        elif r["action"] == "SELL":
            p["sells"] += 1
            if "partielle" not in (r["details"] or ""):
                p["closed"], p["low"], p["high"] = True, 0.0, 0.0
    out = [dict(v, key=k) for k, v in pos.items() if not v["closed"]]
    out.sort(key=lambda x: (-x["high"], x["key"]))
    return {"type": "ESTIMATED", "positions": out,
            "note": "Estimation à partir des transactions déclarées (STOCK Act) depuis le début du suivi : "
                    "les élus ne publient pas leur portefeuille en continu, et les montants sont des tranches."}


@app.get("/api/feed")
def feed(limit: int = 60, kind: str | None = None):
    ids = [i["id"] for i in INVESTORS if not kind or i["kind"] == kind]
    rows = db.query(f"""SELECT * FROM trades WHERE investor_id IN ({','.join('?' * len(ids))})
                        ORDER BY filed_at DESC, trade_date DESC LIMIT ?""", (*ids, limit))
    for r in rows:
        inv = BY_ID[r["investor_id"]]
        r["investor_name"], r["investor_kind"] = inv["name"], inv["kind"]
    return rows


@app.get("/api/search")
def search(q: str):
    ql = q.strip().lower()
    if not ql:
        return {"investors": [], "ticker": None}
    invs = [_summary(i) for i in INVESTORS if ql in i["name"].lower() or ql in (i.get("subtitle") or "").lower()]
    t = q.strip().upper()
    holders = db.query("""SELECT h.investor_id, h.issuer, h.shares, h.value, h.period FROM holdings h
                          JOIN (SELECT investor_id, MAX(period) p FROM holdings GROUP BY investor_id) m
                          ON m.investor_id=h.investor_id AND m.p=h.period
                          WHERE h.ticker=? AND h.put_call='' ORDER BY h.value DESC""", (t,))
    traders = db.query("SELECT * FROM trades WHERE ticker=? ORDER BY filed_at DESC LIMIT 50", (t,))
    for r in holders + traders:
        r["investor_name"], r["investor_kind"] = BY_ID[r["investor_id"]]["name"], BY_ID[r["investor_id"]]["kind"]
    return {"investors": invs, "ticker": t if (holders or traders) else None, "holders": holders, "trades": traders}


@app.get("/api/photo/{inv_id}")
def photo(inv_id: str):
    inv = _inv(inv_id)
    p = photos.cached(inv_id)
    if p:
        return FileResponse(p, headers={"Cache-Control": "public, max-age=86400"})
    threading.Thread(target=photos.fetch, args=(inv,), daemon=True).start()
    initials = "".join(w[0] for w in inv["name"].split()[:2]).upper()
    hue = int(hashlib.md5(inv_id.encode()).hexdigest()[:2], 16) * 360 // 256
    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 400">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl({hue},45%,32%)"/>
<stop offset="1" stop-color="hsl({(hue + 40) % 360},50%,14%)"/></linearGradient></defs>
<rect width="300" height="400" fill="url(#g)"/>
<text x="150" y="215" font-family="Inter,Arial,sans-serif" font-size="110" font-weight="700" fill="rgba(255,255,255,.85)" text-anchor="middle">{initials}</text></svg>"""
    return Response(svg, media_type="image/svg+xml", headers={"Cache-Control": "no-cache"})


@app.get("/api/status")
def status():
    return {k: db.get_meta(k) for k in ("last_live_poll", "last_house_refresh", "last_full_refresh")} | {
        "trades": db.one("SELECT COUNT(*) n FROM trades")["n"], "filings": db.one("SELECT COUNT(*) n FROM filings")["n"]}


@app.post("/api/refresh/{inv_id}")
def refresh(inv_id: str):
    _inv(inv_id)
    threading.Thread(target=scheduler.refresh_one, args=(inv_id,), daemon=True).start()
    return {"ok": True}


app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="front")
