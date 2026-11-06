/* 13F Tracker — front mobile (vanilla JS, routage par hash) */
const $view = document.getElementById("view");
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* stockage indisponible */ } },
};

// ------------------------------------------------------------------ utilitaires
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const api = async (path) => {
  const r = await fetch(`/api${path}`);
  if (!r.ok) throw new Error(`${r.status} ${path}`);
  return r.json();
};
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
  return fdate(d);
};
const quarter = (p) => { if (!p) return "—"; const [y, m] = p.split("-"); return `T${Math.ceil(+m / 3)} ${y}`; };

const ACTIONS = {
  BUY: ["Achat", "buy"], SELL: ["Vente", "sell"], NEW: ["Nouvelle ligne", "buy"], ADD: ["Renforce", "buy"],
  REDUCE: ["Allège", "sell"], EXIT: ["Sortie", "sell"], EXCHANGE: ["Échange", "neutral"],
};
const SOURCES = { "13F": "13F", FORM4: "Form 4", HOUSE: "STOCK Act" };
const KINDS = { fund: "Gérants", politician: "Élus", company: "Entreprises" };

const amount = (t) => {
  if (t.value != null) return usd(t.value);
  if (t.value_low != null) return t.value_high ? `${usd(t.value_low)} – ${usd(t.value_high)}` : `> ${usd(t.value_low)}`;
  return "—";
};
const imgTag = (inv, cls = "") => `<img class="${cls} ${inv.kind === "company" ? "logo" : ""}" src="/api/photo/${esc(inv.id)}" alt="" loading="lazy">`;

// ------------------------------------------------------------------ favoris / flux
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

function tradeRow(t, { showInvestor = false, isNew = false } = {}) {
  const [label, cls] = ACTIONS[t.action] || [t.action, "neutral"];
  const lead = showInvestor
    ? `<img class="avatar ${t.investor_kind === "company" ? "logo" : ""}" src="/api/photo/${esc(t.investor_id)}" alt="" loading="lazy">`
    : `<div class="logo-tk">${esc((t.ticker || "—").slice(0, 5))}</div>`;
  const what = showInvestor
    ? `${esc(t.investor_name)} · ${esc(t.ticker || t.issuer || "")}`
    : `<span class="tk">${esc(t.ticker || "")}</span> ${t.ticker ? "" : esc(t.issuer || "")}`;
  const sub = [t.issuer && (t.ticker || showInvestor) ? t.issuer : null, t.details].filter(Boolean).join(" · ");
  const href = showInvestor ? `#/i/${esc(t.investor_id)}` : esc(t.url || "#");
  const target = showInvestor ? "" : ` target="_blank" rel="noopener"`;
  return `<a class="row ${isNew ? "new" : ""} pos" href="${href}"${target}>
    ${lead}
    <div class="main">
      <div class="l1"><span class="pill ${cls}">${label}</span><span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${what}</span></div>
      <div class="l2">${esc(sub)}</div>
    </div>
    <div class="right">
      <div class="amt">${amount(t)}</div>
      <div class="date">${t.source === "13F" ? quarter(t.trade_date) : fdate(t.trade_date, { day: "numeric", month: "short" })} <span class="src">${SOURCES[t.source] || t.source}</span></div>
    </div>
  </a>`;
}

const skeleton = (n = 3) => `<div class="rail">${Array.from({ length: n }, () => `<div class="card skeleton"></div>`).join("")}</div>`;

// ------------------------------------------------------------------ vues
let INVESTORS = null;
async function investors() {
  INVESTORS = INVESTORS || (await api("/investors"));
  return INVESTORS;
}

