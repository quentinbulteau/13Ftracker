"""Alertes d'initiés : achats et ventes de leurs propres actions par les dirigeants des grandes sociétés.

- États-Unis : 100 premières sociétés américaines par capitalisation (liste SEC) -> Form 4 (≤ 2 jours ouvrés)
- France     : valeurs du CAC 40 qui déclarent à l'AMF -> déclarations des dirigeants (≤ 3 jours ouvrés)
- Allemagne  : valeurs du DAX -> base « Directors' Dealings » de la BaFin (≤ 3 jours ouvrés)

Seuls les achats et ventes sur le marché sont retenus (pas les attributions gratuites, exercices d'options, dons).
Aux États-Unis, une vente programmée à l'avance (plan 10b5-1) est signalée : elle dit peu de chose
sur l'opinion du dirigeant, contrairement à un achat spontané.
"""
import csv
import hashlib
import io
import logging
import re
import time
from datetime import date, datetime, timedelta

from . import amf, db, http, sec

log = logging.getLogger("insiders")
LOOKBACK_DAYS = 45
US_PER_ISSUER = 25

db.execute("""CREATE TABLE IF NOT EXISTS insider_trades (
    uid TEXT PRIMARY KEY, market TEXT, issuer TEXT, ticker TEXT, insider TEXT, role TEXT, action TEXT,
    trade_date TEXT, filed_at TEXT, shares REAL, price REAL, value REAL, currency TEXT, planned INTEGER, url TEXT)""")
db.execute("CREATE INDEX IF NOT EXISTS ix_ins_filed ON insider_trades(filed_at)")
db.execute("CREATE TABLE IF NOT EXISTS insider_docs (id TEXT PRIMARY KEY)")

# CAC 40 : jeton AMF -> (nom, ticker). Airbus, Stellantis, STMicroelectronics et ArcelorMittal déclarent
# hors de France (Pays-Bas / Luxembourg) et n'apparaissent donc pas à l'AMF.
CAC40 = {
    "RS00001533": ("Accor", "AC.PA"), "RS00001372": ("Air Liquide", "AI.PA"), "RS00001476": ("AXA", "CS.PA"),
    "RS00003376": ("BNP Paribas", "BNP.PA"), "RS00001454": ("Bouygues", "EN.PA"), "RS00001691": ("Bureau Veritas", "BVI.PA"),
    "RS00001977": ("Capgemini", "CAP.PA"), "RS00001578": ("Carrefour", "CA.PA"), "RS00003391": ("Crédit Agricole", "ACA.PA"),
    "RS00001343": ("Danone", "BN.PA"), "RS00001148": ("Dassault Systèmes", "DSY.PA"), "RS00005100": ("Edenred", "EDEN.PA"),
    "RS00002933": ("Engie", "ENGI.PA"), "RS00001646": ("EssilorLuxottica", "EL.PA"), "RS00000084": ("Euronext", "ENX.PA"),
    "RS00001472": ("Hermès", "RMS.PA"), "RS00003337": ("Kering", "KER.PA"), "RS00001556": ("L'Oréal", "OR.PA"),
    "RS00004341": ("Legrand", "LR.PA"), "RS00001689": ("LVMH", "MC.PA"), "RS00003393": ("Michelin", "ML.PA"),
    "RS00001914": ("Orange", "ORA.PA"), "RS00001512": ("Pernod Ricard", "RI.PA"), "RS00001288": ("Publicis", "PUB.PA"),
    "RS00003070": ("Renault", "RNO.PA"), "RS00001430": ("Safran", "SAF.PA"), "RS00001264": ("Saint-Gobain", "SGO.PA"),
    "RS00002618": ("Sanofi", "SAN.PA"), "RS00003319": ("Schneider Electric", "SU.PA"), "RS00003340": ("Société Générale", "GLE.PA"),
    "RS00003268": ("Teleperformance", "TEP.PA"), "RS00001360": ("Thales", "HO.PA"), "RS00003321": ("TotalEnergies", "TTE.PA"),
    "RS00003029": ("Unibail-Rodamco-Westfield", "URW.PA"), "RS00003502": ("Veolia", "VIE.PA"), "RS00001350": ("Vinci", "DG.PA"),
}

