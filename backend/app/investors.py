"""Entités suivies : investisseurs d'un côté, entreprises de l'autre.

type      : "investor" | "company"   (jamais mélangés dans l'interface)
category  : investor -> "us_fund" (gérants US), "us_politician" (élus US), "fr" (investisseurs français)
            company  -> "ai" (IA & tech), "fr" (sociétés françaises cotées)
kind      : détail technique de la source de données
  - "fund"        : 13F-HR (portefeuille trimestriel) + Form 4 (≤ 2 jours ouvrés)
  - "politician"  : Periodic Transaction Reports de la Chambre (STOCK Act, ≤ 45 jours)
  - "fr_investor" : déclarations de dirigeants AMF (via ses sociétés) + médias détenus (Le Monde diplomatique)
  - "company"     : entreprise (13F éventuel + rachats de startups)
  - "fr_company"  : société cotée à Paris -> déclarations des dirigeants AMF (≤ 3 jours ouvrés)

Photo : wiki (titre Wikipédia), photo_file (fichier Wikimedia Commons), ou data/photos/<id>.jpg.
inactive : texte affiché quand la source officielle ne publie plus (ex. fonds fermé).
press : requête Google News pour l'onglet « Presse & rumeurs ».
"""

_FUNDS = [
    ("buffett", "Warren Buffett", "Berkshire Hathaway", 1067983, "Warren_Buffett"),
    ("burry", "Michael Burry", "Scion Asset Management", 1649339, "Michael_Burry"),
    ("druckenmiller", "Stanley Druckenmiller", "Duquesne Family Office", 1536411, "Stanley_Druckenmiller"),
    ("ackman", "Bill Ackman", "Pershing Square", 1336528, "Bill_Ackman"),
    ("dalio", "Ray Dalio", "Bridgewater Associates", 1350694, "Ray_Dalio"),
    ("tepper", "David Tepper", "Appaloosa", 1656456, "David_Tepper"),
    ("klarman", "Seth Klarman", "Baupost Group", 1061768, "Seth_Klarman"),
    ("icahn", "Carl Icahn", "Icahn Enterprises", 921669, "Carl_Icahn"),
    ("marks", "Howard Marks", "Oaktree Capital", 949509, "Howard_Marks_(investor)"),
    ("hohn", "Chris Hohn", "TCI Fund Management", 1647251, "Christopher_Hohn"),
    ("akre", "Chuck Akre", "Akre Capital Management", 1112520, None),
    ("rochon", "François Rochon", "Giverny Capital", 1641864, None),
    ("watsa", "Prem Watsa", "Fairfax Financial", 915191, "Prem_Watsa"),
    ("peltz", "Nelson Peltz", "Trian Fund Management", 1345471, "Nelson_Peltz"),
    ("singer", "Paul Singer", "Elliott Management", 1791786, "Paul_Singer_(businessman)"),
    ("duan", "Duan Yongping", "H&H International", 1759760, "Duan_Yongping"),
    ("russo", "Tom Russo", "Gardner Russo & Quinn", 860643, None),
    ("ainslie", "Lee Ainslie", "Maverick Capital", 934639, "Lee_Ainslie"),
    ("sundheim", "Dan Sundheim", "D1 Capital Partners", 1747057, None),
    ("gerstner", "Brad Gerstner", "Altimeter Capital", 1541617, None),
    ("aschenbrenner", "Leopold Aschenbrenner", "Situational Awareness LP", 2045724, None),
    ("lilu", "Li Lu", "Himalaya Capital", 1709323, "Li_Lu"),
    ("terrysmith", "Terry Smith", "Fundsmith", 1569205, "Terry_Smith_(fund_manager)"),
    ("cathiewood", "Cathie Wood", "ARK Invest", 1697748, "Cathie_Wood"),
    ("gates", "Bill Gates", "Gates Foundation Trust", 1166559, "Bill_Gates"),
    ("soros", "George Soros", "Soros Fund Management", 1029160, "George_Soros"),
    ("pabrai", "Mohnish Pabrai", "Dalal Street LLC", 1549575, "Mohnish_Pabrai"),
    ("coleman", "Chase Coleman", "Tiger Global", 1167483, "Chase_Coleman_III"),
    ("loeb", "Dan Loeb", "Third Point", 1040273, "Daniel_S._Loeb"),
    ("halvorsen", "Andreas Halvorsen", "Viking Global", 1103804, "Andreas_Halvorsen"),
    ("laffont", "Philippe Laffont", "Coatue Management", 1135730, "Philippe_Laffont"),
    ("mandel", "Stephen Mandel", "Lone Pine Capital", 1061165, "Stephen_Mandel"),
    ("gayner", "Tom Gayner", "Markel Group", 1096343, "Markel_Group"),
]