async function viewHome() {
  const kind = store.get("homeKind", "");
  $view.innerHTML = `
    <h1 class="page-title">Explorer</h1>
    <a class="searchbar" href="#/search">
      <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
      <span>Investisseur, fonds ou ticker</span>
    </a>
    <div class="chips" id="kinds">
      ${[["", "Tous"], ...Object.entries(KINDS)].map(([k, l]) => `<button class="chip ${k === kind ? "on" : ""}" data-k="${k}">${l}</button>`).join("")}
    </div>
    <div id="home-body">${skeleton()}</div>`;
  $view.querySelectorAll("#kinds .chip").forEach((b) => b.onclick = () => { store.set("homeKind", b.dataset.k); viewHome(); });

  const [all, feed] = await Promise.all([investors(), api(`/feed?limit=8${kind ? `&kind=${kind}` : ""}`)]);
  const list = all.filter((i) => !kind || i.kind === kind);
  const fav = favs().map((id) => all.find((i) => i.id === id)).filter(Boolean);
  const recent = [...list].filter((i) => i.last_filing).sort((a, b) => b.last_filing.localeCompare(a.last_filing));
  const biggest = [...list].filter((i) => i.portfolio_value).sort((a, b) => b.portfolio_value - a.portfolio_value);
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
  const hot = (i) => i.last_filing && i.last_filing >= weekAgo ? `<span class="tag hot">Nouveau</span>` : "";

  let html = "";
  if (fav.length) html += `<section class="section"><h2>Mes suivis</h2><p class="sub">Investisseurs que vous suivez</p>
    <div class="rail">${fav.map((i) => card(i, { large: true, tag: hot(i) })).join("")}</div></section>`;
  html += `<section class="section"><div class="section-head"><h2>Dernières déclarations</h2><a href="#/feed">Tout voir</a></div>
    <p class="sub">Transactions publiées le plus récemment</p>
    ${feed.length ? `<div class="list">${feed.map((t) => tradeRow(t, { showInvestor: true })).join("")}</div>` : `<div class="note">Premier scraping en cours… les données arrivent dans quelques minutes.</div>`}</section>`;
  html += `<section class="section"><h2>Récemment actifs</h2><p class="sub">Dernier dépôt auprès de la SEC ou de la Chambre</p>
    <div class="rail">${recent.slice(0, 12).map((i) => card(i, { tag: hot(i) })).join("")}</div></section>`;
  if (biggest.length) html += `<section class="section"><h2>Les plus gros portefeuilles</h2><p class="sub">Valeur déclarée dans le dernier 13F</p>
    <div class="rail">${biggest.slice(0, 12).map((i) => card(i, { tag: `<span class="tag">${usd(i.portfolio_value)}</span>` })).join("")}</div></section>`;
  for (const [k, label] of Object.entries(KINDS)) {
    if (kind && kind !== k) continue;
    const g = list.filter((i) => i.kind === k);
    if (g.length) html += `<section class="section"><h2>${label}</h2><p class="sub">${g.length} suivis</p>
      <div class="rail">${g.map((i) => card(i)).join("")}</div></section>`;
  }
  document.getElementById("home-body").innerHTML = html;
}

async function viewInvestor(id, tab) {
  tab = tab || store.get(`tab:${id}`, "trades");
  $view.innerHTML = `<div class="hero skeleton"></div>`;
  const inv = await api(`/investors/${id}`);
  const isFav = favs().includes(id);
  const valueLabel = inv.kind === "politician" ? "Transactions" : "Valeur 13F";
  const valueVal = inv.kind === "politician" ? num(inv.trade_count) : usd(inv.portfolio_value);
  $view.innerHTML = `
    <div class="hero">
      ${imgTag(inv)}
      <div class="top">
        <button class="iconbtn" onclick="history.length > 1 ? history.back() : location.hash = '#/'" aria-label="Retour"><svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg></button>
        <button class="iconbtn ${isFav ? "on" : ""}" id="fav" aria-label="Suivre"><svg viewBox="0 0 24 24"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg></button>
      </div>
      <div class="who"><h1>${esc(inv.name)}</h1><div class="firm">${esc(inv.subtitle || "")}</div></div>
    </div>
    <div class="stats">
      <div class="stat"><div class="k">${valueLabel}</div><div class="v">${valueVal}</div></div>
      <div class="stat"><div class="k">${inv.kind === "politician" ? "Source" : "Positions"}</div><div class="v">${inv.kind === "politician" ? "STOCK Act" : num(inv.positions)}</div></div>
      <div class="stat"><div class="k">Dernier dépôt</div><div class="v">${ago(inv.last_filing)}</div></div>
    </div>
    <div class="srcinfo">${(inv.sources || []).map((s) => `<span><b>${s.label}</b> · ${esc(s.delay)}</span>`).join("")}</div>
    ${inv.unparsed?.length ? `<div class="note" style="margin-top:12px">${inv.unparsed.length} déclaration(s) déposée(s) sur papier puis scannée(s) : non lisibles automatiquement.
      Dernière : <a style="color:var(--accent)" href="${esc(inv.unparsed[0].url)}" target="_blank" rel="noopener">PDF du ${fdate(inv.unparsed[0].filed_at)}</a></div>` : ""}
    <div class="tabs">
      <button data-t="trades" class="${tab === "trades" ? "on" : ""}">Achats &amp; ventes</button>
      <button data-t="portfolio" class="${tab === "portfolio" ? "on" : ""}">Portefeuille</button>
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
  return renderPortfolio(inv, body);
}

async function renderTrades(inv, body, source = "") {
  const trades = await api(`/investors/${inv.id}/trades${source ? `?source=${source}` : ""}`);
  const srcs = (inv.sources || []).map((s) => s.source).filter((s) => s !== "FORM4" || inv.kind !== "company");
  const chips = srcs.length > 1 ? `<div class="chips" style="margin-top:0;margin-bottom:6px">
    ${[["", "Tout"], ...srcs.map((s) => [s, SOURCES[s]])].map(([k, l]) => `<button class="chip ${k === source ? "on" : ""}" data-s="${k}">${l}</button>`).join("")}</div>` : "";
  if (!trades.length) {
    body.innerHTML = chips + `<div class="empty">Aucune transaction déclarée pour l'instant.</div>`;
  } else {
    // groupement par mois (ou trimestre pour 13F)
    const groups = new Map();
    for (const t of trades) {
      const key = t.source === "13F" ? `Variations ${quarter(t.trade_date)} (13F)` : fdate(t.trade_date, { month: "long", year: "numeric" });
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(t);
    }
    body.innerHTML = chips + [...groups].map(([k, ts]) => `<div class="day">${esc(k)}</div><div class="list">${ts.map((t) => tradeRow(t)).join("")}</div>`).join("");
  }
  body.querySelectorAll(".chip").forEach((b) => b.onclick = () => renderTrades(inv, body, b.dataset.s));
}

