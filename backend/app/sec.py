"""Scraping SEC EDGAR: 13F-HR (portefeuilles) et Form 4 (transactions d'initiés / >10%)."""
import logging
import re
from collections import defaultdict
from datetime import date, timedelta

from lxml import etree

from . import cusip, db, http
from .config import FORM4_LOOKBACK_DAYS, FORM4_MAX_FILINGS
from .investors import BY_CIK

log = logging.getLogger("sec")
ARCHIVES = "https://www.sec.gov/Archives/edgar/data"


def _acc_path(cik, accession):
    return f"{ARCHIVES}/{int(cik)}/{accession.replace('-', '')}"


def submissions(cik):
    r = http.get(f"https://data.sec.gov/submissions/CIK{int(cik):010d}.json")
    r.raise_for_status()
    rec = r.json()["filings"]["recent"]
    keys = ["accessionNumber", "form", "filingDate", "reportDate", "acceptanceDateTime", "primaryDocument"]
    return [dict(zip(keys, vals)) for vals in zip(*(rec[k] for k in keys))]


def _xml(content):
    parser = etree.XMLParser(recover=True, huge_tree=True)
    root = etree.fromstring(content, parser)
    # supprime les namespaces pour simplifier les XPath
    for el in root.iter():
        if isinstance(el.tag, str) and "}" in el.tag:
            el.tag = el.tag.split("}", 1)[1]
    return root


def _txt(el, path):
    found = el.find(path)
    return found.text.strip() if found is not None and found.text else None


def _num(s):
    try:
        return float(str(s).replace(",", ""))
    except (TypeError, ValueError):
        return None


# --------------------------------------------------------------------------- 13F
def _info_table_url(cik, accession):
    idx = http.get(f"{_acc_path(cik, accession)}/index.json").json()
    xmls = [it for it in idx["directory"]["item"]
            if it["name"].lower().endswith(".xml") and it["name"].lower() != "primary_doc.xml"]
    if not xmls:
        return None
    # le plus gros xml = information table
    best = max(xmls, key=lambda it: int(it.get("size") or 0))
    return f"{_acc_path(cik, accession)}/{best['name']}"


def _parse_info_table(content, filed):
    root = _xml(content)
    agg = defaultdict(lambda: {"shares": 0.0, "value": 0.0})
    mult = 1000.0 if filed < "2023-01-01" else 1.0  # avant 2023: valeurs en milliers de $
    for t in root.iter("infoTable"):
        c = (_txt(t, "cusip") or "").upper()
        pc = (_txt(t, "putCall") or "").upper()
        a = agg[(c, pc)]
        a["issuer"] = _txt(t, "nameOfIssuer")
        a["title"] = _txt(t, "titleOfClass")
        a["shares"] += _num(_txt(t, "shrsOrPrnAmt/sshPrnamt")) or 0
        a["value"] += (_num(_txt(t, "value")) or 0) * mult
    return agg


def refresh_13f(inv, subs=None, keep_periods=2):
    cik = inv["cik"]
    subs = subs or submissions(cik)
    by_period = {}
    for f in subs:  # trié du plus récent au plus ancien
        if f["form"] == "13F-HR" and f["reportDate"] and f["reportDate"] not in by_period:
            by_period[f["reportDate"]] = f
    periods = sorted(by_period, reverse=True)[:keep_periods]
    changed = False
    for p in periods:
        f = by_period[p]
        if db.one("SELECT 1 FROM filings WHERE accession=?", (f["accessionNumber"],)):
            continue
        url = _info_table_url(cik, f["accessionNumber"])
        if not url:
            continue
        agg = _parse_info_table(http.get(url).content, f["filingDate"])
        tickers = cusip.resolve((c, a["issuer"]) for (c, _), a in agg.items())
        with db.tx() as con:
            con.execute("DELETE FROM holdings WHERE investor_id=? AND period=?", (inv["id"], p))
            for (c, pc), a in agg.items():
                con.execute("INSERT INTO holdings VALUES (?,?,?,?,?,?,?,?,?,?)",
                            (inv["id"], p, c, pc, a["issuer"], a["title"], tickers.get(c), a["shares"], a["value"], f["accessionNumber"]))
            con.execute("INSERT OR REPLACE INTO filings(accession,investor_id,source,form,filed_at,period,url) VALUES (?,?,?,?,?,?,?)",
                        (f["accessionNumber"], inv["id"], "13F", f["form"], f["acceptanceDateTime"] or f["filingDate"], p,
                         f"{_acc_path(cik, f['accessionNumber'])}/{f['accessionNumber']}-index.htm"))
        changed = True
        log.info("13F %s %s: %d lignes", inv["id"], p, len(agg))
    if changed:
        _compute_13f_changes(inv)
    return changed