_POLITICIANS = [
    ("pelosi", "Nancy Pelosi", "D-CA", "Pelosi", "Nancy", "CA", "Nancy_Pelosi"),
    ("gottheimer", "Josh Gottheimer", "D-NJ", "Gottheimer", "Josh", "NJ", "Josh_Gottheimer"),
    ("sessions", "Pete Sessions", "R-TX", "Sessions", "Pete", "TX", "Pete_Sessions"),
    ("austinscott", "Austin Scott", "R-GA", "Scott", "Austin", "GA", "Austin_Scott_(politician)"),
    ("suozzi", "Thomas Suozzi", "D-NY", "Suozzi", "Thomas", "NY", "Tom_Suozzi"),
    ("khanna", "Ro Khanna", "D-CA", "Khanna", "Ro", "CA", "Ro_Khanna"),
    ("mccaul", "Michael McCaul", "R-TX", "McCaul", "Michael", "TX", "Michael_McCaul"),
    ("bresnahan", "Rob Bresnahan", "R-PA", "Bresnahan", "Rob", "PA", "Rob_Bresnahan"),
    ("moskowitz", "Jared Moskowitz", "D-FL", "Moskowitz", "Jared", "FL", "Jared_Moskowitz"),
    ("hern", "Kevin Hern", "R-OK", "Hern", "Kevin", "OK", "Kevin_Hern"),
]

# Sociétés françaises cotées : jeton = identifiant de la société dans la base BDIF de l'AMF
_FR_COMPANIES = [
    ("bollore_se", "Bolloré SE", "Holding · transport, médias", "RS00000987", "BOL.PA", "Bolloré"),
    ("odet", "Compagnie de l'Odet", "Holding de tête du groupe Bolloré", "RS00000990", "ODET.PA", "Compagnie_de_l'Odet"),
    ("vivendi", "Vivendi", "Groupe Bolloré · médias", "RS00002343", "VIV.PA", "Vivendi"),
    ("canalplus", "Canal+", "Groupe Bolloré · TV (coté à Londres)", "RS00008525", "CAN.L", "Canal+_(company)"),
    ("louishachette", "Louis Hachette Group", "Groupe Bolloré · édition, presse", "RS00008221", "ALHG.PA", "Louis_Hachette_Group"),
    ("lagardere", "Lagardère", "Groupe Bolloré · Europe 1, JDD, Paris Match", "RS00003417", "MMB.PA", "Lagardère_Group"),
    ("lvmh", "LVMH", "Groupe Arnault · Les Echos, Le Parisien", "RS00001689", "MC.PA", "LVMH"),
    ("dior", "Christian Dior", "Holding du groupe Arnault", "RS00003361", "CDI.PA", "Christian_Dior_SE"),
    ("kering", "Kering", "Groupe Pinault · Le Point (via Artémis)", "RS00003337", "KER.PA", "Kering"),
    ("bouygues", "Bouygues", "Groupe Bouygues · TF1", "RS00001454", "EN.PA", "Bouygues"),
    ("m6", "M6 Groupe", "Télévision", "RS00002148", "MMT.PA", "M6_Group"),
    ("fnacdarty", "Fnac Darty", "Actionnaire de référence : D. Křetínský", "RS00005518", "FNAC.PA", "Fnac_Darty"),
]

