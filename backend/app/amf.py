"""Déclarations des dirigeants auprès de l'AMF (article 19 du règlement MAR, ≤ 3 jours ouvrés).

Source officielle : base BDIF de l'AMF (https://bdif.amf-france.org), API publique utilisée par son site.
Chaque déclaration est un PDF généré par l'AMF, au format texte stable -> parsing par libellés.
Une déclaration est rattachée :
  - à la société cotée concernée (ex. Vivendi) ;
  - à un investisseur suivi si le nom du déclarant correspond à l'un de ses alias (ex. « Compagnie de Cornouaille » -> Bolloré).
"""
import io
import logging
import re
from datetime import date

import pdfplumber

from . import db, http
from .investors import ENTITIES, FR_COMPANIES

log = logging.getLogger("amf")
API = "https://bdif.amf-france.org/back/api/v1"
PAGE = "https://bdif.amf-france.org/fr/details/{}"
PER_COMPANY = 30

_MONTHS = {m: i for i, m in enumerate(["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août",
                                        "septembre", "octobre", "novembre", "décembre"], 1)}
_ACTIONS = {"acquisition": "BUY", "achat": "BUY", "souscription": "BUY", "cession": "SELL", "vente": "SELL"}

db.execute("""CREATE TABLE IF NOT EXISTS amf_docs (numero TEXT PRIMARY KEY, company_id TEXT, status TEXT)""")


def _date(s):
    m = re.search(r"(\d{1,2})\s+([a-zéû]+)\s+(\d{4})", (s or "").lower())
    if m and m.group(2) in _MONTHS:
        return date(int(m.group(3)), _MONTHS[m.group(2)], int(m.group(1))).isoformat()
    return None


def _num(s):
    m = re.search(r"([\d\s.,]+)", s or "")
    if not m:
        return None
    v = m.group(1).replace(" ", "").replace(" ", "")
    if v.count(",") and v.count("."):
        v = v.replace(",", "")
    v = v.replace(",", ".")
    try:
        return float(v)
    except ValueError:
        return None


_NOT_MARKET = ("performance", "gratuite", "attribution", "exercice", "donation", "nantissement", "prêt", "succession")


def _action(nature, price):
    """Achat/vente sur le marché uniquement ; attributions gratuites, exercices d'options, dons… -> OTHER."""
    n = nature.lower()
    if any(w in n for w in _NOT_MARKET) or price == 0:
        return "OTHER"
    return next((v for k, v in _ACTIONS.items() if n.startswith(k)), "OTHER")


def parse(pdf_bytes):
    """Retourne (déclarant, [transactions]) depuis la partie française du PDF."""
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        text = "\n".join(p.extract_text() or "" for p in pdf.pages)
    text = text.split("Individual notification")[0]  # la 2e moitié est la traduction anglaise
    m = re.search(r"PERSONNE ETROITEMENT LIEE\s*:\s*\n(.+?)\nNOTIFICATION", text, re.S)
    declarant = re.sub(r"\s+", " ", m.group(1)).strip() if m else None
    txs = []
    for block in text.split("DETAIL DE LA TRANSACTION")[1:]:
        def field(label):
            mm = re.search(label + r"\s*:\s*(.+)", block)
            return mm.group(1).strip() if mm else None
        nature = field("NATURE DE LA TRANSACTION") or ""
        agg = block.split("INFORMATIONS AGREGEES")[-1]
        price = _num((re.search(r"PRIX\s*:\s*(.+)", agg) or [None, None])[1])
        volume = _num((re.search(r"VOLUME\s*:\s*(.+)", agg) or [None, None])[1])
        currency = "EUR" if "euro" in (re.search(r"PRIX\s*:\s*(.+)", agg) or [None, ""])[1].lower() else None
        txs.append({
            "date": _date(field("DATE DE LA TRANSACTION")),
            "nature": nature,
            "action": _action(nature, price),
            "instrument": field("DESCRIPTION DE L.INSTRUMENT FINANCIER"),
            "price": price, "volume": volume, "currency": currency,
            "venue": field("LIEU DE LA TRANSACTION"),
        })
    return declarant, txs


def _match_investor(declarant):
    d = (declarant or "").lower()
    for e in ENTITIES:
        if e.get("amf") and any(a in d for a in e["amf"]):
            return e["id"]
    return None


def refresh_company(c):
    r = http.get(f"{API}/informations", params={"TypesInformation": "DD", "Jetons": c["jeton"], "From": 0,
                                                 "Size": PER_COMPANY, "Lang": "fr"}, timeout=60)
    if r.status_code != 200:
        log.warning("AMF %s: HTTP %s", c["id"], r.status_code)
        return 0
    new = 0
    for info in r.json().get("result") or []:
        numero = info.get("numero")
        docs = [d for d in info.get("documents") or [] if d.get("accessible") and d.get("path")]
        if not numero or not docs or db.one("SELECT 1 FROM amf_docs WHERE numero=?", (numero,)):
            continue
        try:
            pdf = http.get(f"{API}/documents/{docs[0]['path']}", timeout=60)
            declarant, txs = parse(pdf.content)
            status = "ok" if txs else "empty"
        except Exception as ex:
            log.warning("AMF %s %s: %s", c["id"], numero, ex)
            declarant, txs, status = None, [], "error"
        actor = _match_investor(declarant)
        published = (info.get("datePublication") or "")[:19]
        url = PAGE.format(numero)
        name, _, function = (declarant or "").partition(",")
        with db.tx() as con:
            con.execute("INSERT OR REPLACE INTO amf_docs VALUES (?,?,?)", (numero, c["id"], status))
            con.execute("INSERT OR REPLACE INTO filings(accession,investor_id,source,form,filed_at,period,url) VALUES (?,?,?,?,?,?,?)",
                        (f"AMF-{numero}", c["id"], "AMF", "DD", published, None, url))
            for i, t in enumerate(txs):
                value = t["price"] * t["volume"] if t["price"] and t["volume"] else None
                details = " · ".join(x for x in [t["nature"], function.strip() or None, t["instrument"]] if x)
                con.execute("""INSERT OR REPLACE INTO trades(uid,investor_id,source,action,trade_date,filed_at,ticker,issuer,asset_type,
                               shares,price,value,owner,details,url,actor_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                            (f"AMF:{numero}:{i}", c["id"], "AMF", t["action"], t["date"], published, c["ticker"], c["name"],
                             t["nature"], t["volume"], t["price"], value, name.strip() or declarant, details, url, actor))
                new += 1
    if new:
        log.info("AMF %s: %d nouvelles opérations", c["id"], new)
    return new


def refresh():
    n = 0
    for c in FR_COMPANIES:
        try:
            n += refresh_company(c)
        except Exception:
            log.exception("AMF %s", c["id"])
    return n
