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
    if (t) return getJSON(`press-${t}.json`);
    const [a, b] = await Promise.all([getJSON("press-investor.json"), getJSON("press-company.json")]);
    return { unofficial: [...a.unofficial, ...b.unofficial], articles: [...a.articles, ...b.articles].sort((x, y) => (y.published || "").localeCompare(x.published || "")) };
  }
  if (parts[0] === "feed") {
    let rows = await getJSON(q.get("type") ? `feed-${q.get("type")}.json` : "feed.json");
    if (q.get("cat")) rows = rows.filter((r) => r.investor_category === q.get("cat"));
    return rows.slice(0, +(q.get("limit") || 60));
  }
  if (parts[0] === "status") return getJSON("status.json");
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
  SHORT: ["Vente à découvert", "sell"],
};
const SOURCES = { "13F": "13F", FORM4: "Form 4", HOUSE: "STOCK Act", AMF: "AMF" };
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
    <div class="meta"><div class="name">${esc(inv.name)}</div><div class="firm">${esc(inv.subtitle || "")}</div></div>
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
  const href = showInvestor ? `#/i/${esc(t.investor_id)}` : esc(t.url || "#");
  const target = showInvestor ? "" : ` target="_blank" rel="noopener"`;
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
    <h1 class="page-title">Explorer</h1>
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
  const [all, feed, pr, acqs] = await Promise.all([investors(), api(`/feed?limit=8&${q}`), api(`/press?type=${space}`),
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
    ${feed.length ? `<div class="list">${feed.map((t) => tradeRow(t, { showInvestor: true })).join("")}</div>` : `<div class="note">Aucune déclaration pour l'instant (ou premier chargement en cours).</div>`}</section>`;

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
  body.innerHTML = `<div class="note">Portefeuille au <b>${fdate(pf.period)}</b> (${quarter(pf.period)}) · total ${usd(pf.total_value)} ·
    positions longues US uniquement (pas de shorts, ni d'actifs hors 13F).</div>
    <div class="list">${pf.positions.map((p) => {
      const ch = p.change ? ACTIONS[p.change] : null;
      const f4 = p.after_13f ? `<div class="f4">Après le 13F (Form 4) : détient ${num(p.after_13f.shares_after)} titres au ${fdate(p.after_13f.trade_date)}</div>` : "";
      const lm = p.last_move;
      const when = !lm ? "" : lm.exact
        ? `<span class="when">${ACTIONS[lm.action][0]} le ${fdate(lm.date, { day: "numeric", month: "short", year: "numeric" })}</span>`
        : `<span class="when" title="Le 13F ne donne pas la date exacte : mouvement entre le ${fdate(lm.from)} et le ${fdate(lm.date)}">au ${quarter(lm.date)}</span>`;
      return `<div class="row pos">
        <div class="logo-tk">${esc((p.ticker || p.issuer || "—").slice(0, 5))}</div>
        <div class="main">
          <div class="l1 wrap"><span class="tk">${esc(p.ticker || tc(p.issuer))}</span>${p.put_call ? `<span class="pill neutral">${esc(p.put_call)}</span>` : ""}${ch ? `<span class="pill ${ch[1]}">${ch[0]}</span>` : ""}${when}</div>
          <div class="l2">${esc(tc(p.issuer))}, ${num(p.shares)} titres</div>
          <div class="bar"><i style="width:${(p.weight / max) * 100}%"></i></div>
          ${f4}
        </div>
        <div class="right"><div class="amt">${p.weight.toFixed(1)} %</div><div class="date">${usd(p.value)}</div></div>
      </div>`;
    }).join("")}</div>`;
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

async function viewSearch() {
  $view.innerHTML = `
    <h1 class="page-title">Rechercher</h1>
    <label class="searchbar"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
      <input id="q" placeholder="Nom, entreprise ou ticker (ex : AAPL, VIV.PA)" autocomplete="off" autocapitalize="off" value="${esc(store.get("lastQ", ""))}"></label>
    <div id="results"></div>`;
  const q = document.getElementById("q");
  const results = document.getElementById("results");
  let timer;
  const block = (title, list) => list.length ? `<section class="section"><h2>${title}</h2><p class="sub">${list.length}</p><div class="list">${list.map(invRow).join("")}</div></section>` : "";
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
  const rows = await api(`/feed?limit=200&type=${space}`);
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
    else if (page === "feed") await viewFeed(id);
    else if (page === "about") await viewAbout();
    else await viewHome();
  } catch (e) {
    $view.innerHTML = `<div class="empty">Impossible de charger les données.<br><small>${esc(e.message)}</small></div>`;
  }
}
window.addEventListener("hashchange", route);
route();
setInterval(() => { INVESTORS = null; pollNew(); }, 60_000);
pollNew();
// demande la permission de notifier au premier ajout en favori
document.addEventListener("click", (e) => {
  if (e.target.closest("#fav") && "Notification" in window && Notification.permission === "default") Notification.requestPermission();
});
