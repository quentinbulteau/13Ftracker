"""Configuration (surchargée par variables d'environnement)."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = Path(os.environ.get("TRACKER_DATA_DIR", ROOT / "data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA_DIR / "tracker.db"
PHOTO_DIR = DATA_DIR / "photos"
PHOTO_DIR.mkdir(parents=True, exist_ok=True)
FRONTEND_DIR = ROOT / "frontend"

# La SEC exige un User-Agent identifiant l'appelant ("Nom contact@domaine").
# Sans cela, data.sec.gov renvoie 403 tôt ou tard. À définir en production.
SEC_USER_AGENT = os.environ.get("SEC_USER_AGENT", "13Ftracker/0.1 contact@example.com")
GENERIC_USER_AGENT = "13Ftracker/0.1 (open-source investor disclosure tracker)"
OPENFIGI_API_KEY = os.environ.get("OPENFIGI_API_KEY")  # optionnel: lève la limite de débit

# Fréquences de scraping (secondes)
LIVE_FEED_INTERVAL = int(os.environ.get("LIVE_FEED_INTERVAL", 60))       # flux EDGAR temps réel
HOUSE_INTERVAL = int(os.environ.get("HOUSE_INTERVAL", 15 * 60))           # index Chambre des représentants
FULL_REFRESH_INTERVAL = int(os.environ.get("FULL_REFRESH_INTERVAL", 6 * 3600))  # filet de sécurité

FORM4_LOOKBACK_DAYS = int(os.environ.get("FORM4_LOOKBACK_DAYS", 365))
FORM4_MAX_FILINGS = int(os.environ.get("FORM4_MAX_FILINGS", 80))
HOUSE_YEARS_BACK = int(os.environ.get("HOUSE_YEARS_BACK", 1))  # année courante + N précédentes
DISABLE_SCHEDULER = os.environ.get("DISABLE_SCHEDULER") == "1"
