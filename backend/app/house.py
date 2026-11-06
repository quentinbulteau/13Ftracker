"""Scraping des Periodic Transaction Reports (PTR) de la Chambre des représentants US.

Source officielle: https://disclosures-clerk.house.gov
  - index annuel: /public_disc/financial-pdfs/{YEAR}FD.zip (XML, mis à jour en continu)
  - PTR: /public_disc/ptr-pdfs/{YEAR}/{DocID}.pdf
Les PTR électroniques sont des PDF texte -> parsing ligne à ligne.
Les dépôts papier scannés (pas de texte) sont signalés mais non parsés.
"""
import io
import logging
import re
import zipfile
from datetime import date, datetime

import pdfplumber
from lxml import etree

from . import db, http
from .config import HOUSE_YEARS_BACK
from .investors import INVESTORS

log = logging.getLogger("house")
BASE = "https://disclosures-clerk.house.gov/public_disc"

_TX = re.compile(
    r"^(?:(?P<owner>SP|JT|DC)\s+)?(?P<asset>.*?)\s*"
    r"(?P<type>P|S \(partial\)|S|E)\s+"
    r"(?P<tdate>\d{2}/\d{2}/\d{4})\s+(?P<ndate>\d{2}/\d{2}/\d{4})\s*"
    r"(?P<amount>.*)$"
)
_MONEY = re.compile(r"\$([\d,]+)")
_ACTION = {"P": "BUY", "S": "SELL", "S (partial)": "SELL", "E": "EXCHANGE"}
_OWNER = {"SP": "Conjoint", "JT": "Joint", "DC": "Enfant à charge", None: "Élu(e)"}
_SKIP = ("ID Owner", "Type Date", "$200?", "Filing ID", "Clerk of the House", "Name:", "Status:", "State/District",
         "* For the complete", "I CERTIFY", "Digitally Signed", "my knowledge")


def _iso(d):
    return datetime.strptime(d, "%m/%d/%Y").date().isoformat()


def _amounts(text):
    vals = [float(v.replace(",", "")) for v in _MONEY.findall(text)]
    if not vals:
        return None, None
    if "Over" in text and len(vals) == 1:
        return vals[0], None
    return vals[0], (vals[1] if len(vals) > 1 else None)


def parse_ptr(pdf_bytes):
    """Retourne la liste des transactions d'un PTR électronique (liste vide si scan)."""
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        lines = []
        for page in pdf.pages:
            lines += (page.extract_text() or "").splitlines()
    txs, cur = [], None

    def close():
        if cur:
            asset = re.sub(r"\s+", " ", " ".join(cur["asset_parts"])).strip()
            tick = re.search(r"\(([A-Z][A-Z0-9.\-]{0,7})\)", asset)
            atype = re.search(r"\[([A-Z]{2})\]", asset)
            low, high = _amounts(cur["amount"])
            txs.append({
                "owner": _OWNER.get(cur["owner"]), "asset": re.sub(r"\s*\[[A-Z]{2}\]", "", asset),
                "ticker": tick.group(1) if tick else None, "asset_type": atype.group(1) if atype else None,
                "action": _ACTION[cur["type"]], "partial": cur["type"] == "S (partial)",
                "trade_date": _iso(cur["tdate"]), "notified": _iso(cur["ndate"]),
                "low": low, "high": high, "description": cur.get("desc"),
            })

    for raw in lines:
        line = re.sub(r"\s+", " ", raw.replace("\x00", "")).strip()
        if not line or any(line.startswith(s) for s in _SKIP):
            continue
        m = _TX.match(line)
        if m and m.group("asset"):
            close()
            cur = {"owner": m.group("owner"), "asset_parts": [m.group("asset")], "type": m.group("type"),
                   "tdate": m.group("tdate"), "ndate": m.group("ndate"), "amount": m.group("amount")}
            continue
        if cur is None:
            continue
        label = re.match(r"^([A-Z](?: [A-Z])?) ?:\s*(.*)$", line)  # libellés abrégés du PDF
        if label:
            if label.group(1) == "D":  # Description
                cur["desc"] = label.group(2)
            cur["in_labels"] = True  # Filing status / Subholding of / Comments
            continue
        if cur.get("in_labels"):
            continue
        # ligne de continuation: suite du nom de l'actif et/ou borne haute du montant
        money = re.search(r"(\$[\d,]+)\s*$", line)
        if money and "$" not in cur["amount"].split("-")[-1]:
            cur["amount"] += " " + money.group(1)
            line = line[: money.start()].strip()
        if line:
            cur["asset_parts"].append(line)
    close()
    return txs


def _index(year):
    r = http.get(f"{BASE}/financial-pdfs/{year}FD.zip", timeout=120)
    if r.status_code != 200:
        return []
    with zipfile.ZipFile(io.BytesIO(r.content)) as z:
        xml = z.read(f"{year}FD.xml")
    root = etree.fromstring(xml)
    out = []
    for m in root.iter("Member"):
        g = lambda k: (m.findtext(k) or "").strip()
        if g("FilingType") == "P":
            out.append({"last": g("Last"), "first": g("First"), "state": g("StateDst")[:2], "year": g("Year") or str(year),
                        "filed": g("FilingDate"), "doc_id": g("DocID")})
    return out


def _match(entry):
    for inv in INVESTORS:
        h = inv.get("house")
        if (h and entry["last"].lower() == h["last"].lower() and entry["first"].lower().startswith(h["first"].lower()[:3])
                and (not h.get("state") or entry["state"] == h["state"])):
            return inv
    return None


def refresh():
    this_year = date.today().year
    new = 0
    for year in range(this_year - HOUSE_YEARS_BACK, this_year + 1):
        try:
            entries = _index(year)
        except Exception as e:
            log.warning("index Chambre %s: %s", year, e)
            continue
        for e in entries:
            inv = _match(e)
            if not inv or db.one("SELECT 1 FROM house_docs WHERE doc_id=?", (e["doc_id"],)):
                continue
            filed = _iso(e["filed"]) if e["filed"] else None
            url = f"{BASE}/ptr-pdfs/{e['year']}/{e['doc_id']}.pdf"
            try:
                r = http.get(url, timeout=60)
                if r.status_code != 200:
                    continue
                txs = parse_ptr(r.content)
                status = "ok" if txs else "no_text"
            except Exception as ex:
                log.warning("PTR %s: %s", url, ex)
                txs, status = [], "error"
            with db.tx() as con:
                con.execute("INSERT OR REPLACE INTO house_docs VALUES (?,?,?,?)", (e["doc_id"], inv["id"], filed, status))
                con.execute("INSERT OR REPLACE INTO filings(accession,investor_id,source,form,filed_at,period,url) VALUES (?,?,?,?,?,?,?)",
                            (f"HOUSE-{e['doc_id']}", inv["id"], "HOUSE", "PTR", filed, None, url))
                for i, t in enumerate(txs):
                    detail = " · ".join(x for x in [t["owner"], "vente partielle" if t["partial"] else None, t["description"]] if x)
                    con.execute("""INSERT OR REPLACE INTO trades(uid,investor_id,source,action,trade_date,filed_at,ticker,issuer,asset_type,
                                   value_low,value_high,owner,details,url) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                                (f"H:{e['doc_id']}:{i}", inv["id"], "HOUSE", t["action"], t["trade_date"], filed, t["ticker"],
                                 t["asset"], t["asset_type"], t["low"], t["high"], t["owner"], detail, url))
            new += len(txs)
            log.info("PTR %s %s: %d transactions (%s)", inv["id"], e["doc_id"], len(txs), status)
    return new
