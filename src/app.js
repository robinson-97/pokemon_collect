import { fetchSets, fetchSetCards } from './api.js';
import * as store from './store.js';
import { summarize, usd, categoryOf, TYPE_NL, TYPE_COLOR } from './calc.js';

const $ = sel => document.querySelector(sel);
const app = $('#app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const price = p => (p == null ? '—' : usd.format(p));

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (t.hidden = true), 3500);
}

/* ---------- Kaarten laden (cache + verversen) ---------- */
async function loadCards(setId, { force = false } = {}) {
  const cached = store.getCachedCards(setId);
  if (cached && cached.fresh && !force) return { cards: cached.cards, at: cached.at };
  try {
    const cards = await fetchSetCards(setId);
    store.setCachedCards(setId, cards);
    return { cards, at: Date.now() };
  } catch (e) {
    if (cached) { toast('Kon prijzen niet verversen, oude data getoond'); return { cards: cached.cards, at: cached.at }; }
    throw e;
  }
}

/* ---------- Overzicht van gekozen sets ---------- */
async function renderHome() {
  const sets = store.trackedSets();
  if (!sets.length) {
    app.innerHTML = `<section class="empty"><h1>Welkom!</h1>
      <p>Kies de sets die je spaart. Alleen die sets komen in je overzicht.</p>
      <button class="btn primary big" data-act="add">+ Set toevoegen</button></section>`;
    return;
  }
  app.innerHTML = `<h1>Mijn sets</h1><div class="set-grid">${sets.map(s => `
    <a class="set-tile" href="#/set/${esc(s.id)}" data-id="${esc(s.id)}">
      ${s.images?.logo ? `<img class="logo" src="${esc(s.images.logo)}" alt="" loading="lazy">` : ''}
      <h3>${esc(s.name)}</h3><p class="muted">${esc(s.series)}</p>
      <div class="bar"><span style="width:0"></span></div>
      <p class="stats muted">Laden…</p>
    </a>`).join('')}</div>`;
  for (const s of sets) {
    const tile = app.querySelector(`.set-tile[data-id="${CSS.escape(s.id)}"]`);
    try {
      const { cards } = await loadCards(s.id);
      const sum = summarize(cards, store.ownedIds(s.id));
      tile.querySelector('.bar span').style.width = sum.percent + '%';
      tile.querySelector('.stats').innerHTML =
        `<b>${sum.owned}/${sum.total}</b> · ${sum.percent}%<br>Nog nodig: <b>${price(sum.costToComplete)}</b>`;
    } catch {
      tile.querySelector('.stats').textContent = 'Kon kaarten niet laden';
    }
  }
}

/* ---------- Eén set ---------- */
let view = { filter: 'all', q: '', type: '' };

