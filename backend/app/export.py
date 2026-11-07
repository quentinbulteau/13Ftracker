"""Export statique pour GitHub Pages.

Fait un passage complet de scraping, puis écrit toute l'application (front + données JSON + photos)
dans un dossier publiable tel quel. Lancé toutes les 30 min par GitHub Actions
(.github/workflows/update.yml) : aucun serveur ni ordinateur allumé n'est nécessaire.

    python -m backend.app.export --out site
"""
import argparse
import json
import logging
import re
import shutil
import time
from datetime import datetime, timezone
from pathlib import Path

from . import amf, db, house, media, photos, press, prices, sec
from .config import FRONTEND_DIR
from .investors import INVESTORS

prices.BACKGROUND = False  # cours rafraîchis ici, de façon synchrone

from . import main as api  # noqa: E402  (réutilise exactement les réponses de l'API)

log = logging.getLogger("export")
FEED_LIMIT = 200
TRADES_LIMIT = 600
PRICE_BATCH = 300  # tickers « anciens » rafraîchis par passage (limite la durée de chaque exécution)


def _now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def scrape():
    sec.normalize_thousands()
    for inv in INVESTORS:
        try:
            photos.fetch(inv)
            if inv.get("cik"):
                sec.refresh_investor(inv)
        except Exception:
            log.exception("scraping %s", inv["id"])
    try:
        house.refresh()
        db.set_meta("last_house_refresh", _now())
    except Exception:
        log.exception("house")
    for name, fn in (("amf", amf.refresh), ("presse", press.refresh), ("médias", media.refresh)):
        try:
            fn()
        except Exception:
            log.exception(name)


def refresh_prices():
    feed = api.feed(limit=FEED_LIMIT)
    hot = {r.get("ticker") for r in feed} | {t["ticker"] for r in feed for t in r.get("top", [])}
    todo = prices.stale(hot, max_age=20 * 60)
    recent = {r["ticker"] for r in db.query(
        "SELECT DISTINCT ticker FROM trades WHERE ticker IS NOT NULL AND filed_at >= date('now','-400 days')")}
    todo += [t for t in prices.stale(recent - set(todo), max_age=12 * 3600)][:PRICE_BATCH]
    log.info("cours à rafraîchir: %d", len(todo))
    for t in todo:
        prices.fetch(t)


def _write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def write_site(out: Path):
    if out.exists():
        shutil.rmtree(out)
    shutil.copytree(FRONTEND_DIR, out)
    (out / "config.js").write_text("window.TRACKER_STATIC = true;\n", encoding="utf-8")
    (out / ".nojekyll").write_text("")
    a = out / "api"

    # photos (fichier téléchargé ou initiales)
    photo_paths = {}
    for inv in INVESTORS:
        p = photos.cached(inv["id"])
        dest = out / "photos" / (f"{inv['id']}{p.suffix}" if p else f"{inv['id']}.svg")
        dest.parent.mkdir(parents=True, exist_ok=True)
        if p:
            shutil.copyfile(p, dest)
        else:
            dest.write_text(photos.initials_svg(inv), encoding="utf-8")
        photo_paths[inv["id"]] = f"photos/{dest.name}"

    summaries = api.investors()
    for s in summaries:
        s["photo"] = photo_paths[s["id"]]
    _write(a / "investors.json", summaries)

    for inv in INVESTORS:
        i = inv["id"]
        detail = api.investor(i)
        detail["photo"] = photo_paths[i]
        _write(a / "investors" / i / "index.json", detail)
        _write(a / "investors" / i / "trades.json", api.trades(i, limit=TRADES_LIMIT))
        _write(a / "investors" / i / "portfolio.json", api.portfolio(i))
        _write(a / "investors" / i / "press.json", api.entity_press(i))
        _write(a / "investors" / i / "acquisitions.json", api.entity_acquisitions(i))

    _write(a / "feed.json", api.feed(limit=FEED_LIMIT))
    for t in ("investor", "company"):
        _write(a / f"feed-{t}.json", api.feed(limit=FEED_LIMIT, type=t))
        _write(a / f"press-{t}.json", api.press_feed(type=t, limit=80))
    _write(a / "acquisitions.json", api.acquisitions())

    tickers = {r["ticker"] for r in db.query("SELECT DISTINCT ticker FROM holdings WHERE ticker IS NOT NULL "
                                             "UNION SELECT DISTINCT ticker FROM trades WHERE ticker IS NOT NULL")}
    n = 0
    for t in tickers:
        if not re.fullmatch(r"[A-Z0-9.\-]{1,12}", t):
            continue
        act = api.ticker_activity(t)
        if act["holders"] or act["trades"]:
            _write(a / "tickers" / f"{t}.json", act)
            n += 1

    _write(a / "status.json", api.status() | {"mode": "static", "generated_at": _now()})
    log.info("site écrit dans %s (%d investisseurs, %d tickers)", out, len(INVESTORS), n)


def run(out):
    t0 = time.time()
    scrape()
    refresh_prices()
    db.set_meta("last_full_refresh", _now())
    write_site(Path(out))
    log.info("export terminé en %.0f s", time.time() - t0)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="site")
    ap.add_argument("--no-scrape", action="store_true", help="n'écrit que le site à partir de la base existante")
    args = ap.parse_args()
    if args.no_scrape:
        write_site(Path(args.out))
    else:
        run(args.out)
