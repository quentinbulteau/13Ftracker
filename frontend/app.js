/* 13F Tracker — front mobile (vanilla JS, routage par hash) */
const $view = document.getElementById("view");
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* stockage indisponible */ } },
};

// ------------------------------------------------------------------ utilitaires
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const api = async (path) => {
  if (window.TRACKER_STATIC) return staticApi(path);
  const r = await fetch(`api${path}`);
  if (!r.ok) throw new Error(`${r.status} ${path}`);
  return r.json();
};

// Version publiée (GitHub Pages) : données pré-générées en JSON, filtrage côté téléphone
const getJSON = async (file, { optional = false } = {}) => {
  const r = await fetch(`api/${file}`, { cache: "no-cache" });
  if (!r.ok) { if (optional && r.status === 404) return null; throw new Error(`${r.status} ${file}`); }
  return r.json();
};
async function staticApi(path) {
  const u = new URL(path, "http://x");
  const q = u.searchParams;
  const parts = u.pathname.split("/").filter(Boolean);
  if (parts[0] === "investors" && parts.length === 1) return getJSON("investors.json");
  if (parts[0] === "investors" && parts.length === 2) return getJSON(`investors/${parts[1]}/index.json`);
  if (parts[0] === "investors" && parts[2] === "trades") {
    const rows = await getJSON(`investors/${parts[1]}/trades.json`);
    return q.get("source") ? rows.filter((r) => r.source === q.get("source")) : rows;
  }
  if (parts[0] === "investors" && parts[2] === "portfolio") return getJSON(`investors/${parts[1]}/portfolio.json`);
  if (parts[0] === "investors" && parts[2] === "press") return getJSON(`investors/${parts[1]}/press.json`);
  if (parts[0] === "investors" && parts[2] === "acquisitions") return getJSON(`investors/${parts[1]}/acquisitions.json`);
  if (parts[0] === "acquisitions") return getJSON("acquisitions.json");
  if (parts[0] === "press") {
    const t = q.get("type");
    if (t) return getJSON(`press-${t}${q.get("cat") === "fr" ? "-fr" : ""}.json`);
    const [a, b] = await Promise.all([getJSON("press-investor.json"), getJSON("press-company.json")]);
    return { unofficial: [...a.unofficial, ...b.unofficial], articles: [...a.articles, ...b.articles].sort((x, y) => (y.published || "").localeCompare(x.published || "")) };
  }
  if (parts[0] === "feed") {
    let rows = await getJSON(q.get("type") ? `feed-${q.get("type")}${q.get("cat") === "fr" ? "-fr" : ""}.json` : "feed.json");
    if (q.get("cat")) rows = rows.filter((r) => r.investor_category === q.get("cat"));
    return rows.slice(0, +(q.get("limit") || 60));
  }
  if (parts[0] === "status") return getJSON("status.json");
  if (parts[0] === "ranking") return getJSON("ranking.json");
  if (parts[0] === "consensus") return getJSON("consensus.json");
  if (parts[0] === "calendar") return getJSON("calendar.json");
  if (parts[0] === "stock") return getJSON(`tickers/${parts[1]}.json`);
  if (parts[0] === "insiders") return getJSON("insiders.json");
  if (parts[0] === "search") {
    const v = (q.get("q") || "").trim();
    const all = await investors();
    const lv = v.toLowerCase();
    const invs = all.filter((i) => i.name.toLowerCase().includes(lv) || (i.subtitle || "").toLowerCase().includes(lv));
    const t = v.toUpperCase();
    const act = /^[A-Z0-9.\-]{1,12}$/.test(t) ? await getJSON(`tickers/${t}.json`, { optional: true }) : null;
    return { investors: invs, ticker: act ? t : null, holders: act?.holders || [], trades: act?.trades || [] };
  }
  throw new Error(`inconnu: ${path}`);
}

// photo d'un investisseur (fichier statique publié, ou route du serveur)
const PHOTOS = {};
const photoUrl = (id) => PHOTOS[id] || `api/photo/${encodeURIComponent(id)}`;
const usd = (v) => {
  if (v == null) return "—";
  const f = (x, d = 1) => x.toLocaleString("fr-FR", { maximumFractionDigits: d });
  const a = Math.abs(v);
  if (a >= 1e9) return `${f(v / 1e9)} Md$`;
  if (a >= 1e6) return `${f(v / 1e6)} M$`;
  if (a >= 1e3) return `${f(v / 1e3, 0)} k$`;
  return `${f(v, 0)} $`;
};
const num = (v) => v == null ? "—" : new Intl.NumberFormat("fr-FR", { notation: v >= 1e6 ? "compact" : "standard", maximumFractionDigits: 1 }).format(v);
const fdate = (d, opts = { day: "numeric", month: "short", year: "numeric" }) => {
  if (!d) return "—";
  const dt = new Date(d.length === 10 ? `${d}T12:00:00` : d);
  return isNaN(dt) ? d : dt.toLocaleDateString("fr-FR", opts);
};
const ago = (d) => {
  if (!d) return "—";
  const dt = new Date(d.length === 10 ? `${d}T12:00:00` : d);
  const days = Math.floor((Date.now() - dt) / 864e5);
  if (days <= 0) {
    const h = Math.floor((Date.now() - dt) / 36e5);
    return d.length === 10 || h < 1 ? "aujourd'hui" : `il y a ${h} h`;
  }
  if (days === 1) return "hier";
  if (days < 30) return `il y a ${days} j`;
  return dt.getFullYear() === new Date().getFullYear() ? fdate(d, { day: "numeric", month: "short" }) : fdate(d, { month: "short", year: "numeric" });
};
const agoTime = (d) => {
  if (!d) return "—";
  const m = Math.round((Date.now() - new Date(d)) / 6e4);
  return m < 1 ? "à l'instant" : m < 60 ? `il y a ${m} min` : m < 1440 ? `il y a ${Math.floor(m / 60)} h` : ago(d);
};
const quarter = (p) => { if (!p) return "—"; const [y, m] = p.split("-"); return `T${Math.ceil(+m / 3)} ${y}`; };

const ACTIONS = {
  BUY: ["Achat", "buy"], SELL: ["Vente", "sell"], NEW: ["Nouvelle ligne", "buy"], ADD: ["Renforce", "buy"],
  REDUCE: ["Allège", "sell"], EXIT: ["Sortie", "sell"], EXCHANGE: ["Échange", "neutral"], OTHER: ["Autre", "neutral"],
  SHORT: ["Vente à découvert", "sell"], STAKE_UP: ["Participation", "buy"], STAKE_DOWN: ["Participation réduite", "sell"],
};
const SOURCES = { "13F": "13F", FORM4: "Form 4", HOUSE: "STOCK Act", AMF: "AMF", "13D": "13D", "13G": "13G" };
// deux espaces séparés, chacun avec ses catégories
const SPACES = {
  investor: { label: "Investisseurs", cats: { us_fund: "Gérants US", us_politician: "Élus US", fr: "Investisseurs français" } },
  company: { label: "Entreprises", cats: { ai: "IA & Tech", fr: "Sociétés françaises" } },
};
const catLabel = (i) => SPACES[i.type]?.cats[i.category] || "";
// statut d'une information non réglementaire
const STATUS = {
  officiel: ["Officiel", "buy", "Annoncé par l'entreprise ou déposé auprès d'un régulateur"],
  presse: ["Presse", "warn", "Rapporté par la presse, non confirmé officiellement"],
  declaration: ["Déclaration publique", "warn", "Dit par l'investisseur lui-même (réseaux sociaux, newsletter, interview) : aucune obligation légale, rien de vérifiable"],
  rumeur: ["Rumeur", "rumor", "Source secondaire ou information non vérifiée"],
};
const statusPill = (s) => {
  const [l, , t] = STATUS[s] || [s, "", ""];
  return s === "officiel" ? `<span class="stamp" title="${esc(t)}">${l}</span>` : `<span class="pencil" title="${esc(t)}">${l}, non vérifié</span>`;
};
const join = (...xs) => xs.filter(Boolean).join(", ");
// tampon d'une déclaration officielle : source + date
const stamp = (t, date) => `<span class="stamp" title="Déclaration officielle ${esc(SOURCES[t.source] || t.source)}${t.filed_at ? `, déposée le ${fdate(t.filed_at)}` : ""}">${SOURCES[t.source] || t.source} <small>${date}</small></span>`;

const eur = (v) => usd(v).replace("$", " €").replace("  ", " ");
const amount = (t) => {
  const f = t.source === "AMF" ? eur : usd;
  if (t.pct != null) return `${t.pct.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`;
  if (t.value != null) return f(t.value);
  if (t.value_low != null) return t.value_high ? `${f(t.value_low)} – ${f(t.value_high)}` : `> ${f(t.value_low)}`;
  return "—";
};
const isLogo = (i) => i.logo || i.investor_logo;
const imgTag = (inv, cls = "") => `<img class="${cls} ${isLogo(inv) ? "logo" : ""}" src="${esc(photoUrl(inv.id))}" alt="" loading="lazy">`;
const avatar = (id, logo) => `<img class="avatar ${logo ? "logo" : ""}" src="${esc(photoUrl(id))}" alt="" loading="lazy">`;
const ext = (url, text) => `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(text)}</a>`;

// ------------------------------------------------------------------ favoris
const favs = () => store.get("favs", []);
const toggleFav = (id) => { const f = favs(); store.set("favs", f.includes(id) ? f.filter((x) => x !== id) : [...f, id]); };

