# 13F Tracker

Application mobile (PWA) qui suit les actions détenues, achetées et vendues par les grands investisseurs,
en scrapant directement les déclarations obligatoires officielles :

| Source | Qui | Délai légal de publication | Ce qu'on en tire |
|---|---|---|---|
| **SEC Form 4** | dirigeants et actionnaires > 10 % (Berkshire, Icahn, Pershing, Gates…) | ≤ 2 jours ouvrés | achats/ventes exacts (date, quantité, prix) |
| **SEC 13F-HR** | gérants > 100 M$ (fonds, family offices, entreprises) | ≤ 45 jours après la fin du trimestre | portefeuille complet + variations d'un trimestre à l'autre |
| **STOCK Act (PTR)** | élus de la Chambre des représentants | ≤ 45 jours après l'opération | achats/ventes par tranches de montant |

Chaque investisseur a une photo (Wikipédia/Wikimedia Commons, ou initiales à défaut), un onglet
**Achats & ventes** et un onglet **Portefeuille**.

## Rapidité de détection

- **Flux EDGAR temps réel** interrogé toutes les 60 s (`getcurrent` pour 13F-HR et Form 4) : dès qu'un investisseur suivi
  dépose, son dossier est re-scrapé immédiatement → l'info est dans l'app quelques minutes après sa publication par la SEC.
- **Index de la Chambre** (`{année}FD.zip`) relu toutes les 15 min ; seuls les nouveaux PDF sont téléchargés et parsés.
- Rafraîchissement complet toutes les 6 h (filet de sécurité).
- Côté app : le flux et le badge « Flux » se mettent à jour chaque minute ; notification navigateur optionnelle (activée au premier ajout en favori).
- Dans l'onglet Portefeuille, une position est annotée si un **Form 4 postérieur au 13F** a modifié la ligne.
- Chaque mouvement du portefeuille affiche sa date : exacte si un Form 4 existe, sinon le trimestre du 13F.
- Un 13F (des dizaines de variations publiées d'un coup) apparaît dans le flux comme **une seule carte** récapitulative.
- Les Form 4 affichent la **période du rapport** (`periodOfReport`) déclarée à la SEC.

## Évolution du cours depuis le dépôt

Chaque transaction affiche la variation du cours entre la **dernière clôture avant publication** (heure de New York)
et le dernier cours connu. Cours issus de l'API publique non officielle de Yahoo Finance, en cache 15 min
(données gratuites, retardées, sans garantie de disponibilité).

## Version en ligne, sans ordinateur (GitHub Actions + Pages)

Le workflow `.github/workflows/update.yml` scrape les déclarations **toutes les 30 min** sur les serveurs de GitHub
et publie l'app sur GitHub Pages (`https://<compte>.github.io/13Ftracker/`). Gratuit si le dépôt est public.

Mise en place (une fois) :
1. Settings → General → Danger Zone → **Change visibility → Public**.
2. Settings → Pages → Source : **GitHub Actions**.
3. Settings → Secrets and variables → Actions → **New repository secret** : `SEC_USER_AGENT` = `Nom email@domaine`.
4. Actions → « Mise à jour des données » → **Run workflow** (le premier passage prend ~15 min).

Dans cette version figée, les données sont des fichiers JSON (`python -m backend.app.export --out site`),
la recherche se fait sur le téléphone. GitHub désactive les tâches planifiées d'un dépôt public après
60 jours sans commit : il suffit alors de cliquer sur « Enable workflow » dans l'onglet Actions.

## Lancer en local (temps réel, 1 min)

```bash
pip install -r backend/requirements.txt
export SEC_USER_AGENT="VotreNom votre@email.com"   # exigé par la SEC (sinon 403)
uvicorn backend.app.main:app --host 0.0.0.0 --port 8000
```

Puis ouvrir http://localhost:8000 sur le téléphone (même réseau) → « Ajouter à l'écran d'accueil ».

Le premier scraping complet prend ~10-15 min (résolution CUSIP → ticker limitée à 25 req/min sans clé).
Une clé gratuite OpenFIGI (`OPENFIGI_API_KEY`) le ramène à ~2 min.

Avec Docker :

```bash
docker build -t 13ftracker .
docker run -p 8000:8000 -e SEC_USER_AGENT="VotreNom votre@email.com" -v $PWD/data:/app/data 13ftracker
```

### Variables d'environnement

| Variable | Défaut | Rôle |
|---|---|---|
| `SEC_USER_AGENT` | `13Ftracker/0.1 contact@example.com` | identification obligatoire auprès de la SEC |
| `OPENFIGI_API_KEY` | — | accélère la résolution CUSIP → ticker |
| `LIVE_FEED_INTERVAL` | 60 | secondes entre deux lectures du flux EDGAR |
| `HOUSE_INTERVAL` | 900 | secondes entre deux lectures de l'index de la Chambre |
| `FORM4_LOOKBACK_DAYS` | 365 | historique Form 4 importé |
| `TRACKER_DATA_DIR` | `./data` | base SQLite + cache des photos |

## Ajouter un investisseur

Éditer `backend/app/investors.py` :
- fonds/entreprise : son **CIK** SEC (recherche sur https://www.sec.gov/edgar/searchedgar/companysearch) ;
- élu de la Chambre : nom, prénom, État ;
- photo : titre de page Wikipédia (`wiki`), fichier Commons (`photo_file`), ou déposer `data/photos/<id>.jpg`.

## Architecture

```
backend/app/
  sec.py        13F (information table XML) + Form 4 (XML) + flux EDGAR temps réel
  house.py      index XML + parsing des PDF PTR de la Chambre
  cusip.py      CUSIP -> ticker (OpenFIGI, puis rapprochement par nom avec la liste SEC)
  photos.py     photos Wikipédia/Commons mises en cache
  prices.py     cours de bourse (Yahoo Finance) et évolution depuis le dépôt
  scheduler.py  boucles de scraping en arrière-plan
  main.py       API REST (FastAPI) + service du front
frontend/       PWA vanilla JS (aucun build)
```

API : `/api/investors`, `/api/investors/{id}`, `/api/investors/{id}/trades`, `/api/investors/{id}/portfolio`,
`/api/feed`, `/api/search?q=`, `/api/status`.

## Limites (à connaître)

- **13F ≠ transactions** : c'est une photo trimestrielle publiée jusqu'à 45 j après ; les « achats/ventes » sont
  des différences entre deux trimestres (ni date ni prix exacts). Pas de positions short, ni d'actifs non US, ni de cash.
- **Élus** : montants par tranches, publication jusqu'à 45 j après. Pas de portefeuille officiel en continu → l'onglet
  Portefeuille est une estimation à partir des transactions. Les dépôts papier scannés ne sont pas lus (pas d'OCR).
- **Sénat** non inclus : le site efdsearch.senate.gov impose d'accepter des conditions d'utilisation (interdiction
  d'usage commercial) avant toute consultation ; à ajouter seulement si ces conditions sont acceptées en connaissance de cause.
- **Investisseurs non US** (ex. Vincent Bolloré) : pas couverts par la SEC ; il faudrait scraper les déclarations
  de franchissement de seuil et de dirigeants de l'AMF.
- **Donald Trump** : ses déclarations passent par l'OGE (formulaires 278-T en PDF), non couvertes ici.
- Une partie des photos n'existe pas sous licence libre sur Wikipédia → initiales en remplacement.
