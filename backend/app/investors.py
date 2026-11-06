"""Liste des investisseurs suivis.

kind:
  - "fund"       : gérant / fonds -> 13F-HR (portefeuille trimestriel) + Form 4 (transactions sous 2 jours ouvrés)
  - "company"    : entreprise qui dépose un 13F (participations stratégiques)
  - "politician" : membre de la Chambre des représentants -> Periodic Transaction Reports (STOCK Act, ≤45 jours)

photo:
  - wiki        : titre de page Wikipédia (la photo principale est utilisée)
  - photo_file  : nom de fichier Wikimedia Commons (prioritaire, ex. logos)
  - on peut aussi déposer manuellement data/photos/<id>.jpg (prioritaire sur tout le reste)
"""

INVESTORS = [
    # --- Gérants / fonds (SEC 13F + Form 4) ---
    {"id": "buffett", "name": "Warren Buffett", "subtitle": "Berkshire Hathaway", "kind": "fund", "cik": 1067983, "wiki": "Warren_Buffett"},
    {"id": "druckenmiller", "name": "Stanley Druckenmiller", "subtitle": "Duquesne Family Office", "kind": "fund", "cik": 1536411, "wiki": "Stanley_Druckenmiller"},
    {"id": "ackman", "name": "Bill Ackman", "subtitle": "Pershing Square", "kind": "fund", "cik": 1336528, "wiki": "Bill_Ackman"},
    {"id": "dalio", "name": "Ray Dalio", "subtitle": "Bridgewater Associates", "kind": "fund", "cik": 1350694, "wiki": "Ray_Dalio"},
    {"id": "tepper", "name": "David Tepper", "subtitle": "Appaloosa", "kind": "fund", "cik": 1656456, "wiki": "David_Tepper"},
    {"id": "klarman", "name": "Seth Klarman", "subtitle": "Baupost Group", "kind": "fund", "cik": 1061768, "wiki": "Seth_Klarman"},
    {"id": "icahn", "name": "Carl Icahn", "subtitle": "Icahn Enterprises", "kind": "fund", "cik": 921669, "wiki": "Carl_Icahn"},
    {"id": "lilu", "name": "Li Lu", "subtitle": "Himalaya Capital", "kind": "fund", "cik": 1709323, "wiki": "Li_Lu"},
    {"id": "terrysmith", "name": "Terry Smith", "subtitle": "Fundsmith", "kind": "fund", "cik": 1569205, "wiki": "Terry_Smith_(fund_manager)"},
    {"id": "cathiewood", "name": "Cathie Wood", "subtitle": "ARK Invest", "kind": "fund", "cik": 1697748, "wiki": "Cathie_Wood"},
    {"id": "gates", "name": "Bill Gates", "subtitle": "Gates Foundation Trust", "kind": "fund", "cik": 1166559, "wiki": "Bill_Gates"},
    {"id": "soros", "name": "George Soros", "subtitle": "Soros Fund Management", "kind": "fund", "cik": 1029160, "wiki": "George_Soros"},
    {"id": "pabrai", "name": "Mohnish Pabrai", "subtitle": "Dalal Street LLC", "kind": "fund", "cik": 1549575, "wiki": "Mohnish_Pabrai"},
    {"id": "coleman", "name": "Chase Coleman", "subtitle": "Tiger Global", "kind": "fund", "cik": 1167483, "wiki": "Chase_Coleman_III"},
    {"id": "loeb", "name": "Dan Loeb", "subtitle": "Third Point", "kind": "fund", "cik": 1040273, "wiki": "Daniel_S._Loeb"},
    {"id": "halvorsen", "name": "Andreas Halvorsen", "subtitle": "Viking Global", "kind": "fund", "cik": 1103804, "wiki": "Andreas_Halvorsen"},
    {"id": "laffont", "name": "Philippe Laffont", "subtitle": "Coatue Management", "kind": "fund", "cik": 1135730, "wiki": "Philippe_Laffont"},
    {"id": "mandel", "name": "Stephen Mandel", "subtitle": "Lone Pine Capital", "kind": "fund", "cik": 1061165, "wiki": "Stephen_Mandel"},
    {"id": "gayner", "name": "Tom Gayner", "subtitle": "Markel Group", "kind": "fund", "cik": 1096343, "wiki": "Markel_Group"},

    # --- Entreprises déposant un 13F ---
    {"id": "alphabet", "name": "Google", "subtitle": "Alphabet Inc.", "kind": "company", "cik": 1652044, "photo_file": "Google_2015_logo.svg"},
    {"id": "nvidia", "name": "NVIDIA", "subtitle": "NVIDIA Corp.", "kind": "company", "cik": 1045810, "photo_file": "Nvidia_logo.svg"},

    # --- Élus (Chambre des représentants, STOCK Act) ---
    {"id": "pelosi", "name": "Nancy Pelosi", "subtitle": "Représentante (D-CA)", "kind": "politician", "house": {"last": "Pelosi", "first": "Nancy", "state": "CA"}, "wiki": "Nancy_Pelosi"},
    {"id": "gottheimer", "name": "Josh Gottheimer", "subtitle": "Représentant (D-NJ)", "kind": "politician", "house": {"last": "Gottheimer", "first": "Josh", "state": "NJ"}, "wiki": "Josh_Gottheimer"},
    {"id": "sessions", "name": "Pete Sessions", "subtitle": "Représentant (R-TX)", "kind": "politician", "house": {"last": "Sessions", "first": "Pete", "state": "TX"}, "wiki": "Pete_Sessions"},
    {"id": "austinscott", "name": "Austin Scott", "subtitle": "Représentant (R-GA)", "kind": "politician", "house": {"last": "Scott", "first": "Austin", "state": "GA"}, "wiki": "Austin_Scott_(politician)"},
    {"id": "suozzi", "name": "Thomas Suozzi", "subtitle": "Représentant (D-NY)", "kind": "politician", "house": {"last": "Suozzi", "first": "Thomas", "state": "NY"}, "wiki": "Tom_Suozzi"},
    {"id": "khanna", "name": "Ro Khanna", "subtitle": "Représentant (D-CA)", "kind": "politician", "house": {"last": "Khanna", "first": "Ro", "state": "CA"}, "wiki": "Ro_Khanna"},
    {"id": "mccaul", "name": "Michael McCaul", "subtitle": "Représentant (R-TX)", "kind": "politician", "house": {"last": "McCaul", "first": "Michael", "state": "TX"}, "wiki": "Michael_McCaul"},
    {"id": "bresnahan", "name": "Rob Bresnahan", "subtitle": "Représentant (R-PA)", "kind": "politician", "house": {"last": "Bresnahan", "first": "Rob", "state": "PA"}, "wiki": "Rob_Bresnahan"},
    {"id": "moskowitz", "name": "Jared Moskowitz", "subtitle": "Représentant (D-FL)", "kind": "politician", "house": {"last": "Moskowitz", "first": "Jared", "state": "FL"}, "wiki": "Jared_Moskowitz"},
    {"id": "hern", "name": "Kevin Hern", "subtitle": "Représentant (R-OK)", "kind": "politician", "house": {"last": "Hern", "first": "Kevin", "state": "OK"}, "wiki": "Kevin_Hern"},
]

BY_ID = {i["id"]: i for i in INVESTORS}
BY_CIK = {i["cik"]: i for i in INVESTORS if i.get("cik")}
