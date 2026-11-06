"""Résolution CUSIP -> ticker.

Les 13F ne donnent que le CUSIP et un nom abrégé. On interroge OpenFIGI
(gratuit) puis, à défaut, on rapproche le nom de l'émetteur de la liste
officielle SEC company_tickers.json. Résultats mis en cache en base.
"""
import logging
import re

from . import db, http
from .config import OPENFIGI_API_KEY

log = logging.getLogger("cusip")
_sec_names = None

_STOP = {"INC", "CORP", "CORPORATION", "CO", "COMPANY", "LTD", "PLC", "LLC", "LP", "HLDGS", "HOLDINGS",
         "GROUP", "GRP", "THE", "NEW", "DEL", "SA", "NV", "AG", "SE", "CL", "CLASS", "A", "B", "C", "COM", "ADR", "SPONSORED", "LIMITED", "HLDNGS", "HLDG", "PL", "INCORPORATED"}
_ABBR = {"FINL": "FINANCIAL", "INTL": "INTERNATIONAL", "TECHNOLOGIES": "TECH", "TECHNOLOGY": "TECH",
         "SVCS": "SERVICES", "MGMT": "MANAGEMENT", "PPTYS": "PROPERTIES", "COMMUNICATIONS": "COMM",
         "COMMUNICATION": "COMM", "PHARMACEUTICALS": "PHARMA", "AMER": "AMERICA", "BK": "BANK", "INDS": "INDUSTRIES",
         "PETE": "PETROLEUM"}


def _norm(name):
    words = re.sub(r"[^A-Z0-9 ]", " ", (name or "").upper()).split()
    words = [_ABBR.get(w, w) for w in words]
    return " ".join(w for w in words if w not in _STOP)


def _load_sec_names():
    global _sec_names
    if _sec_names is None:
        _sec_names = {}
        try:
            data = http.get("https://www.sec.gov/files/company_tickers.json").json()
            # premier ticker rencontré = classe principale (liste triée par capitalisation)
            for row in data.values():
                _sec_names.setdefault(_norm(row["title"]), row["ticker"])
        except Exception as e:  # pragma: no cover
            log.warning("company_tickers.json indisponible: %s", e)
    return _sec_names


def _figi(cusips, us_only=True):
    out = {}
    batch = 100 if OPENFIGI_API_KEY else 10
    headers = {"Content-Type": "application/json"}
    if OPENFIGI_API_KEY:
        headers["X-OPENFIGI-APIKEY"] = OPENFIGI_API_KEY
    for i in range(0, len(cusips), batch):
        chunk = cusips[i:i + batch]
        jobs = [{"idType": "ID_CUSIP", "idValue": c, **({"exchCode": "US"} if us_only else {})} for c in chunk]
        try:
            r = http.post("https://api.openfigi.com/v3/mapping", json=jobs, headers=headers)
            if r.status_code != 200:
                log.warning("OpenFIGI HTTP %s", r.status_code)
                continue
            for c, res in zip(chunk, r.json()):
                data = res.get("data") or []
                if data:
                    out[c] = (data[0].get("ticker"), data[0].get("name"))
        except Exception as e:
            log.warning("OpenFIGI: %s", e)
    return out


def resolve(pairs):
    """pairs: iterable de (cusip, issuer). Retourne {cusip: ticker|None}."""
    pairs = {c: n for c, n in pairs}
    known = {r["cusip"]: r["ticker"] for r in db.query(
        f"SELECT cusip, ticker FROM cusip_map WHERE cusip IN ({','.join('?' * len(pairs))})", tuple(pairs))} if pairs else {}
    missing = [c for c in pairs if c not in known]
    if missing:
        found = _figi(missing)
        rest = [c for c in missing if c not in found]
        if rest:
            # 1) rapprochement par nom avec la liste SEC (cotations US)
            names = _load_sec_names()
            for c in rest:
                if names.get(_norm(pairs[c])):
                    found[c] = (names[_norm(pairs[c])], None)
            # 2) CUSIP étrangers (CINS) sans cotation US: cotation principale selon OpenFIGI
            rest = [c for c in rest if c not in found]
            if rest:
                found.update(_figi(rest, us_only=False))
        for c in missing:
            ticker, name = found.get(c, (None, None))
            if ticker:
                ticker = ticker.replace("/", ".").replace(" ", ".")
            known[c] = ticker
            db.execute("INSERT OR REPLACE INTO cusip_map(cusip,ticker,name) VALUES(?,?,?)", (c, ticker, name or pairs[c]))
    return known