# DAX : ISIN -> (nom, ticker). ISIN relevés dans la base BaFin. Airbus et Qiagen (droit néerlandais) n'y figurent pas.
DAX = {
    "DE000A1EWWW0": ("adidas", "ADS.DE"), "DE0008404005": ("Allianz", "ALV.DE"), "DE000BASF111": ("BASF", "BAS.DE"),
    "DE000BAY0017": ("Bayer", "BAYN.DE"), "DE0005190003": ("BMW", "BMW.DE"), "DE0005200000": ("Beiersdorf", "BEI.DE"),
    "DE000A1DAHH0": ("Brenntag", "BNR.DE"), "DE000CBK1001": ("Commerzbank", "CBK.DE"), "DE0005439004": ("Continental", "CON.DE"),
    "DE0005140008": ("Deutsche Bank", "DBK.DE"), "DE0005552004": ("DHL Group", "DHL.DE"), "DE000DTR0CK8": ("Daimler Truck", "DTG.DE"),
    "DE0005810055": ("Deutsche Börse", "DB1.DE"), "DE0005557508": ("Deutsche Telekom", "DTE.DE"), "DE000PAG9113": ("Porsche AG", "P911.DE"),
    "DE000ENAG999": ("E.ON", "EOAN.DE"), "DE0005785802": ("Fresenius Medical Care", "FME.DE"), "DE0005785604": ("Fresenius", "FRE.DE"),
    "DE0006602006": ("GEA Group", "G1A.DE"), "DE0008402215": ("Hannover Rück", "HNR1.DE"), "DE0006047004": ("Heidelberg Materials", "HEI.DE"),
    "DE0006048432": ("Henkel", "HEN3.DE"), "DE0006231004": ("Infineon", "IFX.DE"), "DE0006599905": ("Merck KGaA", "MRK.DE"),
    "DE000A0D9PT0": ("MTU Aero Engines", "MTX.DE"), "DE0007100000": ("Mercedes-Benz", "MBG.DE"), "DE0008430026": ("Munich Re", "MUV2.DE"),
    "DE0007037129": ("RWE", "RWE.DE"), "DE0007030009": ("Rheinmetall", "RHM.DE"), "DE0007164600": ("SAP", "SAP.DE"),
    "DE0007165631": ("Sartorius", "SRT3.DE"), "DE000A12DM80": ("Scout24", "G24.DE"), "DE0007236101": ("Siemens", "SIE.DE"),
    "DE000ENER6Y0": ("Siemens Energy", "ENR.DE"), "DE000SHL1006": ("Siemens Healthineers", "SHL.DE"), "DE000SYM9999": ("Symrise", "SY1.DE"),
    "DE0007664039": ("Volkswagen", "VOW3.DE"), "DE000PAH0038": ("Porsche SE", "PAH3.DE"), "DE000A1ML7J1": ("Vonovia", "VNA.DE"),
    "DE000ZAL1111": ("Zalando", "ZAL.DE"),
}
# lignes BaFin parfois sans ISIN : rattrapage par le nom
_DAX_NAMES = {re.sub(r"[^a-z]", "", n.lower()): isin for isin, (n, _) in DAX.items()}
_DAX_NAMES.update({"adidasag": "DE000A1EWWW0", "heidelbergmaterialsag": "DE0006047004", "vonoviase": "DE000A1ML7J1"})

MARKETS = {"US": "Top 100 US", "FR": "CAC 40", "DE": "DAX"}


def _done(doc_id):
    return db.one("SELECT 1 FROM insider_docs WHERE id=?", (doc_id,)) is not None


def _mark(doc_id):
    db.execute("INSERT OR IGNORE INTO insider_docs VALUES (?)", (doc_id,))


def _store(rows):
    with db.tx() as con:
        con.executemany("INSERT OR REPLACE INTO insider_trades VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", rows)


# --------------------------------------------------------------------------- États-Unis
def us_top100():
    """100 premières sociétés américaines (déposant des 10-K) de la liste SEC, triée par capitalisation."""
    cached = db.get_meta("us_top100")
    stamp = float(db.get_meta("us_top100_at", 0) or 0)
    if cached and time.time() - stamp < 7 * 86400:
        return [tuple(x.split("|")) for x in cached.split(";")]
    data = http.get("https://www.sec.gov/files/company_tickers.json").json()
    out, seen = [], set()
    for row in data.values():
        if row["cik_str"] in seen:
            continue
        seen.add(row["cik_str"])
        try:
            subs = sec.submissions(row["cik_str"])
        except Exception:
            continue
        if any(f["form"] == "10-K" for f in subs):  # société américaine (les étrangères déposent un 20-F)
            out.append((str(row["cik_str"]), row["ticker"].replace("-", "."), row["title"]))
        if len(out) == 100:
            break
    db.set_meta("us_top100", ";".join("|".join(x) for x in out))
    db.set_meta("us_top100_at", time.time())
    return out


