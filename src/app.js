import { fetchSets, fetchSetCards } from './api.js?v=6';
import * as store from './store.js?v=6';
import { summarize, categoryOf, TYPE_NL, TYPE_COLOR, CONDITIONS, SOURCES, priceFor, withPrices } from './calc.js?v=6';

const $ = sel => document.querySelector(sel);
const app = $('#app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const prefs = () => store.prefs();
const price = (p, source = prefs().source) => (p == null ? '—' : SOURCES[source].fmt.format(p));
let repaint = null; // hertekent prijzen op de huidige setpagina

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
  repaint = null;
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
      const sum = summarize(withPrices(cards, prefs().source, prefs().want), store.ownedMap(s.id));
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
  repaint = null;
  const set = store.trackedSets().find(s => s.id === setId);
  if (!set) { location.hash = '#/'; return; }
  view = { filter: 'all', q: '', type: '' };
  app.innerHTML = `<p class="muted">Kaarten laden…</p>`;
  let data;
  try { data = await loadCards(setId); }
  catch { app.innerHTML = `<p class="error">Kon de kaarten niet laden. <button class="btn" data-act="retry">Opnieuw</button></p>`; return; }
  const { cards } = data;
  const owned = store.ownedMap(setId);

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
      <label class="want" title="Cardmarket kent geen prijs per staat. Dit bepaalt waarvoor ontbrekende kaarten geprijsd worden.">Ontbrekende kaarten:
        <select id="want"><option value="NM">Excellent of beter</option><option value="any">Elke staat (goedkoopst)</option></select></label>
      <button class="btn ghost" id="refresh" title="Prijzen opnieuw ophalen">↻ Prijzen</button>
      <button class="btn ghost danger" id="remove">Set verwijderen</button>
    </div>
    <div class="types" id="types"></div>
    <p class="muted small" id="updated"></p>
    <div class="card-grid" id="grid"></div>`;

  const grid = $('#grid');
  grid.innerHTML = cards.map(c => `
    <article class="card" data-id="${esc(c.id)}">
      <button class="card-img" aria-label="${esc(c.name)}, tik om te vergroten, houd ingedrukt om als in bezit te markeren">
        <img src="${esc(c.large)}" width="734" height="1024" draggable="false"
             alt="${esc(c.name)}" loading="lazy" decoding="async">
        <span class="badge"></span>
      </button>
      <div class="card-info">
        <span class="name"><span class="num">${esc(c.number)}</span> ${esc(c.name)}</span>
        <span class="price"></span>
      </div>
    </article>`).join('');

  const byId = new Map(cards.map(c => [c.id, c]));
  const fmtDate = t => new Date(t).toLocaleString('nl-NL', { dateStyle: 'short', timeStyle: 'short' });
  const hint = 'Tik op een kaart om te vergroten. Houd een kaart ingedrukt om hem als in bezit te markeren.';

  function paint() {
    const { source, want } = prefs();
    $('#want').value = want;
    $('#want').hidden = source !== 'cm';
    const sum = summarize(withPrices(cards, source, want), owned);
    $('#updated').textContent = `Laagste ${SOURCES[source].name}-prijzen, opgehaald ${fmtDate(data.at)}. ${hint}`;
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
      el.querySelector('.badge').textContent = has ? `✓ ${owned.get(c.id)}` : '';
      el.dataset.cond = has ? owned.get(c.id) : '';
      const p = priceFor(c, source, has ? owned.get(c.id) : null, want);
      el.querySelector('.price').innerHTML = p == null ? '<span class="none">geen prijs</span>' : `<small>vanaf</small> ${price(p, source)}`;
      const show = (view.filter === 'all' || (view.filter === 'owned') === has) &&
        (!view.type || categoryOf(c) === view.type) &&
        (!q || c.name.toLowerCase().includes(q) || c.number.toLowerCase() === q.replace(/^#/, ''));
      el.hidden = !show;
    }
  }
  function setCond(id, cond) {
    store.setOwned(setId, id, cond);
    cond ? owned.set(id, cond) : owned.delete(id);
    paint();
  }
  const toggle = id => setCond(id, owned.has(id) ? null : store.DEFAULT_CONDITION);
  const detail = id => openCard(byId.get(id), owned, setCond);

  // Tik = vergroten, lang indrukken (of rechtsklik) = in bezit aan/uit.
  let press = null, longFired = false;
  const cancelPress = () => { clearTimeout(press); press = null; };
  grid.addEventListener('pointerdown', e => {
    const el = e.target.closest('.card'); if (!el || e.button > 0) return;
    longFired = false;
    const x = e.clientX, y = e.clientY;
    el._start = { x, y };
    press = setTimeout(() => {
      longFired = true;
      toggle(el.dataset.id);
      el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
      navigator.vibrate?.(25);
    }, 450);
  });
  grid.addEventListener('pointermove', e => {
    const el = e.target.closest('.card');
    if (press && el?._start && Math.hypot(e.clientX - el._start.x, e.clientY - el._start.y) > 10) cancelPress();
  });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) grid.addEventListener(ev, cancelPress);
  grid.addEventListener('contextmenu', e => {
    const el = e.target.closest('.card'); if (!el) return;
    e.preventDefault();
    if (!longFired && e.pointerType !== 'touch') toggle(el.dataset.id); // rechtsklik met de muis
  });
  grid.onclick = e => {
    const el = e.target.closest('.card'); if (!el) return;
    if (longFired) { longFired = false; return; }
    detail(el.dataset.id);
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
  $('#want').onchange = e => { store.setPref('want', e.target.value); paint(); };
  repaint = paint;
  paint();
}

function priceBlock(c, cond) {
  const { source, want } = prefs();
  const mine = priceFor(c, source, cond, want);
  const row = (label, val, fmt, strong) => val == null ? '' : `<tr${strong ? ' class="hl"' : ''}><td>${label}</td><td>${fmt.format(val)}</td></tr>`;
  const cm = c.cm, tcg = c.tcg, E = SOURCES.cm.fmt, U = SOURCES.tcg.fmt;
  return `
    <p class="bigprice">${price(mine, source)} <small>laagste prijs${source === 'cm' ? (cond ? ` voor jouw staat (${cond})` : '') : ' (Near Mint)'} · ${SOURCES[source].name}</small></p>
    <table class="prices">
      <tr><th colspan="2">Cardmarket${cm?.url ? ` · <a href="${esc(cm.url)}" target="_blank" rel="noopener">openen</a>` : ''}</th></tr>
      ${cm ? row('Laagste, elke staat', cm.low, E, source === 'cm' && mine === cm.low) + row('Laagste, Excellent of beter', cm.lowEx, E, source === 'cm' && mine === cm.lowEx && cm.lowEx !== cm.low) + row('Trend', cm.trend, E) + row('Gemiddelde 7 dagen', cm.avg7, E) : '<tr><td colspan="2" class="muted">Geen prijs bekend</td></tr>'}
      <tr><th colspan="2">TCGplayer${tcg.url ? ` · <a href="${esc(tcg.url)}" target="_blank" rel="noopener">openen</a>` : ''}</th></tr>
      ${tcg.low != null || tcg.market != null ? row('Laagste', tcg.low, U, source === 'tcg') + row('Marktprijs', tcg.market, U) : '<tr><td colspan="2" class="muted">Geen prijs bekend</td></tr>'}
    </table>
    <p class="muted small">Prijzen per staat (LP, MP, HP) bestaan niet. Voor jouw staat toon ik de dichtstbijzijnde bekende prijs.</p>`;
}

function openCard(c, owned, setCond) {
  const dlg = $('#dlg-card');
  const link = txt => (c.url ? `<a href="${esc(c.url)}" target="_blank" rel="noopener">${txt}</a>` : txt);
  const draw = () => {
    const cond = owned.get(c.id);
    $('#card-detail').innerHTML = `
      <button class="close" data-close aria-label="Sluiten">✕</button>
      <img src="${esc(c.large)}" alt="${esc(c.name)}">
      <div class="detail-info">
        <h3><span class="num">${esc(c.number)}</span> ${esc(c.name)}</h3>
        <p class="muted">${esc(c.rarity)}</p>
        ${priceBlock(c, cond)}
        <p class="label">Mijn exemplaar</p>
        <div class="conds" role="group" aria-label="Staat van de kaart">
          <button data-c="" class="${cond ? '' : 'on'}">Niet in bezit</button>
          ${CONDITIONS.map(k => `<button data-c="${k.code}" class="${cond === k.code ? 'on' : ''}" title="${esc(k.nl)}: ${esc(k.hint)}">${k.code}</button>`).join('')}
        </div>
        <p class="muted small">${cond ? esc(CONDITIONS.find(k => k.code === cond).nl + ' · ' + CONDITIONS.find(k => k.code === cond).hint) : 'Kies de staat van je kaart om hem als in bezit te markeren.'}</p>
      </div>`;
    $('#card-detail .conds').onclick = e => {
      const b = e.target.closest('button'); if (!b) return;
      setCond(c.id, b.dataset.c || null); draw();
    };
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

/* ---------- Prijsbron kiezen ---------- */
function drawSource() {
  const cur = prefs().source;
  for (const b of $('#src').children) b.classList.toggle('on', b.dataset.s === cur);
}
$('#src').onclick = e => {
  const sSel = e.target.closest('button')?.dataset.s; if (!sSel) return;
  store.setPref('source', sSel);
  drawSource();
  repaint ? repaint() : route();
};
drawSource();
