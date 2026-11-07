"""Notifications Telegram (gratuites) : envoyées à la fin de chaque mise à jour.

Configuration (secrets GitHub ou variables d'environnement) :
  TELEGRAM_BOT_TOKEN : jeton du bot créé avec @BotFather
  TELEGRAM_CHAT_ID   : identifiant de la conversation (voir README)
  APP_URL            : adresse de l'app, pour les liens (facultatif)
Sans ces variables, rien n'est envoyé. Au tout premier passage, on mémorise la date sans rien envoyer
(pas de rafale d'anciennes déclarations).

Événements notifiés (déclarations officielles uniquement, investisseurs et entreprises français exclus) :
  - un gérant suivi publie un nouveau 13F ;
  - un investisseur suivi dépose un Form 4 ou un 13D/13G ;
  - un élu suivi publie des transactions ;
  - achats d'initiés groupés (≥ 2 dirigeants) ou achat d'initié ≥ 1 M sur les grandes valeurs.
"""
import html
import logging
import os
import time
from datetime import datetime, timedelta, timezone

import requests

from . import db, insiders
from .investors import BY_ID

log = logging.getLogger("notify")
MAX_MESSAGES = 8
SOURCES = {"FORM4": "Form 4", "13D": "13D", "13G": "13G", "HOUSE": "Congrès"}
VERBS = {"BUY": "achète", "SELL": "vend", "STAKE_UP": "déclare une participation", "STAKE_DOWN": "réduit sa participation",
         "EXCHANGE": "échange"}


def _money(v, cur="USD"):
    if v is None:
        return ""
    sym = "€" if cur == "EUR" else "$"
    return f"{v / 1e9:.1f} Md{sym}" if v >= 1e9 else f"{v / 1e6:.1f} M{sym}" if v >= 1e6 else f"{v / 1e3:.0f} k{sym}"


def _events(since, recent):
    app = os.environ.get("APP_URL", "").rstrip("/")
    link = lambda path: f' <a href="{app}/#{path}">voir</a>' if app else ""
    out = []
    for f in db.query("""SELECT f.investor_id, f.period, MAX(f.filed_at) filed FROM filings f WHERE f.source='13F' AND f.detected_at > ?
                         AND f.filed_at >= ? GROUP BY f.investor_id, f.period""", (since, recent)):
        inv = BY_ID.get(f["investor_id"])
        if not inv or inv["category"] == "fr" or f["period"] != db.one(
                "SELECT MAX(period) p FROM holdings WHERE investor_id=?", (f["investor_id"],))["p"]:
            continue
        n = db.one("""SELECT SUM(action='NEW') n, SUM(action='EXIT') x, COUNT(*) c FROM trades WHERE investor_id=? AND source='13F'
                      AND trade_date=?""", (f["investor_id"], f["period"]))
        out.append(f"📄 <b>{html.escape(inv['name'])}</b> publie son 13F ({f['period']}) : {n['n'] or 0} nouvelle(s) ligne(s), "
                   f"{n['x'] or 0} sortie(s), {n['c'] or 0} variation(s)." + link(f"/i/{inv['id']}/trades"))
    groups = {}  # une notification par investisseur / action / sens, pas une par ligne de déclaration
    for t in db.query("""SELECT * FROM trades WHERE detected_at > ? AND filed_at >= ? AND source IN ('FORM4','13D','13G','HOUSE')
                         AND action != 'OTHER' ORDER BY filed_at""", (since, recent)):
        inv = BY_ID.get(t["investor_id"])
        if not inv or inv["category"] == "fr" or inv["type"] != "investor":
            continue
        g = groups.setdefault((inv["id"], t["ticker"] or t["issuer"], t["action"], t["source"]), {"inv": inv, "t": t, "value": 0, "n": 0})
        g["value"] += t["value"] or 0
        g["n"] += 1
        g["t"] = t  # garde la dernière (pourcentage le plus récent pour un 13D)
    for (_, name, action, source), g in groups.items():
        t = g["t"]
        amount = f"{t['pct']:.1f} % du capital".replace(".", ",") if t["pct"] is not None else (
            _money(g["value"] or None) or (f"{_money(t['value_low'])}–{_money(t['value_high'])}" if t["value_low"] else ""))
        many = f" en {g['n']} opérations" if g["n"] > 1 else ""
        out.append(f"🔔 <b>{html.escape(g['inv']['name'])}</b> {VERBS.get(action, action)} <b>{html.escape(name or '')}</b> "
                   f"{amount}{many} ({SOURCES.get(source, source)})" + link(f"/i/{g['inv']['id']}/trades"))
    for c in insiders.clusters(days=30):
        if c["market"] == "FR":
            continue
        last = db.one("SELECT MAX(detected_at) d FROM insider_trades WHERE issuer=? AND action='BUY'", (c["issuer"],))["d"]
        if last and last > since:
            out.append(f"👥 Achats groupés : <b>{c['n']} dirigeants de {html.escape(c['issuer'])}</b> ont acheté "
                       f"({_money(c['total'], c['currency'])} sur 30 jours)." + link(f"/s/{c['ticker']}"))
    for t in db.query("""SELECT * FROM insider_trades WHERE detected_at > ? AND action='BUY' AND value >= 1000000 AND market != 'FR'
                         AND filed_at >= ?""", (since, recent)):
        out.append(f"💰 {html.escape(t['insider'] or '')} ({html.escape(t['role'] or 'dirigeant')}) achète pour "
                   f"<b>{_money(t['value'], t['currency'])}</b> d'actions <b>{html.escape(t['issuer'])}</b>." + link(f"/s/{t['ticker']}"))
    return out


def run():
    token, chat = os.environ.get("TELEGRAM_BOT_TOKEN"), os.environ.get("TELEGRAM_CHAT_ID")
    # même format que les colonnes detected_at de SQLite (datetime('now')) : "AAAA-MM-JJ HH:MM:SS"
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    since = db.get_meta("notify_since")
    db.set_meta("notify_since", now)
    if not token or not chat or not since:
        return 0
    recent = (datetime.utcnow() - timedelta(days=4)).isoformat()[:10]  # jamais d'anciennes déclarations rattrapées
    msgs = _events(since, recent)
    if len(msgs) > MAX_MESSAGES:
        msgs = msgs[:MAX_MESSAGES - 1] + [f"… et {len(msgs) - MAX_MESSAGES + 1} autre(s) déclaration(s) dans l'app."]
    for m in msgs:
        # appel direct, sans le client partagé : l'URL contient le jeton et ne doit jamais apparaître dans les journaux
        try:
            r = requests.post(f"https://api.telegram.org/bot{token}/sendMessage", timeout=20,
                              json={"chat_id": chat, "text": m, "parse_mode": "HTML", "disable_web_page_preview": True})
            if r.status_code != 200:
                log.warning("Telegram : HTTP %s", r.status_code)
        except requests.RequestException as e:
            log.warning("Telegram : %s", type(e).__name__)
        time.sleep(1.1)
    log.info("%d notification(s) envoyée(s)", len(msgs))
    return len(msgs)
