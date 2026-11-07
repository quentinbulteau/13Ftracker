"""Franchissements de seuil de 5 % : SEC Schedule 13D (investisseur actif) et 13G (passif).

Délai : 13D sous 5 jours ouvrés après le franchissement (10 jours avant 2024), 13G sous 45 jours (passif).
Plus rapide que le 13F, et c'est là qu'apparaissent les prises de contrôle (Icahn, Ackman, Elliott…).
Depuis décembre 2024 ces formulaires sont au format XML structuré ; les anciens (texte libre) sont ignorés.
"""
import logging
import re
from datetime import date, timedelta

from . import cusip, db, http, sec
from .investors import ENTITIES

log = logging.getLogger("stakes")
FORMS = ("SCHEDULE 13D", "SCHEDULE 13D/A", "SCHEDULE 13G", "SCHEDULE 13G/A")
LOOKBACK = 365
MAX_PER_FILER = 30


def _first(root, *tags):
    for t in tags:
        for el in root.iter(t):
            if el.text and el.text.strip():
                return el.text.strip()
    return None


def _max(root, *tags):
    vals = [sec._num(el.text) for t in tags for el in root.iter(t) if el.text]
    vals = [v for v in vals if v is not None]
    return max(vals) if vals else None


def _date(s):
    m = re.match(r"(\d{2})/(\d{2})/(\d{4})", s or "")
    return f"{m.group(3)}-{m.group(1)}-{m.group(2)}" if m else None


def refresh_investor(inv, subs=None):
    subs = subs or sec.submissions(inv["cik"])
    since = (date.today() - timedelta(days=LOOKBACK)).isoformat()
    cands = [f for f in subs if f["form"] in FORMS and f["filingDate"] >= since][:MAX_PER_FILER]
    new = 0
    for f in reversed(cands):  # du plus ancien au plus récent : on connaît le % précédent
        acc = f["accessionNumber"]
        if db.one("SELECT 1 FROM filings WHERE accession=? AND investor_id=?", (acc, inv["id"])):
            continue
        doc = re.sub(r"^xsl[^/]+/", "", f["primaryDocument"])
        url = f"{sec._acc_path(inv['cik'], acc)}/{acc}-index.htm"
        try:
            root = sec._xml(http.get(f"{sec._acc_path(inv['cik'], acc)}/{doc}").content)
        except Exception as e:
            log.warning("%s %s: %s", f["form"], acc, e)
            continue
        issuer = _first(root, "issuerName")
        cus = (_first(root, "issuerCusipNumber", "issuerCUSIP") or "").upper()
        pct = _max(root, "percentOfClass", "classPercent")
        shares = _max(root, "aggregateAmountOwned", "reportingPersonBeneficiallyOwnedAggregateNumberOfShares")
        event = _date(_first(root, "dateOfEvent", "eventDateRequiresFilingThisStatement")) or f["filingDate"]
        amend = _first(root, "amendmentNo")
        kind = "13D" if "13D" in f["form"] else "13G"
        with db.tx() as con:
            con.execute("INSERT OR REPLACE INTO filings(accession,investor_id,source,form,filed_at,period,url) VALUES (?,?,?,?,?,?,?)",
                        (acc, inv["id"], kind, f["form"], f["acceptanceDateTime"] or f["filingDate"], event, url))
        if not issuer or pct is None:
            continue
        ticker = cusip.resolve([(cus, issuer)]).get(cus) if cus else None
        prev = db.one("SELECT pct FROM trades WHERE investor_id=? AND source IN ('13D','13G') AND issuer=? AND uid!=? "
                      "ORDER BY trade_date DESC LIMIT 1", (inv["id"], issuer, f"SC:{acc}"))
        detail = f"{pct:.1f} % du capital".replace(".", ",")
        if shares:
            detail += ", " + f"{shares:,.0f}".replace(",", " ") + " actions"
        if prev and prev["pct"] is not None and abs(prev["pct"] - pct) >= .05:
            detail += f" (avant : {prev['pct']:.1f} %)".replace(".", ",")
        if amend:
            detail += f", mise à jour n° {amend}"
        action = "STAKE_UP" if (not prev or prev["pct"] is None or pct >= prev["pct"]) else "STAKE_DOWN"
        db.execute("""INSERT OR REPLACE INTO trades(uid,investor_id,source,action,trade_date,filed_at,ticker,issuer,asset_type,
                      shares_after,details,url,pct) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                   (f"SC:{acc}", inv["id"], kind, action, event, f["acceptanceDateTime"] or f["filingDate"], ticker,
                    issuer, "Participation", shares, detail, url, pct))
        new += 1
    if new:
        log.info("13D/G %s: %d", inv["id"], new)
    return new


def refresh():
    for inv in ENTITIES:
        if inv.get("cik") and inv["type"] == "investor":
            try:
                refresh_investor(inv)
            except Exception:
                log.exception("13D/G %s", inv["id"])