async function renderPortfolio(inv, body) {
  const pf = await api(`/investors/${inv.id}/portfolio`);
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
          <div class="l1"><span class="tk">${esc(p.ticker || "")}</span><span class="l2" style="margin:0">${esc(p.issuer || "")}</span></div>
          <div class="l2">${p.buys} achat(s) · ${p.sells} vente(s) partielle(s) · dernier mvt ${fdate(p.last_date)}</div>
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
      const f4 = p.after_13f ? `<div class="f4">Form 4 du ${fdate(p.after_13f.trade_date)} : ${ACTIONS[p.after_13f.action][0].toLowerCase()} → ${num(p.after_13f.shares_after)} titres</div>` : "";
      return `<div class="row pos">
        <div class="logo-tk">${esc((p.ticker || p.issuer || "—").slice(0, 5))}</div>
        <div class="main">
          <div class="l1"><span class="tk">${esc(p.ticker || p.issuer)}</span>${p.put_call ? `<span class="pill neutral">${esc(p.put_call)}</span>` : ""}${ch ? `<span class="pill ${ch[1]}">${ch[0]}</span>` : ""}</div>
          <div class="l2">${esc(p.issuer)} · ${num(p.shares)} titres</div>
          <div class="bar"><i style="width:${(p.weight / max) * 100}%"></i></div>
          ${f4}
        </div>
        <div class="right"><div class="amt">${p.weight.toFixed(1)} %</div><div class="date">${usd(p.value)}</div></div>
      </div>`;
    }).join("")}</div>`;
}

async function viewSearch() {
  $view.innerHTML = `
    <h1 class="page-title">Rechercher</h1>
    <label class="searchbar"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
      <input id="q" placeholder="Nom, fonds ou ticker (ex : AAPL)" autocomplete="off" autocapitalize="off" value="${esc(store.get("lastQ", ""))}"></label>
    <div id="results"></div>`;
  const q = document.getElementById("q");
  const results = document.getElementById("results");
  let timer;
  const run = async () => {
    const v = q.value.trim();
    store.set("lastQ", v);
    if (!v) {
      const all = await investors();
      results.innerHTML = `<section class="section"><h2>Tous les investisseurs</h2><p class="sub">${all.length} suivis</p>
        <div class="list">${all.map(invRow).join("")}</div></section>`;
      return;
    }
    const r = await api(`/search?q=${encodeURIComponent(v)}`);
    let html = "";
    if (r.investors.length) html += `<section class="section"><h2>Investisseurs</h2><div class="list" style="margin-top:12px">${r.investors.map(invRow).join("")}</div></section>`;
    if (r.ticker) {
      if (r.holders.length) html += `<section class="section"><h2>Qui détient ${esc(r.ticker)} ?</h2><p class="sub">Selon le dernier 13F de chaque investisseur</p>
        <div class="list">${r.holders.map((h) => `<a class="row" href="#/i/${esc(h.investor_id)}"><img class="avatar" src="/api/photo/${esc(h.investor_id)}" alt="">
          <div class="main"><div class="l1">${esc(h.investor_name)}</div><div class="l2">${num(h.shares)} titres · ${quarter(h.period)}</div></div>
          <div class="right"><div class="amt">${usd(h.value)}</div></div></a>`).join("")}</div></section>`;
      if (r.trades.length) html += `<section class="section"><h2>Mouvements sur ${esc(r.ticker)}</h2><p class="sub">Achats et ventes déclarés</p>
        <div class="list">${r.trades.map((t) => tradeRow(t, { showInvestor: true })).join("")}</div></section>`;
    }
    results.innerHTML = html || `<div class="empty">Aucun résultat pour « ${esc(v)} »</div>`;
  };
  q.oninput = () => { clearTimeout(timer); timer = setTimeout(run, 220); };
  run();
  q.focus();
}

const invRow = (i) => `<a class="row" href="#/i/${esc(i.id)}"><img class="avatar ${i.kind === "company" ? "logo" : ""}" src="/api/photo/${esc(i.id)}" alt="" loading="lazy">
  <div class="main"><div class="l1">${esc(i.name)}</div><div class="l2">${esc(i.subtitle || "")} · ${KINDS[i.kind]}</div></div>
  <div class="right"><div class="amt">${i.portfolio_value ? usd(i.portfolio_value) : ""}</div><div class="date">${ago(i.last_filing)}</div></div></a>`;

async function viewFeed() {
  const kind = store.get("feedKind", "");
  const seen = store.get("feedSeen", "");
  $view.innerHTML = `<h1 class="page-title">Flux</h1>
    <p class="sub" style="color:var(--muted);margin-top:-8px">Toutes les transactions, de la plus récemment publiée à la plus ancienne. Actualisé chaque minute.</p>
    <div class="chips" id="fk">${[["", "Tous"], ...Object.entries(KINDS)].map(([k, l]) => `<button class="chip ${k === kind ? "on" : ""}" data-k="${k}">${l}</button>`).join("")}</div>
    <div id="feed-body" style="margin-top:14px"><div class="list skeleton" style="height:300px"></div></div>`;
  $view.querySelectorAll("#fk .chip").forEach((b) => b.onclick = () => { store.set("feedKind", b.dataset.k); viewFeed(); });
  const rows = await api(`/feed?limit=200${kind ? `&kind=${kind}` : ""}`);
  if (rows[0]) store.set("feedSeen", rows[0].filed_at);
  updateBadge(0);
  const groups = new Map();
  for (const t of rows) {
    const k = `Publié ${ago(t.filed_at?.slice(0, 10))}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  }
  document.getElementById("feed-body").innerHTML = rows.length
    ? [...groups].map(([k, ts]) => `<div class="day">${esc(k)}</div><div class="list">${ts.map((t) => tradeRow(t, { showInvestor: true, isNew: seen && t.filed_at > seen })).join("")}</div>`).join("")
    : `<div class="empty">Aucune transaction pour l'instant.</div>`;
}