# Investisseurs français : amf = noms à reconnaître parmi les déclarants AMF (en minuscules)
#                          mdiplo = nom dans « Médias français, qui possède quoi ? »
_FR_INVESTORS = [
    ("bollore", "Vincent Bolloré", "Groupe Bolloré (Vivendi, Canal+, Louis Hachette)", "Vincent_Bolloré", "Vincent Bolloré",
     ["bolloré", "bollore", "cornouaille", "compagnie de l'odet", "sofibol", "financière v", "omnium bolloré"]),
    ("arnault", "Bernard Arnault", "LVMH · Financière Agache", "Bernard_Arnault", "Bernard Arnault",
     ["arnault", "agache", "jean goujon"]),
    ("pinault", "François Pinault", "Artémis · Kering", "François_Pinault", "François Pinault", ["pinault", "artémis", "artemis"]),
    ("niel", "Xavier Niel", "Iliad · NJJ", "Xavier_Niel", "Xavier Niel", ["xavier niel", "njj"]),
    ("saade", "Rodolphe Saadé", "CMA CGM · BFMTV, RMC, La Provence", "Rodolphe_Saadé", "Rodolphe Saadé", ["saadé", "saade", "cma cgm"]),
    ("kretinsky", "Daniel Křetínský", "EPH · CMI France · Fnac Darty", "Daniel_Křetínský", "Daniel Křetínský",
     ["kretinsky", "křetínský", "vesa equity", "ep equity"]),
    ("drahi", "Patrick Drahi", "Altice", "Patrick_Drahi", "Patrick Drahi", ["drahi", "altice"]),
    ("bouygues_fam", "Martin Bouygues", "Famille Bouygues · TF1", "Martin_Bouygues", "Famille Bouygues", ["scdm", "martin bouygues", "olivier bouygues"]),
    ("pigasse", "Matthieu Pigasse", "Combat Media · Les Inrocks, Radio Nova", "Matthieu_Pigasse", "Matthieu Pigasse", ["pigasse"]),
    ("sterin", "Pierre-Édouard Stérin", "Otium Capital", "Pierre-Édouard_Stérin", None, ["stérin", "sterin", "otium"]),
]

# Entreprises de l'IA : rachats de startups (liste vérifiée + presse), 13F si l'entreprise en dépose un
_AI = [
    ("alphabet", "Google", "Alphabet Inc.", 1652044, "Google_2015_logo.svg", None),
    ("nvidia", "NVIDIA", "NVIDIA Corp.", 1045810, "Nvidia_logo.svg", None),
    ("openai", "OpenAI", "Non cotée", None, "OpenAI_Logo.svg", "OpenAI"),
    ("anthropic", "Anthropic", "Non cotée", None, "Anthropic_logo.svg", "Anthropic"),
    ("mistral", "Mistral AI", "Non cotée · Paris", None, "Mistral_AI_logo_(2025–).svg", "Mistral_AI"),
]

ENTITIES = []
for i, name, sub, cik, wiki in _FUNDS:
    ENTITIES.append({"id": i, "name": name, "subtitle": sub, "type": "investor", "category": "us_fund", "kind": "fund",
                     "cik": cik, "wiki": wiki, "press": f'"{name}" (stake OR buys OR sells OR position OR bet OR portfolio)', "lang": "en"})
for i, name, party, last, first, state, wiki in _POLITICIANS:
    ENTITIES.append({"id": i, "name": name, "subtitle": f"Chambre des représentants ({party})", "type": "investor",
                     "category": "us_politician", "kind": "politician", "house": {"last": last, "first": first, "state": state},
                     "wiki": wiki, "press": f'"{name}" (stock OR stocks OR trade OR shares)', "lang": "en"})
for i, name, sub, wiki, mdiplo, amf in _FR_INVESTORS:
    ENTITIES.append({"id": i, "name": name, "subtitle": sub, "type": "investor", "category": "fr", "kind": "fr_investor",
                     "wiki": wiki, "mdiplo": mdiplo, "amf": amf, "lang": "fr",
                     "press": f'"{name}" (rachat OR rachète OR participation OR actionnaire OR cède OR acquiert OR investit)'})
for i, name, sub, cik, logo, wiki in _AI:
    ENTITIES.append({"id": i, "name": name, "subtitle": sub, "type": "company", "category": "ai", "kind": "company",
                     "cik": cik, "photo_file": logo, "wiki": wiki, "logo": True,
                     "press": f'"{name}" (acquires OR acquisition OR acquire OR stake)', "lang": "en"})
for i, name, sub, jeton, ticker, wiki in _FR_COMPANIES:
    ENTITIES.append({"id": i, "name": name, "subtitle": sub, "type": "company", "category": "fr", "kind": "fr_company",
                     "jeton": jeton, "ticker": ticker, "wiki": wiki, "logo": True, "lang": "fr",
                     "press": f'"{name}" (rachat OR acquisition OR actionnaire OR cession OR participation)'})

ENTITIES[1]["inactive"] = ("Scion a cessé de déposer des 13F après celui du 30 septembre 2025 : Michael Burry ne publie "
                           "plus ses positions que sur son Substack « Cassandra Unchained » et sur X (voir Presse & rumeurs).")

INVESTORS = ENTITIES  # compatibilité avec le reste du code
BY_ID = {e["id"]: e for e in ENTITIES}
BY_CIK = {e["cik"]: e for e in ENTITIES if e.get("cik")}
FR_COMPANIES = [e for e in ENTITIES if e["kind"] == "fr_company"]