// ------------------------------------------------------------------ composants
function card(inv, { large = false, tag = "" } = {}) {
  return `<a class="card ${large ? "lg" : ""}" href="#/i/${esc(inv.id)}">
    ${imgTag(inv)}
    ${tag}
    <div class="meta"><div class="name">${esc(inv.name)}</div><div class="firm">${esc(inv.subtitle || "")}</div>${inv.last_filing ? `<div class="fresh">Dépôt ${ago(inv.last_filing)}</div>` : ""}</div>
  </a>`;
}

const pct = (v) => `${v > 0 ? "+" : ""}${v.toLocaleString("fr-FR", { maximumFractionDigits: 1, minimumFractionDigits: 1 })} %`;
const perfTag = (t) => t.perf_pct == null ? "" :
  `<div class="perf ${t.perf_pct >= 0 ? "up" : "down"}" title="Cours ${t.price_ref.toFixed(2)} (dernière clôture avant publication, le ${fdate(t.price_ref_date)}) → ${t.price_now.toFixed(2)} aujourd'hui">${t.perf_pct >= 0 ? "▲" : "▼"} ${pct(t.perf_pct).replace("+", "")}</div>`;
const PERF_LEGEND = `▲▼ évolution du cours depuis la publication de la déclaration`;
// noms déclarés en majuscules (SEC, AMF) -> casse lisible
const KEEP_UP = /^(SE|SA|SAS|SCA|LLC|LP|PLC|NV|AG|ETF|USA|US|II|III|ADR|REIT|SPDR|SICAV|NJJ|CMA|CGM|TF1|M6)$/;
const SMALL_W = /^(de|du|des|la|le|les|et|of|and|the|à|au|aux|en|pour|par)$/;
const tc = (x) => !x ? x : x.split(" ").map((w, i) => {
  if (w !== w.toUpperCase() || !/[A-ZÀ-Ý]{2}/.test(w) || KEEP_UP.test(w.replace(/[.,]/g, ""))) return w;
  const l = w.toLowerCase();
  if (i > 0 && SMALL_W.test(l)) return l;
  const t = l.replace(/(^|[-'’(/&.])([a-zà-ÿ])/g, (m, a, b) => a + b.toUpperCase());
  return i > 0 ? t.replace(/^([DL])(['’])/, (m, a, b) => a.toLowerCase() + b) : t;
}).join(" ");

// date affichée: trimestre (13F), période du rapport (Form 4), date d'opération (élus, AMF)
const tradeDate = (t) => t.source === "13F" ? quarter(t.trade_date)
  : t.source === "FORM4" ? `<span title="Period of report (déclaré à la SEC) · publié le ${fdate(t.filed_at)}">Pér. ${fdate(t.report_date || t.trade_date, { day: "numeric", month: "short" })}</span>`
  : fdate(t.trade_date, { day: "numeric", month: "short" });

// carte unique pour un 13F (toutes les variations du trimestre publiées d'un coup)
function summaryRow(s, { isNew = false } = {}) {
  const parts = [[s.n_new, "nouvelle(s)"], [s.n_add, "renforcée(s)"], [s.n_reduce, "allégée(s)"], [s.n_exit, "sortie(s)"]]
    .filter(([n]) => n).map(([n, l]) => `${n} ${l}`).join(", ");
  const top = (s.top || []).map((t) => `<b class="${(ACTIONS[t.action] || [])[1]}-c">${esc(t.ticker || t.issuer)}</b>`).join(" ");
  return `<a class="row ${isNew ? "new" : ""}" href="#/i/${esc(s.investor_id)}/trades">
    ${avatar(s.investor_id, s.investor_logo)}
    <div class="name">${esc(s.investor_name)}</div>
    <div class="amt buy-c">${s.bought ? `+${usd(s.bought)}` : ""}</div>
    <div class="what"><span class="pill neutral">Portefeuille ${quarter(s.trade_date)}</span><span class="ell">${parts}</span></div>
    <div class="perf sell-c">${s.sold ? `−${usd(s.sold)}` : ""}</div>
    <div class="meta">Plus gros mouvements : ${top}</div>
    ${stamp({ source: "13F", filed_at: s.filed_at }, `publié ${fdate(s.filed_at, { day: "numeric", month: "short" })}`)}
  </a>`;
}

// une déclaration (même investisseur, même document, même sens) = une seule ligne, montants additionnés
function groupTrades(rows) {
  const out = [], idx = new Map();
  for (const t of rows) {
    const k = t.url && t.action !== "SUMMARY" && t.source !== "13F" ? `${t.investor_id}|${t.url}|${t.action}|${t.ticker}` : null;
    if (k && idx.has(k)) {
      const g = idx.get(k);
      g.n = (g.n || 1) + 1;
      g.value = (g.value || 0) + (t.value || 0) || null;
      g.shares = (g.shares || 0) + (t.shares || 0) || null;
      if ((t.trade_date || "") < (g.first_date || g.trade_date || "")) g.first_date = t.trade_date;
      continue;
    }
    const c = { ...t };
    if (k) idx.set(k, c);
    out.push(c);
  }
  for (const g of out) if (g.n > 1) g.details = join(`${g.n} opérations${g.first_date ? ` du ${fdate(g.first_date, { day: "numeric", month: "short" })} au ${fdate(g.trade_date, { day: "numeric", month: "short" })}` : ""}`, (g.details || "").split(" · ")[0]);
  return out;
}

function tradeRow(t, { showInvestor = false, isNew = false, ownerFirst = false } = {}) {
  if (t.action === "SUMMARY") return summaryRow(t, { isNew });
  const [label, cls] = t.action === "OTHER" ? [t.asset_type || "Autre", "neutral"] : (ACTIONS[t.action] || [t.action, "neutral"]);
  const amf = t.source === "AMF";
  const lead = showInvestor ? avatar(t.investor_id, t.investor_logo)
    : `<div class="logo-tk">${esc((t.ticker || t.issuer || "—").replace(/\.(PA|L)$/, "").slice(0, 5))}</div>`;
  let name, what, meta;
  if (showInvestor) {
    name = t.investor_name;
    what = amf ? t.issuer : (t.ticker ? `${t.ticker}, ${tc(t.issuer) || ""}` : tc(t.issuer));
    meta = amf ? join(tc(t.owner), t.details) : t.details;
  } else if (amf) {
    name = ownerFirst ? tc(t.owner) : t.issuer;
    what = ownerFirst ? "" : `par ${tc(t.owner)}`;
    meta = t.details;
  } else {
    name = t.ticker || tc(t.issuer);
    what = t.ticker ? tc(t.issuer) : "";
    meta = t.details;
  }
  if (showInvestor) meta = join(t.filed_at ? `publié ${agoTime(t.filed_at)}` : "", meta);
  const href = showInvestor ? `#/i/${esc(t.investor_id)}` : t.ticker ? `#/s/${encodeURIComponent(t.ticker)}` : esc(t.url || "#");
  const target = showInvestor || t.ticker ? "" : ` target="_blank" rel="noopener"`;
  return `<a class="row ${isNew ? "new" : ""}" href="${href}"${target}>
    ${lead}
    <div class="name">${esc(name)}</div>
    <div class="amt">${amount(t)}</div>
    <div class="what"><span class="pill ${cls}">${esc(label)}</span><span class="ell">${esc(what || "")}</span></div>
    ${perfTag(t)}
    <div class="meta">${esc((meta || "").replaceAll(" · ", ", "))}</div>
    ${stamp(t, tradeDate(t))}
  </a>`;
}

// information non officielle (rumeur, déclaration publique, rachat de média rapporté par la presse)
function claimRow(u, { showEntity = false } = {}) {
  const dir = ACTIONS[u.direction];
  const title = u.kind === "media_deal" ? `Média : ${esc(u.target)}` : `${dir ? `<span class="pill ${dir[1]}">${dir[0]}</span>` : ""} ${esc(u.ticker || "")}`;
  return `<div class="row ${showEntity ? "block" : "nolead"} unoff">
    ${showEntity ? `<a class="lead" href="#/i/${esc(u.entity)}">${avatar(u.entity)}</a>` : ""}
    <div class="body">
      <div class="headline">${statusPill(u.status)}${showEntity ? `<a class="tk" href="#/i/${esc(u.entity)}">${esc(u.entity_name)}</a>` : ""}<span class="when">${fdate(u.date, { month: "short", year: "numeric" })}</span></div>
      <div class="claim-title">${title}</div>
      <div class="l2 wrap-text">${esc(u.summary)}</div>
      ${u.where ? `<div class="l2 wrap-text">Où : ${esc(u.where)}</div>` : ""}
      <div class="srcs">Sources : ${u.sources.map((x) => ext(x.url, x.title)).join(", ")}</div>
    </div>
  </div>`;
}

const articleRow = (a, { showEntity = false } = {}) => `<a class="row ${showEntity ? "block" : "nolead"}" href="${esc(a.url)}" target="_blank" rel="noopener">
  ${showEntity ? `<span class="lead">${avatar(a.entity_id)}</span>` : ""}
  <div class="body">
    <div class="art-title">${esc(a.title)}</div>
    <div class="l2">${esc(join(showEntity ? a.entity_name : "", a.source, a.published ? ago(a.published) : ""))}</div>
  </div>
</a>`;

function acquisitionRow(a, { showAcquirer = false } = {}) {
  const d = a.date.length > 7 ? fdate(a.date) : fdate(a.date + (a.date.length === 4 ? "-07-01" : "-15"), a.date.length === 4 ? { year: "numeric" } : { month: "long", year: "numeric" });
  return `<div class="row block">
    ${showAcquirer ? `<a class="lead" href="#/i/${esc(a.acquirer)}/acquisitions">${avatar(a.acquirer, true)}</a>` : `<div class="logo-tk">${esc(a.target.slice(0, 5))}</div>`}
    <div class="body">
      <div class="headline"><span class="tk">${showAcquirer ? `${esc(a.acquirer_name)} rachète ` : ""}${esc(a.target)}</span>${statusPill(a.status)}</div>
      <div class="l2 wrap-text">${esc(join(a.type, a.amount, d))}</div>
      <div class="l2 wrap-text">${esc(a.summary)}</div>
      <div class="srcs">Sources : ${a.sources.map((x) => ext(x.url, x.title)).join(", ")}</div>
      ${a.articles?.length ? `<details><summary>${a.articles.length} article(s) de presse associé(s)</summary>
        ${a.articles.map((x) => `<div class="mini-art">${ext(x.url, x.title)} <span>${esc(join(x.source, x.published ? fdate(x.published) : ""))}</span></div>`).join("")}</details>` : ""}
    </div>
  </div>`;
}

const officialHead = (title, sub, link) => `<div class="section-head"><h2>${title}</h2>${link ? `<a href="${link}">Tout voir</a>` : ""}</div><p class="sub">${sub}</p>`;
const unofficialHead = (title, sub, link) => `<div class="section-head"><h2>${title} <span class="pencil">non vérifié</span></h2>${link ? `<a href="${link}">Tout voir</a>` : ""}</div><p class="sub">${sub}</p>`;
const UNOFF_NOTE = `<div class="note unoff-note"><b>Non officiel.</b> Ces informations ne proviennent pas d'une déclaration réglementaire (SEC, AMF, Congrès) : articles de presse, propos tenus sur les réseaux sociaux ou rumeurs. À vérifier avant toute décision.</div>`;

const skeleton = (n = 3) => `<div class="rail">${Array.from({ length: n }, () => `<div class="card skeleton"></div>`).join("")}</div>`;
const segmented = (id, opts, cur) => `<div class="seg" id="${id}">${opts.map(([k, l]) => `<button class="${k === cur ? "on" : ""}" data-k="${k}">${l}</button>`).join("")}</div>`;
const chipsHtml = (id, opts, cur) => `<div class="chips" id="${id}">${opts.map(([k, l]) => `<button class="chip ${k === cur ? "on" : ""}" data-k="${k}">${l}</button>`).join("")}</div>`;
const bind = (sel, fn) => $view.querySelectorAll(`${sel} button`).forEach((b) => b.onclick = () => fn(b.dataset.k));

// ------------------------------------------------------------------ vues
let INVESTORS = null;
async function investors() {
  INVESTORS = INVESTORS || (await api("/investors"));
  for (const i of INVESTORS) if (i.photo && window.TRACKER_STATIC) PHOTOS[i.id] = i.photo;
  return INVESTORS;
}

async function viewHome() {
  const space = store.get("space", "investor");
  const cat = store.get(`cat:${space}`, "");
  const cats = SPACES[space].cats;
  $view.innerHTML = `
    <div class="title-row"><h1 class="page-title">Explorer</h1><a class="info-link" href="#/about">Sources et méthode</a></div>
    <a class="searchbar" href="#/search">
      <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
      <span>Investisseur, entreprise ou ticker</span>
    </a>
    ${segmented("space", Object.entries(SPACES).map(([k, v]) => [k, v.label]), space)}
    ${chipsHtml("cats", [["", "Tous"], ...Object.entries(cats)], cat)}
    <div id="home-body">${skeleton()}</div>`;
  bind("#space", (k) => { store.set("space", k); viewHome(); });
  bind("#cats", (k) => { store.set(`cat:${space}`, k); viewHome(); });

  const q = `type=${space}${cat ? `&cat=${cat}` : ""}`;
  const [all, feed, pr, acqs] = await Promise.all([investors(), api(`/feed?limit=8&${q}`), api(`/press?type=${space}${cat === "fr" ? "&cat=fr" : ""}`),
    space === "company" ? api("/acquisitions") : Promise.resolve([])]);
  const list = all.filter((i) => i.type === space && (!cat || i.category === cat));
  const ids = new Set(list.map((i) => i.id));
  const fav = favs().map((id) => list.find((i) => i.id === id)).filter(Boolean);
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
  const hot = (i) => i.last_filing && i.last_filing >= weekAgo ? `<span class="tag stamp">Nouveau dépôt</span>` : "";

  let html = "";
  if (fav.length) html += `<section class="section"><h2>Mes suivis</h2><p class="sub">${space === "investor" ? "Investisseurs" : "Entreprises"} que vous suivez</p>
    <div class="rail">${fav.map((i) => card(i, { large: true, tag: hot(i) })).join("")}</div></section>`;

  if (space === "company") {
    const a = acqs.filter((x) => ids.has(x.acquirer));
    if (a.length) html += `<section class="section"><div class="section-head"><h2>Rachats de startups</h2></div>
      <p class="sub">Liste vérifiée, chaque rachat avec son statut et ses sources</p>
      <div class="list">${a.slice(0, 6).map((x) => acquisitionRow(x, { showAcquirer: true })).join("")}</div></section>`;
  }
  html += `<section class="section">${officialHead(space === "investor" ? "Dernières déclarations" : "Déclarations des entreprises",
    space === "investor" ? `Déclarations obligatoires à la SEC, à l'AMF et au Congrès américain. ${PERF_LEGEND}.` : `13F, Form 4 et opérations des dirigeants déclarées à l'AMF. ${PERF_LEGEND}.`, "#/feed")}
    ${feed.length ? `<div class="list">${groupTrades(feed).map((t) => tradeRow(t, { showInvestor: true })).join("")}</div>` : `<div class="note">Aucune déclaration pour l'instant (ou premier chargement en cours).</div>`}</section>`;
  if (space === "investor" && cat !== "fr") html += `<section class="section"><div class="section-head"><h2>À venir</h2><a href="#/agenda">Agenda complet</a></div>
    <p class="sub">Échéance des 13F et prochains résultats des actions détenues par les gérants</p><div id="home-agenda"></div></section>`;

  for (const [k, label] of Object.entries(cats)) {
    if (cat && cat !== k) continue;
    const g = list.filter((i) => i.category === k).sort((a, b) => (b.last_filing || "").localeCompare(a.last_filing || ""));
    if (g.length) html += `<section class="section"><h2>${label}</h2><p class="sub">${g.length} suivis · les plus récemment actifs d'abord</p>
      <div class="rail">${g.map((i) => card(i, { tag: hot(i) })).join("")}</div></section>`;
  }

  const claims = pr.unofficial.filter((u) => ids.has(u.entity));
  const arts = pr.articles.filter((a) => ids.has(a.entity_id));
  if (claims.length || arts.length) html += `<section class="section">${unofficialHead("Presse & rumeurs", "Informations non réglementaires, séparées des déclarations officielles", "#/feed/press")}
    ${claims.length ? `<div class="list">${claims.slice(0, 3).map((u) => claimRow(u, { showEntity: true })).join("")}</div>` : ""}
    ${arts.length ? `<div class="list" style="margin-top:10px">${arts.slice(0, 5).map((a) => articleRow(a, { showEntity: true })).join("")}</div>` : ""}</section>`;
  document.getElementById("home-body").innerHTML = html;
  const ag = document.getElementById("home-agenda");
  if (ag) ag.innerHTML = await agendaHtml(5);
}

function statsFor(inv) {
  const st = (k, v) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`;
  const last = st("Dernier dépôt", ago(inv.last_filing));
  switch (inv.kind) {
    case "politician": return st("Transactions", num(inv.trade_count)) + st("Source", "STOCK Act") + last;
    case "fr_investor": return st("Opérations AMF", num(inv.trade_count)) + st("Source", "AMF") + last;
    case "fr_company": return st("Cotation", esc(inv.ticker || "—")) + st("Opérations", num(inv.trade_count)) + last;
    case "company": return inv.cik ? st("Valeur 13F", usd(inv.portfolio_value)) + st("Positions", num(inv.positions)) + last
      : st("Statut", "Non cotée") + st("Source", "Presse") + st("Rachats", "liste vérifiée");
    default: return st("Valeur 13F", usd(inv.portfolio_value)) + st("Positions", num(inv.positions)) + last;
  }
}

async function viewInvestor(id, tab) {
  $view.innerHTML = `<div class="hero skeleton"></div>`;
  const inv = await api(`/investors/${id}`);
  const tabs = inv.tabs || [{ id: "trades", label: "Achats & ventes" }, { id: "portfolio", label: "Portefeuille" }];
  tab = tabs.find((t) => t.id === tab) ? tab : (tabs.find((t) => t.id === store.get(`tab:${id}`)) ? store.get(`tab:${id}`) : tabs[0].id);
  const isFav = favs().includes(id);
  $view.innerHTML = `
    <div class="hero">
      ${imgTag(inv)}
      <div class="top">
        <button class="iconbtn" onclick="history.length > 1 ? history.back() : location.hash = '#/'" aria-label="Retour"><svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg></button>
        <button class="iconbtn ${isFav ? "on" : ""}" id="fav" aria-label="Suivre"><svg viewBox="0 0 24 24"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg></button>
      </div>
      <div class="who"><div class="kicker">${esc(catLabel(inv))}</div><h1>${esc(inv.name)}</h1><div class="firm">${esc(inv.subtitle || "")}</div></div>
    </div>
    <div class="stats">${statsFor(inv)}</div>
    ${inv.inactive ? `<div class="note warn-note" style="margin-top:12px">${esc(inv.inactive)}</div>` : ""}
    ${inv.sources?.length ? `<details class="srcinfo"><summary>D'où viennent ces données ?</summary><ul>${inv.sources.map((s) => `<li><b>${s.label}</b> : ${esc(s.delay)}</li>`).join("")}</ul></details>` : ""}
    ${inv.unparsed?.length ? `<div class="note" style="margin-top:12px">${inv.unparsed.length} déclaration(s) déposée(s) sur papier puis scannée(s) : non lisibles automatiquement.
      Dernière : <a style="color:var(--accent)" href="${esc(inv.unparsed[0].url)}" target="_blank" rel="noopener">PDF du ${fdate(inv.unparsed[0].filed_at)}</a></div>` : ""}
    <div class="tabs">
      ${tabs.map((t) => `<button data-t="${t.id}" class="${t.id === tab ? "on" : ""} ${t.id === "press" ? "press-tab" : ""}">${esc(t.label)}</button>`).join("")}
    </div>
    <div id="tab-body"><div class="list skeleton" style="height:240px"></div></div>`;
  document.getElementById("fav").onclick = (e) => { toggleFav(id); e.currentTarget.classList.toggle("on"); };
  $view.querySelectorAll(".tabs button").forEach((b) => b.onclick = () => {
    store.set(`tab:${id}`, b.dataset.t);
    $view.querySelectorAll(".tabs button").forEach((x) => x.classList.toggle("on", x === b));
    renderTab(inv, b.dataset.t);
  });
  renderTab(inv, tab);
}

async function renderTab(inv, tab) {
  const body = document.getElementById("tab-body");
  body.innerHTML = `<div class="list skeleton" style="height:240px"></div>`;
  if (tab === "trades") return renderTrades(inv, body);
  if (tab === "press") return renderPress(inv, body);
  if (tab === "acquisitions") return renderAcquisitions(inv, body);
  return renderPortfolio(inv, body);
}

async function renderTrades(inv, body, source = "") {
  const trades = await api(`/investors/${inv.id}/trades${source ? `?source=${source}` : ""}`);
  const srcs = (inv.sources || []).map((s) => s.source).filter((s) => s !== "FORM4" || inv.kind !== "company");
  const chips = srcs.length > 1 ? `<div class="chips" style="margin-top:0;margin-bottom:6px">
    ${[["", "Tout"], ...srcs.map((s) => [s, SOURCES[s]])].map(([k, l]) => `<button class="chip ${k === source ? "on" : ""}" data-s="${k}">${l}</button>`).join("")}</div>` : "";
  const intro = inv.kind === "fr_investor" ? `<div class="note">Opérations déclarées à l'AMF par ${esc(inv.name)}, sa famille ou ses holdings, sur les sociétés cotées suivies. Les investissements dans des sociétés non cotées (dont la plupart des médias) n'ont pas à être déclarés : voir « Médias & participations ».</div>`
    : inv.kind === "fr_company" ? `<div class="note">Achats et ventes de titres par les dirigeants de ${esc(inv.name)} et leurs proches (règlement MAR). Les attributions gratuites et exercices d'options sont indiqués à part.</div>` : "";
  if (!trades.length) {
    body.innerHTML = chips + intro + `<div class="empty">Aucune opération déclarée pour l'instant.</div>`;
  } else {
    const groups = new Map();
    for (const t of trades) {
      const key = t.source === "13F" ? `Variations ${quarter(t.trade_date)} (13F)` : fdate(t.trade_date, { month: "long", year: "numeric" });
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(t);
    }
    body.innerHTML = chips + intro + `<p class="legend">${PERF_LEGEND}</p>` + [...groups].map(([k, ts]) => `<div class="day">${esc(k)}</div><div class="list">${ts.map((t) => tradeRow(t, { ownerFirst: inv.kind === "fr_company" })).join("")}</div>`).join("");
  }
  body.querySelectorAll(".chip").forEach((b) => b.onclick = () => renderTrades(inv, body, b.dataset.s));
}

async function renderPress(inv, body) {
  const p = await api(`/investors/${inv.id}/press`);
  body.innerHTML = UNOFF_NOTE
    + (p.unofficial.length ? `<div class="day">Déclarations publiques, rumeurs et rachats rapportés</div><div class="list">${p.unofficial.map((u) => claimRow(u)).join("")}</div>` : "")
    + `<div class="day">Articles de presse récents</div>`
    + (p.articles.length ? `<div class="list">${p.articles.map((a) => articleRow(a)).join("")}</div>` : `<div class="empty">Aucun article récent.</div>`);
}

async function renderAcquisitions(inv, body) {
  const a = await api(`/investors/${inv.id}/acquisitions`);
  body.innerHTML = `<div class="note">Rachats et prises de participation de ${esc(inv.name)}, vérifiés un par un. Statut <b>Officiel</b> = annoncé par l'entreprise ou déposé à un régulateur ; <b>Presse</b> = rapporté par la presse sans confirmation. Les articles associés sont recherchés automatiquement.</div>`
    + (a.length ? `<div class="list">${a.map((x) => acquisitionRow(x)).join("")}</div>` : `<div class="empty">Aucun rachat répertorié.</div>`);
}

async function renderPortfolio(inv, body) {
  const pf = await api(`/investors/${inv.id}/portfolio`);
  if (pf.type === "FR") return renderFrHoldings(inv, pf, body);
  if (!pf.positions.length) {
    body.innerHTML = `<div class="empty">Aucun portefeuille déclaré pour l'instant.</div>`;
    return;
  }
  if (pf.type === "ESTIMATED") {
    const max = Math.max(...pf.positions.map((p) => p.high || 0), 1);
    body.innerHTML = `<div class="note">${esc(pf.note)}</div><div class="list">${pf.positions.map((p) => `
      <div class="row pos">
        <div class="logo-tk">${esc((p.ticker || "—").slice(0, 5))}</div>
        <div class="main">
          <div class="l1 wrap"><span class="tk">${esc(p.ticker || "")}</span><span class="pill ${(ACTIONS[p.last_action] || [])[1] || "neutral"}">${(ACTIONS[p.last_action] || [p.last_action])[0]}</span><span class="when">le ${fdate(p.last_date, { day: "numeric", month: "short", year: "numeric" })}</span></div>
          <div class="l2">${esc(p.issuer || "")} · ${p.buys} achat(s) · ${p.sells} vente(s) partielle(s)</div>
          <div class="bar"><i style="width:${((p.high || 0) / max) * 100}%"></i></div>
        </div>
        <div class="right"><div class="amt">${p.high ? `${usd(p.low)} – ${usd(p.high)}` : "—"}</div><div class="date">${esc(p.asset_type || "")}</div></div>
      </div>`).join("")}</div>`;
    return;
  }
  const max = pf.positions[0]?.weight || 1;
  const posRow = (p) => {
    const ch = p.change ? ACTIONS[p.change] : null;
    const f4 = p.after_13f ? `<div class="f4">Après le 13F (Form 4) : détient ${num(p.after_13f.shares_after)} titres au ${fdate(p.after_13f.trade_date)}</div>` : "";
    const lm = p.last_move;
    const when = !lm ? "" : lm.exact
      ? `<span class="when">${ACTIONS[lm.action][0]} le ${fdate(lm.date, { day: "numeric", month: "short", year: "numeric" })}</span>`
      : `<span class="when" title="Le 13F ne donne pas la date exacte : mouvement entre le ${fdate(lm.from)} et le ${fdate(lm.date)}">au ${quarter(lm.date)}</span>`;
    const tag = p.ticker ? "a" : "div";
    return `<${tag} class="row pos"${p.ticker ? ` href="#/s/${encodeURIComponent(p.ticker)}"` : ""}>
      <div class="logo-tk">${esc((p.ticker || p.issuer || "—").slice(0, 5))}</div>
      <div class="main">
        <div class="l1 wrap"><span class="tk">${esc(p.ticker || tc(p.issuer))}</span>${p.put_call ? `<span class="pill neutral">${esc(p.put_call)}</span>` : ""}${ch ? `<span class="pill ${ch[1]}">${ch[0]}</span>` : ""}${when}</div>
        <div class="l2">${esc(tc(p.issuer))}, ${num(p.shares)} titres</div>
        <div class="bar"><i style="width:${(p.weight / max) * 100}%"></i></div>
        ${f4}
      </div>
      <div class="right"><div class="amt">${p.weight.toFixed(1)} %</div><div class="date">${usd(p.value)}</div></div>
    </${tag}>`;
  };
  // le plus récent d'abord : derniers mouvements datés, puis performance, puis le portefeuille complet par poids
  const recent = pf.positions.filter((p) => p.last_move).sort((a, b) => b.last_move.date.localeCompare(a.last_move.date)
    || (b.last_move.exact - a.last_move.exact) || b.weight - a.weight).slice(0, 6);
  body.innerHTML = (recent.length ? `<div class="day">Derniers mouvements</div><div class="list">${recent.map(posRow).join("")}</div>` : "")
    + (inv.kind === "fund" ? `<div id="perf-block"></div>` : "")
    + `<div class="day">Toutes les positions déclarées</div><div class="note">Portefeuille au <b>${fdate(pf.period)}</b> (${quarter(pf.period)}), total ${usd(pf.total_value)}.
    Positions longues US uniquement (pas de ventes à découvert, ni d'actifs hors 13F).</div>
    <div class="list">${pf.positions.map(posRow).join("")}</div>`;
  if (inv.kind === "fund") renderPerformance(inv, document.getElementById("perf-block"));
}

function renderFrHoldings(inv, pf, body) {
  const shortType = (t) => t.startsWith("Presse") ? "Presse" : t || "Média";
  const groups = new Map();
  for (const m of pf.media) { const k = shortType(m.type); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(m); }
  const chain = (m) => m.path.map((s) => `${esc(s.to)} <b>${esc(s.share)}</b>`).join(" → ");
  body.innerHTML = (pf.companies.length ? `<div class="day">Sociétés cotées (déclarations AMF)</div><div class="list">${pf.companies.map((c) => `
      <a class="row" href="#/i/${esc(c.company_id)}">${avatar(c.company_id, true)}
        <div class="main"><div class="l1"><span class="tk">${esc(c.company)}</span></div><div class="l2">${c.n} opération(s) déclarée(s) · dernière le ${fdate(c.last_date)}</div></div>
        <div class="right"><div class="date">${esc(c.ticker || "")}</div></div></a>`).join("")}</div>` : "")
    + `<div class="day">Médias détenus <span class="stamp">Données publiques</span></div>
      <div class="note">Chaîne de détention reconstituée d'après ${ext(pf.media_source.url, pf.media_source.title)}, mise à jour fin 2024. Les rachats plus récents rapportés par la presse figurent plus bas, à part.</div>`
    + (pf.media.length ? [...groups].map(([k, ms]) => `<div class="day">${esc(k)} (${ms.length})</div><div class="list">${ms.map((m) => `
        <div class="row"><div class="logo-tk">${esc(m.media.slice(0, 4))}</div>
          <div class="main"><div class="l1"><span class="tk">${esc(m.media)}</span></div><div class="l2 wrap-text">${chain(m)}</div></div></div>`).join("")}</div>`).join("")
      : `<div class="empty">Aucun média répertorié dans la base du Monde diplomatique.</div>`)
    + (pf.deals.length ? `<div class="day">Rachats récents rapportés <span class="pencil">non vérifié</span></div><div class="list">${pf.deals.map((u) => claimRow(u)).join("")}</div>` : "");
}

// ------------------------------------------------------------------ graphiques (méthode du skill dataviz)
// Séries indexées sur une même base 100 (jamais deux axes), légende + étiquettes en bout de ligne,
// réticule + infobulle au survol, tableau consultable sans survol.
const svgEl = (tag, attrs = {}) => { const e = document.createElementNS("http://www.w3.org/2000/svg", tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
const fmtIdx = (v) => (v - 100).toLocaleString("fr-FR", { maximumFractionDigits: 1, minimumFractionDigits: 1, signDisplay: "always" }) + " %";

function sparkline(points) {
  if (!points?.length) return "";
  const w = 72, h = 26, ys = points.map((p) => p[1]);
  const lo = Math.min(...ys), hi = Math.max(...ys), span = hi - lo || 1;
  const d = points.map((p, i) => `${i ? "L" : "M"}${(i / (points.length - 1)) * (w - 4) + 2},${h - 3 - ((p[1] - lo) / span) * (h - 6)}`).join(" ");
  const last = points[points.length - 1];
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">
    <path d="${d}" fill="none" stroke="var(--series-1)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${w - 2}" cy="${h - 3 - ((last[1] - lo) / span) * (h - 6)}" r="3" fill="var(--series-1)" stroke="var(--sheet)" stroke-width="2"/></svg>`;
}

function lineChart(host, series, { height = 220 } = {}) {
  // series: [{ name, color, points: [[date, valeur base 100], ...] }]
  host.innerHTML = "";
  const W = Math.max(280, host.clientWidth || 340), H = height, m = { t: 12, r: 64, b: 24, l: 40 };
  const all = series.flatMap((s) => s.points.map((p) => p[1]));
  let lo = Math.min(...all, 100), hi = Math.max(...all, 100);
  const pad = (hi - lo) * 0.08 || 2; lo -= pad; hi += pad;
  const dates = series[0].points.map((p) => p[0]);
  const t0 = +new Date(dates[0]), t1 = +new Date(dates[dates.length - 1]);
  const x = (d) => m.l + ((+new Date(d) - t0) / (t1 - t0 || 1)) * (W - m.l - m.r);
  const y = (v) => m.t + (1 - (v - lo) / (hi - lo)) * (H - m.t - m.b);
  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", height: H, role: "img", "aria-label": `Évolution comparée : ${series.map((s) => s.name).join(" et ")}` });
  // grille et axe : traits fins, discrets
  const step = (hi - lo) > 40 ? 20 : (hi - lo) > 16 ? 10 : 5;
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
    svg.append(svgEl("line", { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: v === 100 ? "base" : "grid" }));
    const t = svgEl("text", { x: m.l - 6, y: y(v) + 4, class: "axis", "text-anchor": "end" }); t.textContent = fmtIdx(v).replace(",0", ""); svg.append(t);
  }
  const months = [...new Set(dates.map((d) => d.slice(0, 7)))];
  const every = Math.ceil(months.length / 4);
  months.forEach((mo, i) => {
    if (i % every) return;
    const d = dates.find((x) => x.startsWith(mo));
    const t = svgEl("text", { x: x(d), y: H - 6, class: "axis", "text-anchor": "middle" });
    t.textContent = new Date(d + "T12:00").toLocaleDateString("fr-FR", { month: "short", year: "2-digit" }); svg.append(t);
  });
  // séries + étiquette directe en bout de ligne (valeur en encre de texte, repère coloré)
  const ends = [];
  series.forEach((s) => {
    svg.append(svgEl("path", { d: s.points.map((p, i) => `${i ? "L" : "M"}${x(p[0])},${y(p[1])}`).join(" "), fill: "none", stroke: s.color, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }));
    const last = s.points[s.points.length - 1];
    svg.append(svgEl("circle", { cx: x(last[0]), cy: y(last[1]), r: 4, fill: s.color, stroke: "var(--sheet)", "stroke-width": 2 }));
    ends.push({ y: y(last[1]), v: last[1], s });
  });
  ends.sort((a, b) => a.y - b.y);
  if (ends.length === 2 && ends[1].y - ends[0].y < 14) { ends[0].y -= 7; ends[1].y += 7; }
  ends.forEach((e) => { const t = svgEl("text", { x: W - m.r + 8, y: e.y + 4, class: "endlabel" }); t.textContent = fmtIdx(e.v); svg.append(t); });
  // réticule + infobulle : la cible est toute la zone, pas le trait
  const cross = svgEl("line", { y1: m.t, y2: H - m.b, class: "cross", visibility: "hidden" });
  svg.append(cross);
  const hit = svgEl("rect", { x: m.l, y: 0, width: W - m.l - m.r, height: H, fill: "transparent", tabindex: 0 });
  svg.append(hit);
  const tip = document.createElement("div"); tip.className = "tip"; tip.hidden = true;
  const show = (px) => {
    const i = Math.max(0, Math.min(dates.length - 1, Math.round(((px - m.l) / (W - m.l - m.r)) * (dates.length - 1))));
    const d = dates[i];
    cross.setAttribute("x1", x(d)); cross.setAttribute("x2", x(d)); cross.setAttribute("visibility", "visible");
    tip.replaceChildren();
    const head = document.createElement("div"); head.className = "tip-date"; head.textContent = fdate(d); tip.append(head);
    series.forEach((s) => {
      const row = document.createElement("div"); row.className = "tip-row";
      const key = document.createElement("i"); key.style.background = s.color;
      const val = document.createElement("b"); val.textContent = fmtIdx(s.points[i]?.[1] ?? NaN);
      const lab = document.createElement("span"); lab.textContent = s.name;
      row.append(key, val, lab); tip.append(row);
    });
    tip.hidden = false;
    tip.style.left = `${Math.min(Math.max(0, (x(d) / W) * host.clientWidth - 70), host.clientWidth - 150)}px`;
  };
  hit.addEventListener("pointermove", (ev) => { const r = svg.getBoundingClientRect(); show(((ev.clientX - r.left) / r.width) * W); });
  hit.addEventListener("pointerleave", () => { tip.hidden = true; cross.setAttribute("visibility", "hidden"); });
  hit.addEventListener("focus", () => show(W - m.r));
  hit.addEventListener("blur", () => { tip.hidden = true; cross.setAttribute("visibility", "hidden"); });
  const legend = document.createElement("div"); legend.className = "legend-row";
  series.forEach((s) => { const it = document.createElement("span"); const k = document.createElement("i"); k.style.background = s.color; it.append(k, document.createTextNode(s.name)); legend.append(it); });
  const wrap = document.createElement("div"); wrap.className = "chart"; wrap.append(svg, tip);
  // vue tableau (accessibilité) : valeur à chaque fin de mois
  const table = document.createElement("details"); table.className = "chart-table";
  const sm = document.createElement("summary"); sm.textContent = "Voir les données"; table.append(sm);
  const tb = document.createElement("table");
  const hr = tb.insertRow(); ["Date", ...series.map((s) => s.name)].forEach((h) => { const th = document.createElement("th"); th.textContent = h; hr.append(th); });
  dates.forEach((d, i) => {
    if (i < dates.length - 1 && dates[i + 1].slice(0, 7) === d.slice(0, 7)) return;
    const r = tb.insertRow(); r.insertCell().textContent = fdate(d);
    series.forEach((s) => { r.insertCell().textContent = fmtIdx(s.points[i]?.[1] ?? NaN); });
  });
  table.append(tb);
  host.append(...(series.length > 1 ? [legend] : []), wrap, table);
}

// ------------------------------------------------------------------ classement
const WIN_LABEL = { 3: "3 mois", 6: "6 mois", 12: "12 mois" };
let RANKING = null;
const ranking = async () => (RANKING = RANKING || await api("/ranking"));
const signed = (v) => v == null ? "—" : `${v > 0 ? "+" : ""}${v.toLocaleString("fr-FR", { maximumFractionDigits: 1, minimumFractionDigits: 1 })} %`;

async function viewRanking() {
  const mode = store.get("rankMode", "perf");
  const win = store.get("rankWin", "12");
  $view.innerHTML = `<h1 class="page-title">Classement</h1>
    ${chipsHtml("rmode", [["perf", "Performances"], ["consensus", "Consensus des gérants"]], mode)}
    ${mode === "perf" ? `<p class="lede" style="margin-top:12px">Les gérants dont le portefeuille déclaré (13F) a le plus progressé, comparés au S&amp;P 500.</p>
    ${segmented("rwin", Object.entries(WIN_LABEL), win)}` : `<p class="lede" style="margin-top:12px">Les actions que les gérants suivis ont le plus achetées et vendues au dernier trimestre déclaré.</p>`}
    <div id="rank-body"><div class="list skeleton" style="height:400px;margin-top:14px"></div></div>`;
  bind("#rmode", (k) => { store.set("rankMode", k); viewRanking(); });
  if (mode === "consensus") return renderConsensus(document.getElementById("rank-body"));
  bind("#rwin", (k) => { store.set("rankWin", k); viewRanking(); });
  const r = await ranking();
  const w = r.windows?.[win];
  const body = document.getElementById("rank-body");
  if (!w?.rows?.length) { body.innerHTML = `<div class="empty">Classement indisponible pour l'instant : il faut l'historique des cours, récupéré au premier passage.</div>`; return; }
  body.innerHTML = `
    <div class="bench">S&amp;P 500 sur la période : <b>${signed(w.bench)}</b><span>du ${fdate(w.start)} au ${fdate(w.end)}</span></div>
    <div class="list">${w.rows.map((x) => `
      <a class="row rank-row" href="#/i/${esc(x.id)}/portfolio">
        <div class="lead rank-n">${x.rank}</div>
        <div class="name">${esc(x.name)}</div>
        <div class="amt ${x.perf >= 0 ? "buy-c" : "sell-c"}">${signed(x.perf)}</div>
        <div class="what"><span class="ell">${esc(x.subtitle)}</span></div>
        <div class="perf">${sparkline(x.series)}</div>
        <div class="meta">${x.vs_bench >= 0 ? "Bat" : "Sous"} le S&amp;P 500 de ${Math.abs(x.vs_bench).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} pts${x.perf_copy != null ? `, copie : ${signed(x.perf_copy)}` : ""}${x.coverage < 70 ? `, calcul sur ${x.coverage} % du portefeuille` : ""}</div>
      </a>`).join("")}</div>
    <details class="note method"><summary><b>Comment c'est calculé</b></summary>
      <p>À chaque fin de trimestre, on prend les positions déclarées dans le 13F (les 60 plus grosses, pondérées par leur valeur), on les conserve jusqu'au trimestre suivant et on calcule la performance avec les cours quotidiens.</p>
      <p><b>Copie</b> : même calcul, mais en n'achetant qu'à la publication du 13F (jusqu'à 45 jours plus tard) : c'est ce qu'un particulier qui suit le gérant aurait réellement obtenu.</p>
      <p>Limites : les 13F ne montrent ni les ventes à découvert, ni le cash, ni les actifs hors États-Unis, ni les allers-retours en cours de trimestre. Un gérant très couvert (Bridgewater, Citadel…) peut donc paraître plus volatil qu'il ne l'est. Les élus et les investisseurs français ne publient pas de portefeuille complet : ils ne sont pas classés.</p>
    </details>`;
}

async function renderPerformance(inv, host) {
  const r = await ranking().catch(() => null);
  const f = r?.funds?.[inv.id];
  if (!f) { host.remove(); return; }
  const win = store.get("perfWin", "12");
  const w = r.windows[win];
  const row = w?.rows.find((x) => x.id === inv.id);
  const aum = f.aum.slice().reverse();
  host.innerHTML = `<div class="day">Performance du portefeuille déclaré</div>
    ${segmented("pwin", Object.entries(WIN_LABEL), win)}
    ${row ? `<div class="perf-head"><div><span>${WIN_LABEL[win]}</span><b class="${row.perf >= 0 ? "buy-c" : "sell-c"}">${signed(row.perf)}</b></div>
      <div><span>S&amp;P 500</span><b>${signed(w.bench)}</b></div>
      <div><span>Rang</span><b>${row.rank} / ${w.rows.length}</b></div></div>
      <div id="perf-chart"></div>` : `<div class="empty">Historique insuffisant sur ${WIN_LABEL[win]}.</div>`}
    <div class="day">Valeur déclarée à chaque trimestre</div>
    <div class="list">${aum.map((a, i) => {
      const prev = aum[i + 1]?.value;
      const ch = prev ? (a.value / prev - 1) * 100 : null;
      return `<div class="row simple"><div class="logo-tk">${quarter(a.period).replace(" 20", "·")}</div>
        <div class="name">${quarter(a.period)}</div><div class="amt">${usd(a.value)}</div>
        <div class="meta">au ${fdate(a.period)}</div><div class="perf ${ch == null ? "" : ch >= 0 ? "up" : "down"}">${ch == null ? "" : signed(ch)}</div></div>`;
    }).join("")}</div>
    <p class="legend">La valeur déclarée varie avec les cours mais aussi avec les apports et retraits des clients du fonds : seule la courbe ci-dessus mesure la performance.</p>`;
  bind("#pwin", (k) => { store.set("perfWin", k); renderPerformance(inv, host); });
  if (row) lineChart(document.getElementById("perf-chart"), [
    { name: inv.name, color: "var(--series-1)", points: row.series },
    { name: "S&P 500", color: "var(--series-2)", points: w.bench_series },
  ]);
}

// ------------------------------------------------------------------ initiés
const MARKET_SRC = { US: "SEC", FR: "AMF", DE: "BaFin" };
const cur = (v, c) => v == null ? "—" : c === "EUR" ? eur(v) : usd(v);

function insiderRow(t, opts = {}) {
  const [label, cls] = ACTIONS[t.action] || [t.action, "neutral"];
  const role = [t.role, t.planned ? "vente programmée (plan 10b5-1)" : ""].filter(Boolean).join(", ");
  return `<a class="row ${t.value >= 1e6 && t.action === "BUY" ? "big" : ""}" href="${opts.doc ? esc(t.url) : `#/s/${encodeURIComponent(t.ticker)}`}"${opts.doc ? ' target="_blank" rel="noopener"' : ""}>
    <div class="logo-tk">${esc((t.ticker || "").replace(/\.(PA|DE|L)$/, "").slice(0, 5))}</div>
    <div class="name">${esc(t.issuer)}</div>
    <div class="amt">${cur(t.value, t.currency)}</div>
    <div class="what"><span class="pill ${cls}">${label}</span><span class="ell">${esc(tc(t.insider || ""))}</span></div>
    ${perfTag(t)}
    <div class="meta">${esc(role)}</div>
    <span class="stamp" title="Déclaration officielle, publiée le ${fdate(t.filed_at)}">${MARKET_SRC[t.market]} <small>${fdate(t.trade_date, { day: "numeric", month: "short" })}</small></span>
  </a>`;
}

async function viewInsiders() {
  const side = store.get("insSide", "BUY");
  const market = store.get("insMarket", "");
  $view.innerHTML = `<h1 class="page-title">Initiés</h1>
    <p class="lede">Achats et ventes de leurs propres actions par les dirigeants des 100 plus grandes sociétés américaines, du CAC 40 et du DAX.</p>
    ${segmented("iside", [["BUY", "Achats"], ["SELL", "Ventes"], ["", "Tout"]], side)}
    ${chipsHtml("imarket", [["", "Tous marchés"], ["US", "Top 100 US"], ["DE", "DAX"], ["FR", "CAC 40"], ["PEA", "Éligible PEA"]], market)}
    <div id="ins-body"><div class="list skeleton" style="height:400px;margin-top:14px"></div></div>`;
  bind("#iside", (k) => { store.set("insSide", k); viewInsiders(); });
  bind("#imarket", (k) => { store.set("insMarket", k); viewInsiders(); });
  const d = await api(`/insiders?limit=600`);
  const inMarket = (m) => !market || (market === "PEA" ? m === "FR" || m === "DE" : m === market);
  const rows = d.rows.filter((r) => (!side || r.action === side) && inMarket(r.market));
  const cl = d.clusters.filter((c) => inMarket(c.market));
  const groups = new Map();
  for (const t of rows) {
    const k = `Publié ${ago((t.filed_at || "").slice(0, 10))}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  }
  document.getElementById("ins-body").innerHTML =
    (side !== "SELL" && cl.length ? `<section class="section"><h2>Achats groupés</h2>
      <p class="sub">Au moins deux dirigeants d'une même société ont acheté sur les 30 derniers jours : c'est le signal d'initiés le plus suivi.</p>
      <div class="list">${cl.map((c) => `<a class="row simple" href="#/s/${encodeURIComponent(c.ticker)}">
        <div class="logo-tk">${esc((c.ticker || "").replace(/\.(PA|DE|L)$/, "").slice(0, 5))}</div>
        <div class="name">${esc(c.issuer)}</div><div class="amt">${cur(c.total, c.currency)}</div>
        <div class="meta">${c.n} dirigeants : ${esc(c.insiders.map(tc).join(", "))}</div><div class="perf">dernier achat ${fdate(c.last, { day: "numeric", month: "short" })}</div></a>`).join("")}</div></section>` : "")
    + (market === "PEA" ? `<p class="legend">Actions de sociétés européennes, achetables dans un PEA. Les actions américaines n'y sont pas éligibles.</p>` : "")
    + `<p class="legend">${side === "SELL" ? "Les ventes ont souvent des raisons personnelles (impôts, diversification) ; aux États-Unis, beaucoup sont programmées des mois à l'avance (plan 10b5-1)." : "Un achat sur le marché est un signal plus parlant qu'une vente : un dirigeant n'achète que s'il croit que le cours va monter."} ${PERF_LEGEND}.</p>`
    + (rows.length ? [...groups].map(([k, ts]) => `<div class="day">${esc(k)}</div><div class="list">${ts.map(insiderRow).join("")}</div>`).join("")
      : `<div class="empty">Aucune opération sur la période.</div>`);
}

// ------------------------------------------------------------------ fiche d'une action
async function viewStock(ticker) {
  ticker = decodeURIComponent(ticker || "").toUpperCase();
  $view.innerHTML = `<div class="list skeleton" style="height:420px;margin-top:24px"></div>`;
  const d = await api(`/stock/${encodeURIComponent(ticker)}`).catch(() => null);
  if (!d) { $view.innerHTML = `<div class="empty">Aucune donnée pour ${esc(ticker)}.</div>`; return; }
  const short = ticker.replace(/\.(PA|DE|L)$/, "");
  const perf = d.series?.length ? d.series[d.series.length - 1][1] - 100 : null;
  // tout ce qui s'est passé sur l'action, le plus récent d'abord
  const events = [
    ...groupTrades(d.trades).map((t) => ({ when: t.filed_at || t.trade_date, html: tradeRow(t, { showInvestor: true }) })),
    ...d.insiders.map((t) => ({ when: t.filed_at || t.trade_date, html: insiderRow({ ...t, issuer: tc(t.insider || "") || t.issuer, insider: t.role || "", role: "" }, { doc: true }) })),
  ].sort((a, b) => (b.when || "").localeCompare(a.when || ""));
  $view.innerHTML = `
    <div class="stock-head">
      <button class="iconbtn back" onclick="history.length > 1 ? history.back() : location.hash = '#/'" aria-label="Retour"><svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg></button>
      <div class="kicker">${d.pea ? "Éligible PEA" : "Action américaine, non éligible au PEA"}</div>
      <h1>${esc(short)}</h1>
      <div class="firm">${esc(tc(d.name || ""))}</div>
    </div>
    <div class="stats">
      <div class="stat"><div class="k">Dernier cours</div><div class="v">${d.last_price ? d.last_price.toLocaleString("fr-FR", { maximumFractionDigits: 2 }) + (d.currency === "EUR" ? " €" : " $") : "—"}</div></div>
      <div class="stat"><div class="k">Sur 1 an</div><div class="v ${perf == null ? "" : perf >= 0 ? "buy-c" : "sell-c"}">${signed(perf)}</div></div>
      <div class="stat"><div class="k">Résultats</div><div class="v">${d.earnings ? fdate(d.earnings.date, { day: "numeric", month: "short" }) : "—"}</div></div>
    </div>
    ${d.series?.length > 2 ? `<div id="stock-chart" class="section"></div>` : ""}
    <section class="section"><h2>Dernières opérations</h2>
      <p class="sub">Fonds, élus, grosses participations et dirigeants de la société, du plus récent au plus ancien.</p>
      ${events.length ? `<div class="list">${events.slice(0, 40).map((e) => e.html).join("")}</div>` : `<div class="empty">Aucune opération déclarée récemment.</div>`}
    </section>
    ${d.holders.length ? `<section class="section"><h2>Fonds qui la détiennent</h2><p class="sub">Selon le dernier 13F de chaque gérant</p>
      <div class="list">${d.holders.map((h) => `<a class="row simple" href="#/i/${esc(h.investor_id)}/portfolio">${avatar(h.investor_id, h.investor_logo)}
        <div class="name">${esc(h.investor_name)}</div><div class="amt">${usd(h.value)}</div>
        <div class="meta">${num(h.shares)} titres, ${quarter(h.period)}</div></a>`).join("")}</div></section>` : ""}
    <section class="section">${unofficialHead("Presse", "Recherche d'articles sur cette action")}
      <a class="stock-link" href="https://news.google.com/search?q=${encodeURIComponent(`"${tc(d.name || short)}"`)}&hl=fr" target="_blank" rel="noopener">Ouvrir les articles récents dans Google Actualités</a></section>`;
  if (d.series?.length > 2) {
    const host = document.getElementById("stock-chart");
    host.innerHTML = `<h2>Cours sur un an</h2><p class="sub">Évolution depuis le ${fdate(d.series[0][0])}</p><div id="sc"></div>`;
    lineChart(document.getElementById("sc"), [{ name: short, color: "var(--series-1)", points: d.series }], { height: 180 });
  }
}

// ------------------------------------------------------------------ consensus des gérants
async function renderConsensus(body) {
  const c = await api("/consensus");
  if (!c?.quarter) { body.innerHTML = `<div class="empty">Pas encore assez de 13F publiés.</div>`; return; }
  const row = (a, side) => `<a class="row" href="#/s/${encodeURIComponent(a.ticker)}">
    <div class="logo-tk">${esc(a.ticker.slice(0, 5))}</div>
    <div class="name">${esc(tc(a.issuer || a.ticker))}</div>
    <div class="amt ${side === "buy" ? "buy-c" : "sell-c"}">${side === "buy" ? a.n_buy : a.n_sell} fonds</div>
    <div class="what"><span class="ell">${esc((side === "buy" ? a.buyers : a.sellers).join(", "))}</span></div>
    <div class="perf">${side === "buy" ? `+${usd(a.bought)}` : `−${usd(a.sold)}`}</div>
    <div class="meta">${side === "buy" ? (a.new ? `${a.new} nouvelle(s) ligne(s)` : "renforcements") : (a.exits ? `${a.exits} sortie(s) complète(s)` : "allègements")}${(side === "buy" ? a.n_sell : a.n_buy) ? `, ${side === "buy" ? a.n_sell : a.n_buy} fonds en sens inverse` : ""}</div>
  </a>`;
  body.innerHTML = `<div class="bench">${c.funds} gérants sur ${c.funds_total} ont publié leur 13F du ${quarter(c.quarter)}<span>les autres sont attendus avant l'échéance légale</span></div>
    <section class="section"><h2>Les plus achetées</h2><p class="sub">Nombre de fonds suivis qui ont ouvert ou renforcé une position au ${quarter(c.quarter)}</p>
      <div class="list">${c.bought.map((a) => row(a, "buy")).join("")}</div></section>
    <section class="section"><h2>Les plus vendues</h2><p class="sub">Nombre de fonds qui ont allégé ou soldé leur position</p>
      <div class="list">${c.sold.map((a) => row(a, "sell")).join("")}</div></section>`;
}

// ------------------------------------------------------------------ agenda
async function agendaHtml(limit) {
  const c = await api("/calendar").catch(() => null);
  if (!c) return "";
  const f = c.thirteen_f;
  const ev = (limit ? c.earnings.filter((e) => e.n_holders).slice(0, limit) : c.earnings);
  return `<div class="deadline">
      <div><span>Prochains 13F</span><b>${f.days_left > 0 ? `dans ${f.days_left} j` : f.days_left === 0 ? "aujourd'hui" : "échéance passée"}</b></div>
      <p>Les gérants doivent publier leur portefeuille du ${fdate(f.quarter_end)} avant le <b>${fdate(f.deadline)}</b>. ${f.filed.length} sur ${f.filed.length + f.pending.length} l'ont déjà fait${f.filed.length ? ` : ${esc(f.filed.slice(0, 4).map((x) => x.name).join(", "))}${f.filed.length > 4 ? "…" : ""}` : ""}.</p>
    </div>
    ${ev.length ? `<div class="list">${ev.map((e) => `<a class="row" href="#/s/${encodeURIComponent(e.symbol)}">
      <div class="logo-tk">${esc(e.symbol.slice(0, 5))}</div>
      <div class="name">${esc(e.name)}</div>
      <div class="amt">${fdate(e.date, { weekday: "short", day: "numeric", month: "short" })}</div>
      <div class="what"><span class="ell">${e.n_holders ? `Détenue par ${esc(e.holders.join(", "))}${e.n_holders > e.holders.length ? "…" : ""}` : "Suivie pour les initiés"}</span></div>
      <div class="perf">${e.time === "pre-market" ? "avant Bourse" : e.time === "after-hours" ? "après Bourse" : ""}</div>
      <div class="meta">Résultats ${esc(e.quarter || "")}${e.eps_forecast ? `, BPA attendu ${esc(e.eps_forecast)}` : ""}</div></a>`).join("")}</div>` : ""}`;
}

async function viewAgenda() {
  $view.innerHTML = `<h1 class="page-title">Agenda</h1><p class="lede">Échéances des 13F et publications de résultats des actions détenues par les gérants suivis, sur trois semaines.</p><div id="ag"></div>`;
  document.getElementById("ag").innerHTML = await agendaHtml(0);
}

async function viewSearch() {
  $view.innerHTML = `
    <h1 class="page-title">Rechercher</h1>
    <label class="searchbar"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
      <input id="q" placeholder="Nom, entreprise ou ticker (ex : AAPL, VIV.PA)" autocomplete="off" autocapitalize="off" value="${esc(store.get("lastQ", ""))}"></label>
    <div id="results"></div>`;
  const q = document.getElementById("q");
  const results = document.getElementById("results");
  let timer;
  const order = (list) => [...list].sort((a, b) => (a.category === "fr") - (b.category === "fr") || (b.last_filing || "").localeCompare(a.last_filing || ""));
  const block = (title, list) => list.length ? `<section class="section"><h2>${title}</h2><p class="sub">${list.length}, les plus récemment actifs d'abord</p><div class="list">${order(list).map(invRow).join("")}</div></section>` : "";
  const run = async () => {
    const v = q.value.trim();
    store.set("lastQ", v);
    if (!v) {
      const all = await investors();
      results.innerHTML = block("Investisseurs", all.filter((i) => i.type === "investor")) + block("Entreprises", all.filter((i) => i.type === "company"));
      return;
    }
    const r = await api(`/search?q=${encodeURIComponent(v)}`);
    let html = block("Investisseurs", r.investors.filter((i) => i.type === "investor")) + block("Entreprises", r.investors.filter((i) => i.type === "company"));
    if (r.ticker) {
      html = `<a class="stock-link" href="#/s/${encodeURIComponent(r.ticker)}"><b>${esc(r.ticker)}</b> Voir la fiche de l'action : détenteurs, initiés, cours</a>` + html;
      if (r.holders.length) html += `<section class="section"><h2>Qui détient ${esc(r.ticker)} ?</h2><p class="sub">Selon le dernier 13F de chaque investisseur</p>
        <div class="list">${r.holders.map((h) => `<a class="row" href="#/i/${esc(h.investor_id)}">${avatar(h.investor_id)}
          <div class="main"><div class="l1">${esc(h.investor_name)}</div><div class="l2">${num(h.shares)} titres · ${quarter(h.period)}</div></div>
          <div class="right"><div class="amt">${usd(h.value)}</div></div></a>`).join("")}</div></section>`;
      if (r.trades.length) html += `<section class="section">${officialHead(`Mouvements sur ${esc(r.ticker)}`, "Achats et ventes déclarés")}
        <div class="list">${r.trades.map((t) => tradeRow(t, { showInvestor: true })).join("")}</div></section>`;
    }
    results.innerHTML = html || `<div class="empty">Aucun résultat pour « ${esc(v)} »</div>`;
  };
  q.oninput = () => { clearTimeout(timer); timer = setTimeout(run, 220); };
  run();
  q.focus();
}

const invRow = (i) => `<a class="row" href="#/i/${esc(i.id)}">${avatar(i.id, i.logo)}
  <div class="main"><div class="l1">${esc(i.name)}</div><div class="l2">${esc(i.subtitle || "")} · ${esc(catLabel(i))}</div></div>
  <div class="right"><div class="amt">${i.portfolio_value ? usd(i.portfolio_value) : ""}</div><div class="date">${ago(i.last_filing)}</div></div></a>`;

async function viewFeed(mode) {
  mode = mode === "press" ? "press" : "official";
  const space = store.get("feedSpace", "investor");
  const seen = store.get("feedSeen", "");
  $view.innerHTML = `<h1 class="page-title">Flux</h1>
    ${segmented("fmode", [["official", "Officiel"], ["press", "Presse & rumeurs"]], mode)}
    ${chipsHtml("fspace", Object.entries(SPACES).map(([k, v]) => [k, v.label]), space)}
    <div id="feed-body" style="margin-top:14px"><div class="list skeleton" style="height:300px"></div></div>`;
  bind("#fmode", (k) => { location.hash = k === "press" ? "#/feed/press" : "#/feed"; });
  bind("#fspace", (k) => { store.set("feedSpace", k); viewFeed(mode); });
  const body = document.getElementById("feed-body");
  if (mode === "press") {
    const p = await api(`/press?type=${space}&limit=80`);
    body.innerHTML = UNOFF_NOTE
      + (p.unofficial.length ? `<div class="day">Déclarations publiques & rumeurs</div><div class="list">${p.unofficial.map((u) => claimRow(u, { showEntity: true })).join("")}</div>` : "")
      + `<div class="day">Articles de presse</div>` + (p.articles.length ? `<div class="list">${p.articles.map((a) => articleRow(a, { showEntity: true })).join("")}</div>` : `<div class="empty">Aucun article.</div>`);
    return;
  }
  const rows = groupTrades(await api(`/feed?limit=200&type=${space}`));
  if (rows[0]) store.set("feedSeen", rows[0].filed_at);
  updateBadge(0);
  const groups = new Map();
  for (const t of rows) {
    const k = `Publié ${ago(t.filed_at?.slice(0, 10))}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  }
  body.innerHTML = `<p class="legend">Déclarations obligatoires uniquement (SEC, AMF, Congrès), de la plus récemment publiée à la plus ancienne. ${PERF_LEGEND}.</p>`
    + (rows.length ? [...groups].map(([k, ts]) => `<div class="day">${esc(k)}</div><div class="list">${ts.map((t) => tradeRow(t, { showInvestor: true, isNew: seen && t.filed_at > seen })).join("")}</div>`).join("")
      : `<div class="empty">Aucune transaction pour l'instant.</div>`);
}

async function viewAbout() {
  const s = await api("/status").catch(() => ({}));
  $view.innerHTML = `<h1 class="page-title">Sources</h1>
    <div class="list">
      ${s.mode === "static" ? `
      <div class="kv"><span>Dernière mise à jour</span><span>${agoTime(s.generated_at)}</span></div>
      <div class="kv"><span>Fréquence</span><span>toutes les 30 min environ</span></div>` : `
      <div class="kv"><span>Flux EDGAR (temps réel)</span><span>${agoTime(s.last_live_poll)}</span></div>
      <div class="kv"><span>Chambre des représentants</span><span>${agoTime(s.last_house_refresh)}</span></div>
      <div class="kv"><span>Rafraîchissement complet</span><span>${agoTime(s.last_full_refresh)}</span></div>`}
      <div class="kv"><span>Transactions en base</span><span>${num(s.trades)}</span></div>
    </div>
    <div class="prose">
      <h3><span class="stamp">Officiel</span> Form 4 — SEC (≤ 2 jours ouvrés)</h3>
      <p>Déposé par tout dirigeant ou actionnaire détenant plus de 10 % d'une société US : Berkshire, Icahn, Pershing… y déclarent leurs achats et ventes sur leurs grosses participations.</p>
      <h3><span class="stamp">Officiel</span> 13D / 13G — SEC (participation de plus de 5 %)</h3>
      <p>Déposés quand un investisseur franchit 5 % du capital d'une société : sous 5 jours ouvrés pour un 13D (investisseur actif, ex. Icahn, Elliott), 45 jours pour un 13G (passif). Plus rapides que le 13F pour repérer une grosse prise de position.</p>
      <h3><span class="stamp">Officiel</span> 13F — SEC (trimestriel, ≤ 45 jours)</h3>
      <p>Photographie des positions longues US des gérants de plus de 100 M$. Les « achats/ventes » 13F sont déduits de la différence entre deux trimestres : ni date ni prix exacts.</p>
      <h3><span class="stamp">Officiel</span> AMF — déclarations des dirigeants (≤ 3 jours ouvrés)</h3>
      <p>Achats et ventes par les dirigeants des sociétés cotées à Paris et leurs proches (dont leurs holdings : ex. Compagnie de l'Odet pour la famille Bolloré).</p>
      <h3><span class="stamp">Officiel</span> STOCK Act — élus du Congrès (≤ 45 jours)</h3>
      <p>Déclarations de la Chambre des représentants, montants par tranches. Le portefeuille affiché est une estimation.</p>
      <h3><span class="stamp">Données publiques</span> Médias détenus</h3>
      <p>Base « Médias français, qui possède quoi ? » du Monde diplomatique et d'Acrimed (licence ODC-By), mise à jour fin 2024.</p>
      <h3><span class="pencil">non vérifié</span> Presse & rumeurs</h3>
      <p>Articles de presse (Google News), propos des investisseurs sur les réseaux sociaux et rumeurs : toujours affichés à part, avec leur statut (Presse, Déclaration publique, Rumeur) et leurs sources. Les rachats de startups sont vérifiés un par un.</p>
      <p style="color:var(--muted)">Ceci n'est pas un conseil en investissement. Photos : Wikipédia / Wikimedia Commons.</p>
    </div>`;
}

// ------------------------------------------------------------------ badge de nouveautés
function updateBadge(n) {
  const b = document.getElementById("feed-badge");
  b.hidden = !n;
  b.textContent = n > 99 ? "99+" : n;
}
async function pollNew() {
  try {
    const seen = store.get("feedSeen", "");
    const rows = await api("/feed?limit=100");
    if (!seen && rows[0]) { store.set("feedSeen", rows[0].filed_at); return; }
    const fresh = rows.filter((r) => r.filed_at > seen);
    if (location.hash.startsWith("#/feed")) return;
    updateBadge(fresh.length);
    if (fresh.length && "Notification" in window && Notification.permission === "granted" && document.hidden) {
      const t = fresh[0];
      new Notification(`${t.investor_name} : ${ACTIONS[t.action]?.[0] || t.action} ${t.ticker || ""}`, { body: `${amount(t)} · ${SOURCES[t.source]}` });
    }
  } catch { /* hors ligne */ }
}

// ------------------------------------------------------------------ routeur
async function route() {
  const [, page, id, tab] = (location.hash || "#/").split("/");
  document.querySelectorAll(".tabbar a").forEach((a) => a.classList.toggle("on",
    a.dataset.tab === (page === "i" ? "home" : page || "home")));
  window.scrollTo(0, 0);
  try {
    await investors();  // charge la liste (et les photos) avant tout affichage
    if (page === "i" && id) await viewInvestor(id, tab);
    else if (page === "search") await viewSearch();
    else if (page === "ranking") await viewRanking();
    else if (page === "s" && id) await viewStock(id);
    else if (page === "agenda") await viewAgenda();
    else if (page === "insiders") await viewInsiders();
    else if (page === "feed") await viewFeed(id);
    else if (page === "about") await viewAbout();
    else await viewHome();
  } catch (e) {
    $view.innerHTML = `<div class="empty">Impossible de charger les données.<br><small>${esc(e.message)}</small></div>`;
  }
}
window.addEventListener("hashchange", route);
route();
setInterval(() => { INVESTORS = null; RANKING = null; pollNew(); }, 60_000);
pollNew();
// demande la permission de notifier au premier ajout en favori
document.addEventListener("click", (e) => {
  if (e.target.closest("#fav") && "Notification" in window && Notification.permission === "default") Notification.requestPermission();
});
