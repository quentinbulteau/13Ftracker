"""Client HTTP partagé: limitation de débit par hôte + retries."""
import logging
import threading
import time
from urllib.parse import urlparse

import requests

from .config import GENERIC_USER_AGENT, SEC_USER_AGENT

log = logging.getLogger("http")

# Intervalle minimal entre deux requêtes vers un même hôte (secondes).
# SEC: 10 req/s max autorisé -> on reste à ~8/s.
_MIN_INTERVAL = {
    "www.sec.gov": 0.125,
    "data.sec.gov": 0.125,
    "efts.sec.gov": 0.125,
    "api.openfigi.com": 2.5,
    "en.wikipedia.org": 0.5,
    "commons.wikimedia.org": 0.5,
    "upload.wikimedia.org": 0.3,
    "disclosures-clerk.house.gov": 0.3,
    "query1.finance.yahoo.com": 0.25,
    "bdif.amf-france.org": 0.3,
    "news.google.com": 1.0,
    "api.nasdaq.com": 0.5,
    "api.telegram.org": 1.1,
    "raw.githubusercontent.com": 0.2,
}
_last = {}
_locks = {}
_glock = threading.Lock()
_session = requests.Session()


def _throttle(host):
    with _glock:
        lock = _locks.setdefault(host, threading.Lock())
    with lock:
        wait = _MIN_INTERVAL.get(host, 0.1) - (time.monotonic() - _last.get(host, 0))
        if wait > 0:
            time.sleep(wait)
        _last[host] = time.monotonic()


def get(url, *, method="GET", retries=4, timeout=30, **kw):
    host = urlparse(url).hostname or ""
    headers = kw.pop("headers", {}) or {}
    headers.setdefault("User-Agent", SEC_USER_AGENT if host.endswith("sec.gov") else GENERIC_USER_AGENT)
    headers.setdefault("Accept-Encoding", "gzip, deflate")
    delay = 2.0
    for attempt in range(retries + 1):
        _throttle(host)
        try:
            r = _session.request(method, url, headers=headers, timeout=timeout, **kw)
        except requests.RequestException as e:
            if attempt == retries:
                raise
            log.warning("%s %s -> %s, retry in %.0fs", method, url, e, delay)
            time.sleep(delay)
            delay *= 2
            continue
        if r.status_code in (429, 500, 502, 503, 504) and attempt < retries:
            ra = r.headers.get("Retry-After")
            sleep = float(ra) if ra and ra.isdigit() else delay
            log.warning("%s %s -> HTTP %s, retry in %.0fs", method, url, r.status_code, sleep)
            time.sleep(sleep)
            delay *= 2
            continue
        return r
    return r


def post(url, **kw):
    return get(url, method="POST", **kw)