async function viewAbout() {
  const s = await api("/status").catch(() => ({}));
  $view.innerHTML = `<h1 class="page-title">Sources</h1>
    <div class="list">
      <div class="kv"><span>Flux EDGAR (temps réel)</span><span>${ago(s.last_live_poll)}</span></div>
      <div class="kv"><span>Chambre des représentants</span><span>${ago(s.last_house_refresh)}</span></div>
      <div class="kv"><span>Rafraîchissement complet</span><span>${ago(s.last_full_refresh)}</span></div>
      <div class="kv"><span>Transactions en base</span><span>${num(s.trades)}</span></div>
    </div>
    <div class="prose">
      <h3>Form 4 — le plus rapide (≤ 2 jours ouvrés)</h3>
      <p>Déposé par tout dirigeant ou actionnaire détenant plus de 10 % d'une société US. C'est la seule source quasi temps réel : Berkshire, Icahn, Pershing… y déclarent leurs achats et ventes sur leurs grosses participations. Le serveur interroge le flux EDGAR chaque minute.</p>
      <h3>13F — portefeuille trimestriel (≤ 45 jours)</h3>
      <p>Photographie des positions longues US des gérants de plus de 100 M$, à la fin de chaque trimestre. Les « achats/ventes » 13F sont déduits de la différence entre deux trimestres : on ne connaît ni la date ni le prix exacts.</p>
      <h3>STOCK Act — élus du Congrès (≤ 45 jours)</h3>
      <p>Periodic Transaction Reports de la Chambre des représentants, parsés depuis les PDF officiels. Les montants sont déclarés par tranches (ex. 1 001 $ – 15 000 $). Le portefeuille affiché est une estimation à partir des transactions.</p>
      <p style="color:var(--muted)">Données publiques SEC EDGAR et House Clerk. Ceci n'est pas un conseil en investissement.</p>
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
    if (page === "i" && id) await viewInvestor(id, tab);
    else if (page === "search") await viewSearch();
    else if (page === "feed") await viewFeed();
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