async function renderSet(setId) {
  const set = store.trackedSets().find(s => s.id === setId);
  if (!set) { location.hash = '#/'; return; }
  view = { filter: 'all', q: '', type: '' };
  app.innerHTML = `<p class="muted">Kaarten laden…</p>`;
  let data;
  try { data = await loadCards(setId); }
  catch { app.innerHTML = `<p class="error">Kon de kaarten niet laden. <button class="btn" data-act="retry">Opnieuw</button></p>`; return; }
  const { cards } = data;
  const owned = store.ownedIds(setId);

  app.innerHTML = `
    <a href="#/" class="back">← Alle sets</a>
    <div class="set-head">
      <div><h1>${esc(set.name)}</h1><p class="muted">${esc(set.series)}</p></div>
      <div class="summary" id="summary"></div>
    </div>
    <div class="toolbar">
      <div class="seg" id="filters">
        <button data-f="all" class="on">Alle</button>
        <button data-f="missing">Ontbreekt</button>
        <button data-f="owned">In bezit</button>
      </div>
      <input id="q" type="search" placeholder="Zoek kaart of nummer…">
      <button class="btn ghost" id="refresh" title="Prijzen opnieuw ophalen">↻ Prijzen</button>
      <button class="btn ghost danger" id="remove">Set verwijderen</button>
    </div>
    <div class="types" id="types"></div>
    <p class="muted small" id="updated"></p>
    <div class="card-grid" id="grid"></div>`;

  const grid = $('#grid');
  grid.innerHTML = cards.map(c => `
    <article class="card" data-id="${esc(c.id)}">
      <button class="card-img" data-act="open" aria-label="Vergroot ${esc(c.name)}">
        <img src="${esc(c.large)}" width="734" height="1024"
             alt="${esc(c.name)}" loading="lazy" decoding="async">
        <span class="badge">✓ In bezit</span>
      </button>
      <div class="card-info">
        <div><span class="num">#${esc(c.number)}</span> ${esc(c.name)}</div>
        <div class="card-foot">
          <span class="price">${c.url ? `<a href="${esc(c.url)}" target="_blank" rel="noopener">${price(c.price)}</a>` : price(c.price)}</span>
          <button class="own-btn" data-act="toggle"></button>
        </div>
      </div>
    </article>`).join('');

  const byId = new Map(cards.map(c => [c.id, c]));
  const fmtDate = t => new Date(t).toLocaleString('nl-NL', { dateStyle: 'short', timeStyle: 'short' });
  $('#updated').textContent = `Laagste TCGplayer-prijs (USD), opgehaald ${fmtDate(data.at)}. Klik op een prijs voor de TCGplayer-pagina.`;

  function paint() {
    const sum = summarize(cards, owned);
    $('#summary').innerHTML = `
      <div class="bar big"><span style="width:${sum.percent}%"></span></div>
      <div class="sum-row"><span><b>${sum.owned}</b> / ${sum.total} kaarten (${sum.percent}%)</span>
      <span>Nog nodig: <b class="cost">${price(sum.costToComplete)}</b></span></div>
      ${sum.withoutPrice ? `<p class="muted small">${sum.withoutPrice} ontbrekende kaart(en) zonder prijs zijn niet meegeteld.</p>` : ''}
      ${sum.missing === 0 ? `<p class="done">🎉 Set compleet!</p>` : ''}`;
    const q = view.q.toLowerCase();
    for (const el of grid.children) {
      const c = byId.get(el.dataset.id), has = owned.has(c.id);
      el.classList.toggle('owned', has);
      el.querySelector('.own-btn').textContent = has ? 'Verwijderen' : 'Heb ik';
      const show = (view.filter === 'all' || (view.filter === 'owned') === has) &&
        (!view.type || categoryOf(c) === view.type) &&
        (!q || c.name.toLowerCase().includes(q) || c.number.toLowerCase() === q.replace(/^#/, ''));
      el.hidden = !show;
    }
  }
  function toggle(id) { store.toggleOwned(setId, id) ? owned.add(id) : owned.delete(id); paint(); }

  grid.onclick = e => {
    const el = e.target.closest('.card'); if (!el) return;
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'toggle') toggle(el.dataset.id);
    if (act === 'open') openCard(byId.get(el.dataset.id), owned, toggle);
  };
  $('#filters').onclick = e => {
    const f = e.target.dataset.f; if (!f) return;
    view.filter = f;
    for (const b of $('#filters').children) b.classList.toggle('on', b.dataset.f === f);
    paint();
  };
  $('#q').oninput = e => { view.q = e.target.value.trim(); paint(); };
  $('#refresh').onclick = async () => {
    $('#refresh').disabled = true;
    try { await loadCards(setId, { force: true }); renderSet(setId); toast('Prijzen bijgewerkt'); }
    catch { toast('Verversen mislukt'); $('#refresh').disabled = false; }
  };
  $('#remove').onclick = () => {
    if (confirm(`"${set.name}" uit je lijst halen? Je bezit van deze set wordt gewist.`)) {
      store.removeSet(setId); location.hash = '#/';
    }
  };
  const counts = new Map();
  for (const c of cards) counts.set(categoryOf(c), (counts.get(categoryOf(c)) || 0) + 1);
  const cats = [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a));
  $('#types').innerHTML = cats.length > 1
    ? `<button class="chip on" data-t="">Alle typen</button>` + cats.map(t =>
        `<button class="chip" data-t="${esc(t)}"><i style="background:${TYPE_COLOR[t] || '#999'}"></i>${esc(TYPE_NL[t] || t)} <small>${counts.get(t)}</small></button>`).join('')
    : '';
  $('#types').onclick = e => {
    const b = e.target.closest('.chip'); if (!b) return;
    view.type = b.dataset.t;
    for (const x of $('#types').children) x.classList.toggle('on', x.dataset.t === view.type);
    paint();
  };
  paint();
}