def _form4(content):
    root = sec._xml(content)
    owner = root.find("reportingOwner")
    name = sec._txt(owner, "reportingOwnerId/rptOwnerName") if owner is not None else None
    rel = owner.find("reportingOwnerRelationship") if owner is not None else None
    roles = []
    if rel is not None:
        if (sec._txt(rel, "isOfficer") or "").lower() in ("1", "true"):
            roles.append(sec._txt(rel, "officerTitle") or "Dirigeant")
        if (sec._txt(rel, "isDirector") or "").lower() in ("1", "true"):
            roles.append("Administrateur")
        if (sec._txt(rel, "isTenPercentOwner") or "").lower() in ("1", "true"):
            roles.append("Actionnaire > 10 %")
    plan_doc = (sec._txt(root, "aff10b5One") or "").lower() in ("1", "true")
    notes = {f.get("id"): (f.text or "") for f in root.iter("footnote")}
    txs = []
    for i, t in enumerate(root.iter("nonDerivativeTransaction")):
        code = sec._txt(t, "transactionCoding/transactionCode")
        if code not in ("P", "S"):
            continue
        ids = [f.get("id") for f in t.iter("footnoteId")]
        planned = plan_doc or any("10b5-1" in notes.get(x, "") for x in ids)
        shares = sec._num(sec._txt(t, "transactionAmounts/transactionShares/value"))
        price = sec._num(sec._txt(t, "transactionAmounts/transactionPricePerShare/value"))
        txs.append((i, "BUY" if code == "P" else "SELL", sec._txt(t, "transactionDate/value"), shares, price, planned))
    return name, ", ".join(roles), txs


def refresh_us():
    since = (date.today() - timedelta(days=LOOKBACK_DAYS)).isoformat()
    new = 0
    for cik, ticker, title in us_top100():
        try:
            subs = sec.submissions(cik)
        except Exception as e:
            log.warning("SEC %s: %s", ticker, e)
            continue
        for f in [f for f in subs if f["form"] == "4" and f["filingDate"] >= since][:US_PER_ISSUER]:
            acc = f["accessionNumber"]
            if _done(acc):
                continue
            doc = re.sub(r"^xsl[^/]+/", "", f["primaryDocument"])
            try:
                name, role, txs = _form4(http.get(f"{sec._acc_path(cik, acc)}/{doc}").content)
            except Exception as e:
                log.warning("Form 4 %s %s: %s", ticker, acc, e)
                continue
            url = f"{sec._acc_path(cik, acc)}/{acc}-index.htm"
            _store([(f"US:{acc}:{i}", "US", title.title() if title.isupper() else title, ticker, name, role, action, d,
                     f["acceptanceDateTime"] or f["filingDate"], sh, pr, sh * pr if sh and pr else None, "USD", int(pl), url)
                    for i, action, d, sh, pr, pl in txs])
            _mark(acc)
            new += len(txs)
    return new


# --------------------------------------------------------------------------- France
def refresh_fr(max_pages=None):
    first = not db.one("SELECT 1 FROM insider_trades WHERE market='FR' LIMIT 1")
    pages = max_pages or (15 if first else 2)
    since = (date.today() - timedelta(days=LOOKBACK_DAYS)).isoformat()
    new = 0
    for page in range(pages):
        r = http.get(f"{amf.API}/informations", params={"TypesInformation": "DD", "From": page * 100, "Size": 100, "Lang": "fr"}, timeout=60)
        if r.status_code != 200:
            break
        results = r.json().get("result") or []
        if not results:
            break
        for info in results:
            jeton = next((s["jeton"] for s in info.get("societes") or [] if s["jeton"] in CAC40), None)
            numero = info.get("numero")
            docs = [d for d in info.get("documents") or [] if d.get("accessible") and d.get("path")]
            if not jeton or not docs or _done(f"AMF:{numero}"):
                continue
            name, ticker = CAC40[jeton]
            try:
                declarant, txs = amf.parse(http.get(f"{amf.API}/documents/{docs[0]['path']}", timeout=60).content)
            except Exception as e:
                log.warning("AMF %s: %s", numero, e)
                continue
            who, _, role = (declarant or "").partition(",")
            published = (info.get("datePublication") or "")[:19]
            _store([(f"FR:{numero}:{i}", "FR", name, ticker, who.strip(), role.strip(), t["action"], t["date"], published,
                     t["volume"], t["price"], t["price"] * t["volume"] if t["price"] and t["volume"] else None, "EUR", 0,
                     amf.PAGE.format(numero)) for i, t in enumerate(txs) if t["action"] in ("BUY", "SELL")])
            _mark(f"AMF:{numero}")
            new += len(txs)
        oldest = (results[-1].get("datePublication") or "")[:10]
        if oldest and oldest < since:
            break
    return new


