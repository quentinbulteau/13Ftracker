"""Stockage SQLite."""
import sqlite3
import threading
from contextlib import contextmanager

from .config import DB_PATH

_lock = threading.RLock()
_conn = sqlite3.connect(DB_PATH, check_same_thread=False, isolation_level=None)
_conn.row_factory = sqlite3.Row
_conn.execute("PRAGMA journal_mode=WAL")

SCHEMA = """
CREATE TABLE IF NOT EXISTS filings (
    accession   TEXT PRIMARY KEY,
    investor_id TEXT NOT NULL,
    source      TEXT NOT NULL,          -- 13F | FORM4 | HOUSE
    form        TEXT,
    filed_at    TEXT,                   -- date/heure de dépôt (publication)
    period      TEXT,                   -- fin de trimestre (13F) / date d'opération
    url         TEXT,
    processed   INTEGER DEFAULT 1,
    detected_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_filings_inv ON filings(investor_id, source, period);

CREATE TABLE IF NOT EXISTS holdings (
    investor_id TEXT NOT NULL,
    period      TEXT NOT NULL,
    cusip       TEXT NOT NULL,
    put_call    TEXT NOT NULL DEFAULT '',
    issuer      TEXT,
    title       TEXT,
    ticker      TEXT,
    shares      REAL,
    value       REAL,
    accession   TEXT,
    PRIMARY KEY (investor_id, period, cusip, put_call)
);

CREATE TABLE IF NOT EXISTS trades (
    uid         TEXT PRIMARY KEY,
    investor_id TEXT NOT NULL,
    source      TEXT NOT NULL,          -- 13F | FORM4 | HOUSE
    action      TEXT NOT NULL,          -- BUY | SELL | NEW | ADD | REDUCE | EXIT | EXCHANGE
    trade_date  TEXT,                   -- date de l'opération (ou fin de trimestre pour 13F)
    filed_at    TEXT,                   -- date de publication
    ticker      TEXT,
    issuer      TEXT,
    asset_type  TEXT,
    shares      REAL,
    price       REAL,
    value       REAL,
    value_low   REAL,
    value_high  REAL,
    shares_after REAL,
    owner       TEXT,
    details     TEXT,
    url         TEXT,
    detected_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_trades_inv ON trades(investor_id, trade_date);
CREATE INDEX IF NOT EXISTS ix_trades_filed ON trades(filed_at);
CREATE INDEX IF NOT EXISTS ix_trades_ticker ON trades(ticker);

CREATE TABLE IF NOT EXISTS cusip_map (
    cusip  TEXT PRIMARY KEY,
    ticker TEXT,
    name   TEXT
);

CREATE TABLE IF NOT EXISTS house_docs (
    doc_id      TEXT PRIMARY KEY,
    investor_id TEXT,
    filed_at    TEXT,
    status      TEXT                    -- ok | no_text | error
);

CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT
);
"""

with _lock:
    _conn.executescript(SCHEMA)
    # migrations légères
    cols = {r[1] for r in _conn.execute("PRAGMA table_info(trades)")}
    if "actor_id" not in cols:  # investisseur suivi à l'origine d'une déclaration AMF (ex. Bolloré pour Vivendi)
        _conn.execute("ALTER TABLE trades ADD COLUMN actor_id TEXT")
        _conn.execute("CREATE INDEX IF NOT EXISTS ix_trades_actor ON trades(actor_id)")
    if "report_date" not in cols:  # "Period of report" du Form 4
        _conn.execute("ALTER TABLE trades ADD COLUMN report_date TEXT")
        _conn.execute("""UPDATE trades SET report_date=(SELECT period FROM filings WHERE accession=substr(trades.uid,4,20))
                         WHERE source='FORM4'""")


@contextmanager
def tx():
    with _lock:
        _conn.execute("BEGIN")
        try:
            yield _conn
            _conn.execute("COMMIT")
        except Exception:
            _conn.execute("ROLLBACK")
            raise


def query(sql, params=()):
    with _lock:
        return [dict(r) for r in _conn.execute(sql, params).fetchall()]


def one(sql, params=()):
    rows = query(sql, params)
    return rows[0] if rows else None


def execute(sql, params=()):
    with _lock:
        return _conn.execute(sql, params)


def set_meta(key, value):
    execute("INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, str(value)))


def get_meta(key, default=None):
    r = one("SELECT value FROM meta WHERE key=?", (key,))
    return r["value"] if r else default