def _compute_13f_changes(inv):
    """Achats/ventes déduits de la différence entre les deux derniers 13F."""
    periods = [r["period"] for r in db.query(
        "SELECT DISTINCT period FROM holdings WHERE investor_id=? ORDER BY period DESC LIMIT 2", (inv["id"],))]
    if len(periods) < 2:
        return
    cur_p, prev_p = periods
    cur = {(r["cusip"], r["put_call"]): r for r in db.query("SELECT * FROM holdings WHERE investor_id=? AND period=?", (inv["id"], cur_p))}
    prev = {(r["cusip"], r["put_call"]): r for r in db.query("SELECT * FROM holdings WHERE investor_id=? AND period=?", (inv["id"], prev_p))}
    filing = db.one("SELECT filed_at, url FROM filings WHERE investor_id=? AND source='13F' AND period=?", (inv["id"], cur_p))
    rows = []
    for key in set(cur) | set(prev):
        c, p = cur.get(key), prev.get(key)
        cs, ps = (c or {}).get("shares") or 0, (p or {}).get("shares") or 0
        if abs(cs - ps) < 1e-9:
            continue
        ref = c or p
        price = (ref["value"] / ref["shares"]) if ref["shares"] else None
        if not p:
            action = "NEW"
        elif not c:
            action = "EXIT"
        else:
            action = "ADD" if cs > ps else "REDUCE"
        delta = cs - ps
        pct = (delta / ps * 100) if ps else None
        detail = f"{ps:,.0f} → {cs:,.0f} titres" + (f" ({pct:+.1f}%)" if pct is not None else "")
        if key[1]:
            detail += f" · option {key[1]}"
        rows.append((f"13F:{inv['id']}:{cur_p}:{key[0]}:{key[1]}", inv["id"], "13F", action, cur_p, filing["filed_at"],
                     ref["ticker"], ref["issuer"], key[1] or ref["title"], abs(delta), price,
                     abs(delta) * price if price else None, None, None, cs, None, detail, filing["url"]))
    with db.tx() as con:
        con.execute("DELETE FROM trades WHERE investor_id=? AND source='13F' AND trade_date=?", (inv["id"], cur_p))
        con.executemany("""INSERT OR REPLACE INTO trades(uid,investor_id,source,action,trade_date,filed_at,ticker,issuer,asset_type,
                           shares,price,value,value_low,value_high,shares_after,owner,details,url)
                           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""", rows)


# --------------------------------------------------------------------------- Form 4
_F4_CODES = {"P": "BUY", "S": "SELL"}