# --------------------------------------------------------------------------- Allemagne
_BAFIN = "https://portal.mvp.bafin.de/database/DealingsInfo/sucheForm.do"


_DE_ROLES = {"Vorstand": "Membre du directoire", "Aufsichtsrat": "Membre du conseil de surveillance",
             "Geschäftsführer": "Gérant", "Person": "Personne liée à un dirigeant"}


def _de_num(s):
    m = re.search(r"[\d.]+,\d+|[\d.]+", s or "")
    return float(m.group(0).replace(".", "").replace(",", ".")) if m else None


def _de_date(s):
    try:
        return datetime.strptime(s.strip()[:10], "%d.%m.%Y").date().isoformat()
    except ValueError:
        return None


def refresh_de():
    start = (date.today() - timedelta(days=LOOKBACK_DAYS)).strftime("%d.%m.%Y")
    params = {"zeitraum": "3", "zeitraumVon": start, "zeitraumBis": date.today().strftime("%d.%m.%Y"),
              "emittentButton": "Suche Emittent", "emittentIsin": "", "emittentName": "", "meldepflichtigerName": "",
              "d-4000784-e": "1", "6578706f7274": "1", "ergebnis": "true"}
    r = http.get(_BAFIN, params=params, timeout=90)
    if r.status_code != 200 or "Emittent" not in r.text[:200]:
        log.warning("BaFin: réponse inattendue (%s)", r.status_code)
        return 0
    rows = []
    for row in csv.DictReader(io.StringIO(r.content.decode("utf-8-sig")), delimiter=";"):
        isin = (row.get("ISIN") or "").strip() or _DAX_NAMES.get(re.sub(r"[^a-z]", "", (row.get("Emittent") or "").lower()))
        if isin not in DAX:
            continue
        kind = (row.get("Art des Geschäfts") or "").strip().lower()
        action = "BUY" if kind.startswith("kauf") else "SELL" if kind.startswith("verkauf") else None
        if not action or "aktie" not in (row.get("Art des Instruments") or "").lower():
            continue
        name, ticker = DAX[isin]
        role = (row.get("Position / Status") or "").strip()
        role = _DE_ROLES.get(role.split()[0] if role else "", role)
        price, value = _de_num(row.get("Durchschnittspreis")), _de_num(row.get("Aggregiertes Volumen"))
        uid = "DE:" + hashlib.sha1(";".join(row.values()).encode()).hexdigest()[:20]
        rows.append((uid, "DE", name, ticker, row.get("Meldepflichtiger"), role, action,
                     _de_date(row.get("Datum des Geschäfts") or ""), _de_date(row.get("Mitteilungsdatum") or ""),
                     value / price if value and price else None, price, value, "EUR", 0,
                     f"https://portal.mvp.bafin.de/database/DealingsInfo/sucheForm.do?zeitraum=0&emittentIsin={isin}"
                     "&emittentButton=Suche+Emittent&emittentName=&meldepflichtigerName=&ergebnis=true"))
    _store(rows)
    return len(rows)


def refresh():
    for name, fn in (("US", refresh_us), ("FR", refresh_fr), ("DE", refresh_de)):
        try:
            n = fn()
            log.info("initiés %s : %d opérations", name, n)
        except Exception:
            log.exception("initiés %s", name)


def latest(market=None, side=None, limit=300):
    sql, params = "SELECT * FROM insider_trades WHERE trade_date >= date('now', ?)", [f"-{LOOKBACK_DAYS + 15} days"]
    if market:
        sql += " AND market=?"
        params.append(market)
    if side:
        sql += " AND action=?"
        params.append(side)
    rows = db.query(sql + " ORDER BY filed_at DESC, trade_date DESC LIMIT ?", (*params, limit))
    return rows


def clusters(days=30):
    """Achats groupés : au moins 2 initiés différents achètent la même action sur la période (signal le plus suivi)."""
    rows = db.query("""SELECT market, issuer, ticker, COUNT(DISTINCT insider) n, SUM(value) total, MAX(trade_date) last, currency
                       FROM insider_trades WHERE action='BUY' AND trade_date >= date('now', ?)
                       GROUP BY market, issuer HAVING n >= 2 ORDER BY n DESC, total DESC""", (f"-{days} days",))
    for r in rows:
        r["insiders"] = [x["insider"] for x in db.query(
            "SELECT DISTINCT insider FROM insider_trades WHERE action='BUY' AND issuer=? AND trade_date >= date('now', ?)",
            (r["issuer"], f"-{days} days"))]
    return rows
