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

## Organisation : jamais de mélange

- **Deux espaces séparés** : *Investisseurs* (gérants US, élus US, investisseurs français) et *Entreprises*
  (IA & tech, sociétés françaises cotées).
- **Officiel vs non officiel** : chaque fiche sépare les déclarations réglementaires (onglets « Achats & ventes »,
  « Portefeuille », « Déclarations AMF »…) de l'onglet orange **« Presse & rumeurs »**. Le flux a deux modes : *Officiel*
  et *Presse & rumeurs*. Chaque information non officielle porte un statut : *Presse*, *Déclaration publique*
  (propos de l'investisseur sur X, Substack…) ou *Rumeur*, avec ses sources.

| Source | Statut | Contenu |
|---|---|---|
| SEC 13F / Form 4 | officiel | portefeuilles et transactions des gérants US |
| Chambre des représentants (STOCK Act) | officiel | transactions des élus |
| AMF – déclarations des dirigeants (BDIF) | officiel | achats/ventes des dirigeants de sociétés cotées à Paris et de leurs holdings (Bolloré, Arnault, Pinault…) |
| « Médias français, qui possède quoi ? » (Le Monde diplomatique & Acrimed, ODC-By) | données publiques | chaîne de détention des médias des milliardaires (fin 2024) |
| `backend/data/curated.json` | saisi à la main, sourcé | rachats de startups de l'IA, rumeurs et déclarations publiques, rachats de médias récents |
| Google News (RSS) | non officiel | articles de presse par investisseur / entreprise, et articles associés à chaque rachat |

### Classement des gérants (3 / 6 / 12 mois)

Calculé à partir des 13F des 6 derniers trimestres : à chaque fin de trimestre, les 60 plus grosses positions
déclarées (pondérées par leur valeur) sont conservées jusqu'au trimestre suivant, avec les cours quotidiens.
Deux mesures : *portefeuille déclaré* (rebalancement en fin de trimestre) et *copie* (rebalancement à la publication
du 13F, ce qu'obtient réellement un suiveur). Référence : S&P 500 (SPY). Limites : ni ventes à découvert, ni cash,
ni actifs hors US, ni opérations en cours de trimestre.

### Alertes d'initiés (Top 100 US, CAC 40, DAX)

| Marché | Source officielle | Délai |
|---|---|---|
| 100 premières sociétés américaines (liste SEC triée par capitalisation, sociétés déposant un 10-K) | SEC Form 4 | ≤ 2 jours ouvrés |
| CAC 40 (36 valeurs déclarant à l'AMF ; Airbus, Stellantis, STMicro, ArcelorMittal déclarent à l'étranger) | AMF – BDIF | ≤ 3 jours ouvrés |
| DAX (Airbus et Qiagen, de droit néerlandais, n'y figurent pas) | BaFin – Directors' Dealings | ≤ 3 jours ouvrés |

Seuls les achats et ventes sur le marché sont retenus. Les ventes américaines programmées (plan 10b5-1) sont
signalées. « Achats groupés » = au moins deux dirigeants d'une même société achètent en 30 jours.
Les compositions du CAC 40 et du DAX sont dans `backend/app/insiders.py` (à mettre à jour lors des révisions d'indices).

### Notifications Telegram (gratuites)

L'app envoie un message à chaque mise à jour quand il se passe quelque chose : nouveau 13F d'un gérant suivi,
Form 4 ou 13D/13G d'un investisseur, transactions d'élus, achats d'initiés groupés ou supérieurs à 1 M.
Les déclarations françaises ne sont pas notifiées.

1. Dans Telegram, ouvrir **@BotFather**, envoyer `/newbot`, choisir un nom : il donne un **jeton** (`123456:ABC…`).
2. Envoyer un message quelconque à ce nouveau bot.
3. Ouvrir `https://api.telegram.org/bot<JETON>/getUpdates` dans un navigateur : relever `"chat":{"id": …}`.
4. Sur GitHub : Settings → Secrets and variables → Actions → ajouter `TELEGRAM_BOT_TOKEN` (le jeton) et
   `TELEGRAM_CHAT_ID` (l'identifiant).

Au premier passage l'app mémorise la date sans rien envoyer, pour ne pas rattraper d'anciennes déclarations.

### Autres écrans

- **Fiche action** (`#/s/TICKER`) : cours sur un an, toutes les opérations déclarées (fonds, élus, 13D/13G,
  dirigeants), fonds détenteurs, éligibilité PEA, date des prochains résultats.
- **Consensus des gérants** (onglet Classement) : actions les plus achetées / vendues par les fonds suivis au
  dernier trimestre publié.
- **Agenda** : échéance légale des 13F (45 jours après le trimestre) et résultats à venir des actions détenues
  (calendrier Nasdaq).
- **Filtre PEA** (onglet Initiés) : valeurs du CAC 40 et du DAX ; les actions américaines n'y sont pas éligibles.
- Les investisseurs et sociétés françaises sont masqués des fils par défaut : filtre « Investisseurs français »
  ou « Sociétés françaises » pour les voir.

### Ajouter une rumeur ou un rachat

Éditer `backend/data/curated.json` : chaque entrée a une date, un statut (`officiel`, `presse`, `declaration`,
`rumeur`), un résumé et au moins une source (titre + lien). Les articles de presse liés aux rachats sont ensuite
trouvés automatiquement. Ne jamais ajouter une information sans source.

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