def _parse_form4(content):
    root = _xml(content)
    owners = {int(_txt(o, "reportingOwnerId/rptOwnerCik") or 0) for o in root.iter("reportingOwner")}
    ticker = (_txt(root, "issuer/issuerTradingSymbol") or "").upper().strip()
    ticker = None if ticker in ("", "N/A", "NA", "NONE", "-") else ticker
    issuer = _txt(root, "issuer/issuerName")
    period = _txt(root, "periodOfReport")
    txs = []
    for i, t in enumerate(root.iter("nonDerivativeTransaction")):
        code = _txt(t, "transactionCoding/transactionCode")
        if code not in _F4_CODES:
            continue
        shares = _num(_txt(t, "transactionAmounts/transactionShares/value"))
        price = _num(_txt(t, "transactionAmounts/transactionPricePerShare/value"))
        txs.append({
            "idx": i, "action": _F4_CODES[code], "date": _txt(t, "transactionDate/value"),
            "title": _txt(t, "securityTitle/value"), "shares": shares, "price": price,
            "value": shares * price if shares and price else None,
            "after": _num(_txt(t, "postTransactionAmounts/sharesOwnedFollowingTransaction/value")),
            "direct": _txt(t, "ownershipNature/directOrIndirectOwnership/value"),
        })
    return owners, ticker, issuer, period, txs


def refresh_form4(inv, subs=None):
    cik = inv["cik"]
    subs = subs or submissions(cik)
    since = (date.today() - timedelta(days=FORM4_LOOKBACK_DAYS)).isoformat()
    cands = [f for f in subs if f["form"] in ("4", "4/A") and f["filingDate"] >= since][:FORM4_MAX_FILINGS]
    new = 0
    for f in cands:
        acc = f["accessionNumber"]
        if db.one("SELECT 1 FROM filings WHERE accession=? AND investor_id=?", (acc, inv["id"])):
            continue
        doc = re.sub(r"^xsl[^/]+/", "", f["primaryDocument"])
        url = f"{_acc_path(cik, acc)}/{doc}"
        try:
            owners, ticker, issuer, period, txs = _parse_form4(http.get(url).content)
            period = period or f["reportDate"]
        except Exception as e:
            log.warning("Form4 %s: %s", url, e)
            continue
        index_url = f"{_acc_path(cik, acc)}/{acc}-index.htm"
        with db.tx() as con:
            con.execute("INSERT OR REPLACE INTO filings(accession,investor_id,source,form,filed_at,period,url) VALUES (?,?,?,?,?,?,?)",
                        (acc, inv["id"], "FORM4", f["form"], f["acceptanceDateTime"] or f["filingDate"], period, index_url))
            if cik not in owners:  # l'investisseur est ici l'émetteur (ex: Form 4 d'un dirigeant de NVIDIA)
                continue
            for t in txs:
                detail = f"{t['title'] or ''}".strip()
                if t["after"] is not None:
                    detail += f" · détient {t['after']:,.0f} titres après l'opération"
                if t["direct"] == "I":
                    detail += " · détention indirecte"
                con.execute("""INSERT OR REPLACE INTO trades(uid,investor_id,source,action,trade_date,filed_at,ticker,issuer,asset_type,
                               shares,price,value,shares_after,details,url,report_date) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                            (f"F4:{acc}:{t['idx']}", inv["id"], "FORM4", t["action"], t["date"],
                             f["acceptanceDateTime"] or f["filingDate"], ticker, issuer, "Actions",
                             t["shares"], t["price"], t["value"], t["after"], detail, index_url, period))
                new += 1
    if new:
        log.info("Form4 %s: %d nouvelles transactions", inv["id"], new)
    return new


def refresh_investor(inv):
    subs = submissions(inv["cik"])
    refresh_13f(inv, subs)
    refresh_form4(inv, subs)


# --------------------------------------------------------------------------- flux temps réel
_FEED = "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type={form}&company=&dateb=&owner=include&start=0&count=100&output=atom"


def poll_live_feed():
    """Lit le flux EDGAR des dépôts des dernières minutes et renvoie les investisseurs suivis concernés."""
    hits = set()
    for form in ("13F-HR", "4"):
        try:
            root = _xml(http.get(_FEED.format(form=form)).content)
        except Exception as e:
            log.warning("flux EDGAR %s: %s", form, e)
            continue
        for entry in root.iter("entry"):
            title = _txt(entry, "title") or ""
            m = re.search(r"\((\d{10})\)", title)
            if m and int(m.group(1)) in BY_CIK:
                hits.add(BY_CIK[int(m.group(1))]["id"])
    return hits
