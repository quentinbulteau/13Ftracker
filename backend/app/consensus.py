"""Consensus des gérants : les actions les plus achetées et les plus vendues par l'ensemble des fonds suivis
au cours du dernier trimestre déclaré (13F). Seuls les fonds ayant déjà publié ce trimestre sont comptés."""
from collections import Counter

from . import db
from .investors import BY_ID, ENTITIES

BUY, SELL = ("NEW", "ADD"), ("REDUCE", "EXIT")


def compute(top=15):
    funds = [e["id"] for e in ENTITIES if e["kind"] == "fund" and not e.get("inactive")]
    latest = {r["investor_id"]: r["p"] for r in db.query(
        f"SELECT investor_id, MAX(period) p FROM holdings WHERE investor_id IN ({','.join('?' * len(funds))}) GROUP BY investor_id", tuple(funds))}
    if not latest:
        return {}
    quarter = Counter(latest.values()).most_common(1)[0][0]  # trimestre le plus récent publié par la majorité
    ids = [i for i, p in latest.items() if p == quarter]
    rows = db.query(f"""SELECT investor_id, ticker, issuer, action, value FROM trades WHERE source='13F' AND trade_date=?
                        AND investor_id IN ({','.join('?' * len(ids))}) AND ticker IS NOT NULL AND asset_type NOT IN ('PUT','CALL')""",
                    (quarter, *ids))
    agg = {}
    for r in rows:
        a = agg.setdefault(r["ticker"], {"ticker": r["ticker"], "issuer": r["issuer"], "buyers": [], "sellers": [], "new": 0,
                                         "exits": 0, "bought": 0.0, "sold": 0.0})
        name = BY_ID[r["investor_id"]]["name"]
        if r["action"] in BUY:
            a["buyers"].append(name)
            a["bought"] += r["value"] or 0
            a["new"] += r["action"] == "NEW"
        else:
            a["sellers"].append(name)
            a["sold"] += r["value"] or 0
            a["exits"] += r["action"] == "EXIT"
    items = list(agg.values())
    for a in items:
        a["n_buy"], a["n_sell"] = len(set(a["buyers"])), len(set(a["sellers"]))
        a["buyers"], a["sellers"] = sorted(set(a["buyers"])), sorted(set(a["sellers"]))
    bought = sorted([a for a in items if a["n_buy"] >= 2 and a["n_buy"] > a["n_sell"]], key=lambda a: (-a["n_buy"], -a["bought"]))[:top]
    sold = sorted([a for a in items if a["n_sell"] >= 2 and a["n_sell"] > a["n_buy"]], key=lambda a: (-a["n_sell"], -a["sold"]))[:top]
    return {"quarter": quarter, "funds": len(ids), "funds_total": len(funds), "bought": bought, "sold": sold}