function openCard(c, owned, toggle) {
  const dlg = $('#dlg-card');
  const draw = () => {
    const has = owned.has(c.id);
    $('#card-detail').innerHTML = `
      <button class="close" data-close aria-label="Sluiten">✕</button>
      <img src="${esc(c.large)}" alt="${esc(c.name)}">
      <div class="detail-info">
        <h3>#${esc(c.number)} ${esc(c.name)}</h3>
        <p class="muted">${esc(c.rarity)}</p>
        <p>Laagste prijs: <b>${c.url ? `<a href="${esc(c.url)}" target="_blank" rel="noopener">${price(c.price)}</a>` : price(c.price)}</b></p>
        <button class="btn ${has ? '' : 'primary'}" id="d-toggle">${has ? '✓ In bezit — verwijderen' : 'Ik heb deze kaart'}</button>
      </div>`;
    $('#d-toggle').onclick = () => { toggle(c.id); draw(); };
  };
  draw();
  dlg.showModal();
}

/* ---------- Sets kiezen ---------- */
let allSets = null;
async function openAdd() {
  const dlg = $('#dlg-add'), list = $('#set-list');
  dlg.showModal();
  if (!allSets) {
    list.textContent = 'Sets laden…';
    try { allSets = await fetchSets(); }
    catch { list.innerHTML = '<p class="error">Kon sets niet laden. Controleer je verbinding.</p>'; return; }
  }
  drawSets();
}
function drawSets() {
  const q = $('#set-search').value.trim().toLowerCase();
  const bySeries = new Map();
  for (const s of allSets) {
    if (q && !`${s.name} ${s.series}`.toLowerCase().includes(q)) continue;
    if (!bySeries.has(s.series)) bySeries.set(s.series, []);
    bySeries.get(s.series).push(s);
  }
  $('#set-list').innerHTML = [...bySeries].map(([series, sets]) => `
    <h4>${esc(series)}</h4>${sets.map(s => `
      <div class="set-row">
        ${s.images?.symbol ? `<img src="${esc(s.images.symbol)}" alt="" loading="lazy">` : '<span></span>'}
        <span class="grow">${esc(s.name)} <span class="muted small">${s.total} kaarten · ${esc(s.releaseDate)}</span></span>
        ${store.isTracked(s.id) ? '<span class="muted">✓ Toegevoegd</span>'
          : `<button class="btn" data-add="${esc(s.id)}">Toevoegen</button>`}
      </div>`).join('')}`).join('') || '<p class="muted">Geen sets gevonden.</p>';
}
$('#set-search').oninput = () => allSets && drawSets();
$('#set-list').onclick = e => {
  const id = e.target.dataset.add; if (!id) return;
  store.addSet(allSets.find(s => s.id === id));
  drawSets();
  route();
};

/* ---------- Back-up ---------- */
$('#btn-backup').onclick = () => $('#dlg-backup').showModal();
$('#btn-export').onclick = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([store.exportData()], { type: 'application/json' }));
  a.download = `pokemon-collectie-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
};
$('#file-import').onchange = async e => {
  try { store.importData(await e.target.files[0].text()); $('#dlg-backup').close(); route(); toast('Back-up teruggezet'); }
  catch (err) { toast(err.message || 'Terugzetten mislukt'); }
  e.target.value = '';
};

/* ---------- Algemeen ---------- */
$('#btn-add').onclick = openAdd;
document.addEventListener('click', e => {
  if (e.target.closest('[data-act="add"]')) openAdd();
  if (e.target.closest('[data-act="retry"]')) route();
  if (e.target.closest('[data-close]')) $('#dlg-card').close();
  if (e.target.tagName === 'DIALOG') e.target.close(); // klik op achtergrond
});

function route() {
  const m = location.hash.match(/^#\/set\/(.+)$/);
  m ? renderSet(decodeURIComponent(m[1])) : renderHome();
}
window.addEventListener('hashchange', route);
route();
