"""Classement des gérants sur 3, 6 et 12 mois, d'après leurs 13F.

Méthode (celle des sites de suivi de 13F) :
  - à chaque fin de trimestre, on prend les positions déclarées (les 60 plus grosses, pondérées par leur valeur) ;
  - on les conserve jusqu'au trimestre suivant et on calcule la performance avec les cours quotidiens ;
  - les périodes sont chaînées.
Deux mesures :
  - « portefeuille déclaré » : rebalancement à la fin du trimestre (le talent du gérant) ;
  - « copie » : rebalancement à la date de PUBLICATION du 13F (≤ 45 jours plus tard) : ce qu'un suiveur obtient vraiment.
Limites : ni positions vendues à découvert, ni options, ni cash, ni achats/ventes en cours de trimestre ; actions US uniquement.
"""
import bisect
import logging
from datetime import date, timedelta

from . import db
from .investors import ENTITIES

log = logging.getLogger("ranking")
TOP = 60
PERIODS = 6
WINDOWS = {"3": 91, "6": 182, "12": 365}
BENCH = "SPY"

_cache = {}


def _series(ticker):
    if ticker not in _cache:
        rows = db.query("SELECT date, close FROM prices WHERE ticker=? AND close IS NOT NULL ORDER BY date", (ticker,))
        _cache[ticker] = ([r["date"] for r in rows], [r["close"] for r in rows])
    return _cache[ticker]


def _price(ticker, d):
    dates, closes = _series(ticker)
    i = bisect.bisect_right(dates, d) - 1
    if i < 0 or (date.fromisoformat(d) - date.fromisoformat(dates[i])).days > 10:
        return None
    return closes[i]


def funds():
    return [e for e in ENTITIES if e["kind"] == "fund" and not e.get("inactive")]


def _portfolios(inv_id):
    """[(fin de trimestre, date de publication, [(ticker, valeur)], valeur totale)] du plus ancien au plus récent."""
    filed = {r["period"]: (r["f"] or "")[:10] for r in db.query(
        "SELECT period, MIN(filed_at) f FROM filings WHERE investor_id=? AND source='13F' GROUP BY period", (inv_id,))}
    out = []
    for p in sorted(r["period"] for r in db.query("SELECT DISTINCT period FROM holdings WHERE investor_id=?", (inv_id,)))[-PERIODS:]:
        total = db.one("SELECT SUM(value) v FROM holdings WHERE investor_id=? AND period=?", (inv_id, p))["v"] or 0
        top = db.query("""SELECT ticker, SUM(value) v FROM holdings WHERE investor_id=? AND period=? AND put_call='' AND ticker IS NOT NULL
                          GROUP BY ticker ORDER BY v DESC LIMIT ?""", (inv_id, p, TOP))
        out.append((p, filed.get(p) or p, [(r["ticker"], r["v"]) for r in top if r["v"]], total))
    return out


def needed_tickers():
    t = {BENCH}
    for inv in funds():
        for _, _, top, _ in _portfolios(inv["id"]):
            t |= {x for x, _ in top}
    return t


def _index(rebals, days):
    """rebals: [(date, [(ticker, valeur)])] ; renvoie [(jour, indice)] à partir du premier jour couvert."""
    out, idx, active, weights, base, covered = [], 1.0, None, {}, {}, []
    for d in days:
        pick = None
        for r in rebals:
            if r[0] <= d:
                pick = r
        if pick is None:
            continue
        if pick is not active:
            if active is not None:
                idx *= sum(w * (_price(t, d) or base[t]) / base[t] for t, w in weights.items())
            priced = [(t, v) for t, v in pick[1] if _price(t, d)]
            tot = sum(v for _, v in priced)
            if not tot:
                continue
            weights = {t: v / tot for t, v in priced}
            base = {t: _price(t, d) for t in weights}
            covered.append(tot / (sum(v for _, v in pick[1]) or tot))
            active = pick
        out.append((d, idx * sum(w * (_price(t, d) or base[t]) / base[t] for t, w in weights.items())))
    return out, (min(covered) if covered else 0)


def _rebase(series, start):
    s = [(d, v) for d, v in series if d >= start]
    if not s:
        return []
    v0 = s[0][1]
    return [(d, v / v0) for d, v in s]


def _thin(series, n=60):
    if len(series) <= n:
        return series
    step = len(series) / n
    keep = [series[int(i * step)] for i in range(n)]
    return keep + [series[-1]]


def compute():
    _cache.clear()
    bench_dates, _ = _series(BENCH)
    if not bench_dates:
        log.warning("cours du S&P 500 (SPY) absents : classement impossible")
        return {"windows": {}, "funds": {}}
    today = date.today()
    first_day = (today - timedelta(days=max(WINDOWS.values()) + 5)).isoformat()
    days = [d for d in bench_dates if d >= first_day]
    bench = [(d, _price(BENCH, d)) for d in days]
    result = {"windows": {}, "funds": {}, "method": __doc__.split("Méthode")[1].strip() if "Méthode" in __doc__ else ""}
    per_fund = {}
    for inv in funds():
        ports = _portfolios(inv["id"])
        if not ports:
            continue
        declared, cov1 = _index([(p, top) for p, _, top, _ in ports], days)
        copied, _ = _index([(f, top) for _, f, top, _ in ports], days)
        per_fund[inv["id"]] = (declared, copied, cov1)
        result["funds"][inv["id"]] = {
            "aum": [{"period": p, "value": total} for p, _, _, total in ports],
            "coverage": round(cov1 * 100),
        }
    for w, n in WINDOWS.items():
        start = next((d for d in days if d >= (today - timedelta(days=n)).isoformat()), None)
        if not start:
            continue
        b = _rebase(bench, start)
        bench_perf = (b[-1][1] - 1) * 100 if b else None
        rows = []
        for inv_id, (declared, copied, cov) in per_fund.items():
            if not declared or declared[0][0] > start:  # historique insuffisant pour cette période
                continue
            s, c = _rebase(declared, start), _rebase(copied, start)
            perf = (s[-1][1] - 1) * 100
            inv = next(e for e in ENTITIES if e["id"] == inv_id)
            rows.append({"id": inv_id, "name": inv["name"], "subtitle": inv["subtitle"], "perf": perf,
                         "perf_copy": (c[-1][1] - 1) * 100 if c and c[0][0] <= start else None,
                         "vs_bench": perf - bench_perf if bench_perf is not None else None,
                         "coverage": round(cov * 100), "series": [[d, round(v * 100, 2)] for d, v in _thin(s)]})
        rows.sort(key=lambda r: -r["perf"])
        for i, r in enumerate(rows, 1):
            r["rank"] = i
        result["windows"][w] = {"start": start, "end": days[-1], "bench": bench_perf,
                                "bench_series": [[d, round(v * 100, 2)] for d, v in _thin(b)], "rows": rows}
    return result
