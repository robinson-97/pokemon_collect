import { fetchSets, fetchSetCards, diagnose } from './api.js?v=14';
import { fetchSetPrices, diagnosePrices } from './prices.js?v=14';
import { openScanner, initScanner } from './scanner.js?v=14';
import * as store from './store.js?v=14';
import { summarize, categoryOf, TYPE_NL, TYPE_COLOR, CONDITIONS, SOURCES, priceFor, withPrices, effectiveSource } from './calc.js?v=14';

const $ = sel => document.querySelector(sel);
const app = $('#app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const prefs = () => store.prefs();
const price = (p, source = prefs().source) => (p == null ? '—' : SOURCES[source].fmt.format(p));
let shownSource = null; // bron die op de huidige pagina echt getoond wordt
let repaint = null; // hertekent prijzen op de huidige setpagina

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (t.hidden = true), 3500);
}

/* ---------- Kaarten laden (cache + verversen) ---------- */
// Prijzen komen apart binnen (TCGdex) en worden over de kaarten heen gelegd.
// Zoekt de kaart op Cardmarket, met het filter op Engelse aanbiedingen (language=1).
const cmEnglishUrl = c => `https://www.cardmarket.com/en/Pokemon/Products/Search?searchString=${encodeURIComponent(`${c.name} ${c.number}`)}&language=1`;
function applyPrices(cards, map = {}) {
  for (const c of cards) {
    const p = map[c.id];
    c.tcg = { low: null, market: null, ...c.tcg, ...p?.tcg };
    c.cm = p?.cm ? { ...p.cm, url: cmEnglishUrl(c) } : null;
  }
}
async function loadCards(setId, { force = false } = {}) {
  const cached = store.getCachedCards(setId);
  let res;
  if (cached && cached.fresh && !force) res = { cards: cached.cards, at: cached.at };
  else {
    try {
      const cards = await fetchSetCards(setId);
      store.setCachedCards(setId, cards);
      res = { cards, at: Date.now() };
    } catch (e) {
      if (!cached) throw e;
      toast('Kon kaarten niet verversen, oude data getoond');
      res = { cards: cached.cards, at: cached.at };
    }
  }
  const prices = store.getCachedPrices(setId);
  applyPrices(res.cards, prices?.map);
  res.pricesAt = prices?.at ?? null;
  return res;
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
      const src = effectiveSource(cards, prefs().source, prefs().want);
      const sum = summarize(withPrices(cards, src, prefs().want), store.ownedMap(s.id));
      tile.querySelector('.bar span').style.width = sum.percent + '%';
      tile.querySelector('.stats').innerHTML =
        `<b>${sum.owned}/${sum.total}</b> · ${sum.percent}%<br>` + (store.getCachedPrices(s.id)
          ? `Nog nodig: <b>${price(sum.costToComplete, src)}</b>` : `<span class="small">Open de set om prijzen te laden</span>`);
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
  let pricesAt = data.pricesAt, loadingPrices = false;
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
    </div>
    <details class="opts">
      <summary>Opties</summary>
      <div class="opts-body">
        <label class="want" title="Cardmarket kent geen prijs per staat. Dit bepaalt waarvoor ontbrekende kaarten geprijsd worden.">Ontbrekende kaarten prijzen als
          <select id="want"><option value="NM">Excellent of beter</option><option value="any">Elke staat (goedkoopst)</option></select></label>
        <button class="btn" id="refresh">↻ Prijzen verversen</button>
        <button class="btn danger" id="remove">Set verwijderen</button>
      </div>
    </details>
    <div class="types" id="types"></div>
    <p class="muted small" id="pricestatus" hidden></p>
    <div class="notice" id="priceinfo" hidden></div>
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
    const { source: pref, want } = prefs();
    const source = shownSource = effectiveSource(cards, pref, want);
    const switched = source !== pref;
    $('#want').value = want;
    $('.want').hidden = source !== 'cm' || !cards.some(c => c.cm?.lowEx != null);
    const sum = summarize(withPrices(cards, source, want), owned);
    const priced = cards.filter(c => priceFor(c, source, null, want) != null).length;
    const hasTcg = cards.filter(c => c.tcg && (c.tcg.url || c.tcg.low != null)).length;
    const hasCm = cards.filter(c => c.cm).length;
    const info = $('#priceinfo');
    info.hidden = (priced > 0 && !switched) || loadingPrices;
    info.innerHTML = `<span></span> <button class="btn" id="diag">Diagnose</button><pre id="diag-out" hidden></pre>`;
    if (switched) {
      info.firstChild.textContent = `Voor deze set zijn geen ${SOURCES[pref].name}-prijzen beschikbaar. Je ziet ${SOURCES[source].name}-prijzen${source === 'cm' ? ' (alle talen)' : ''}.`;
      $('#diag').remove(); $('#diag-out').remove();
    } else info.firstChild.textContent = `Geen ${SOURCES[source].name}-prijzen gevonden voor deze set (TCGplayer: ${hasTcg}/${cards.length}, Cardmarket: ${hasCm}/${cards.length}).` +
      ((source === 'cm' ? hasTcg : hasCm) ? ` Probeer de andere prijsbron bovenaan.` : ` Kies Opties → Prijzen verversen, of tik op Diagnose.`);
    const diagBtn = $('#diag');
    if (diagBtn) diagBtn.onclick = async () => {
      const out = $('#diag-out'); out.hidden = false; out.textContent = 'Bezig…';
      out.textContent = (await diagnose(setId)) + '\n\n' + (await diagnosePrices(set));
    };
    $('#updated').textContent = `Prijzen: ${SOURCES[source].name}${source === 'cm' ? ' (alle talen)' : ' (Engelse kaarten)'} via TCGdex, bij ${priced} van ${cards.length} kaarten bekend${pricesAt ? ` (${fmtDate(pricesAt)})` : ''}. ${hint}`;
    $('#summary').innerHTML = `
      <div class="bar big"><span style="width:${sum.percent}%"></span></div>
      <div class="sum-row"><span><b>${sum.owned}</b> / ${sum.total} kaarten (${sum.percent}%)</span>
      <span>Nog nodig: <b class="cost">${price(sum.costToComplete, source)}</b></span></div>
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
  $('#refresh').onclick = () => { store.clearCachedPrices(setId); renderSet(setId); };
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

  // Prijzen ophalen als ze ontbreken of ouder zijn dan 24 uur; kaarten blijven intussen zichtbaar.
  const cachedPrices = store.getCachedPrices(setId);
  if (!cachedPrices || !cachedPrices.fresh) {
    loadingPrices = true; paint();
    const status = $('#pricestatus');
    status.hidden = false; status.textContent = 'Prijzen ophalen…';
    try {
      const { map } = await fetchSetPrices(set, cards, (d, t) => { if (status.isConnected) status.textContent = `Prijzen ophalen… ${d}/${t}`; });
      if (Object.keys(map).length) { store.setCachedPrices(setId, map); pricesAt = Date.now(); }
      applyPrices(cards, Object.keys(map).length ? map : cachedPrices?.map);
    } catch {
      if (status.isConnected) toast('Prijzen ophalen mislukt');
    }
    loadingPrices = false;
    if (status.isConnected) { status.hidden = true; paint(); }
  }
}

function priceBlock(c, cond) {
  const { want } = prefs();
  const source = shownSource ?? prefs().source;
  const mine = priceFor(c, source, cond, want);
  const row = (label, val, fmt, strong) => val == null ? '' : `<tr${strong ? ' class="hl"' : ''}><td>${label}</td><td>${fmt.format(val)}</td></tr>`;
  const cm = c.cm, tcg = c.tcg, E = SOURCES.cm.fmt, U = SOURCES.tcg.fmt;
  return `
    <p class="bigprice">${price(mine, source)} <small>laagste prijs${source === 'cm' ? (cond && cm?.lowEx != null ? ` voor jouw staat (${cond})` : '') : ''} · ${SOURCES[source].name}</small></p>
    <table class="prices">
      <tr><th colspan="2">Cardmarket${cm?.url ? ` · <a href="${esc(cm.url)}" target="_blank" rel="noopener">openen</a>` : ''}</th></tr>
      ${cm ? row('Laagste, elke staat', cm.low, E, source === 'cm' && mine === cm.low) + row('Laagste, Excellent of beter', cm.lowEx, E, source === 'cm' && mine === cm.lowEx && cm.lowEx !== cm.low) + row('Trend', cm.trend, E) + row('Gemiddelde 7 dagen', cm.avg7, E) : '<tr><td colspan="2" class="muted">Geen prijs bekend</td></tr>'}
      <tr><th colspan="2">TCGplayer${tcg.url ? ` · <a href="${esc(tcg.url)}" target="_blank" rel="noopener">openen</a>` : ''}</th></tr>
      ${tcg.low != null || tcg.market != null ? row('Laagste', tcg.low, U, source === 'tcg') + row('Marktprijs', tcg.market, U) : '<tr><td colspan="2" class="muted">Geen prijs bekend</td></tr>'}
    </table>
    <p class="muted small">Een prijs per staat (LP, MP, HP) is niet beschikbaar. Je ziet de laagste prijs van alle aanbiedingen. ${source === 'cm' ? 'Cardmarket telt aanbiedingen in alle talen mee, dus dit kan lager zijn dan een Engelse kaart kost. Voor Engelse kaarten kies je TCGplayer.' : 'TCGplayer is de Amerikaanse markt, met Engelse kaarten.'}</p>`;
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
        <a class="btn linkout" href="${esc(cmEnglishUrl(c))}" target="_blank" rel="noopener">Engelse aanbiedingen op Cardmarket ↗</a>
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
let yearFilter = '';
const yearOf = s => String(s.releaseDate || '').slice(0, 4);
function drawSets() {
  const q = $('#set-search').value.trim().toLowerCase();

  // Jaarknoppen: alle jaren waarin sets zijn uitgekomen, nieuwste eerst.
  const perYear = new Map();
  for (const s of allSets) perYear.set(yearOf(s), (perYear.get(yearOf(s)) || 0) + 1);
  const years = [...perYear.keys()].filter(Boolean).sort().reverse();
  $('#year-chips').innerHTML = `<button class="chip ${yearFilter ? '' : 'on'}" data-y="">Alle jaren</button>` +
    years.map(y => `<button class="chip ${yearFilter === y ? 'on' : ''}" data-y="${y}">${y} <small>${perYear.get(y)}</small></button>`).join('');

  const byYear = new Map();
  for (const s of allSets) {
    if (yearFilter && yearOf(s) !== yearFilter) continue;
    if (q && !`${s.name} ${s.series}`.toLowerCase().includes(q)) continue;
    const y = yearOf(s) || 'Onbekend';
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y).push(s);
  }
  const date = d => (d ? new Date(d.replace(/\//g, '-')).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
  $('#set-list').innerHTML = [...byYear].map(([y, sets]) => `
    <h4>${esc(y)} <span class="small">· ${sets.length} ${sets.length === 1 ? 'set' : 'sets'}</span></h4>
    <div class="pick-grid">${sets.map(s => `
      <div class="pick">
        <div class="pick-img">${s.images?.logo ? `<img src="${esc(s.images.logo)}" alt="Logo ${esc(s.name)}" loading="lazy">` : `<span class="muted">${esc(s.name)}</span>`}</div>
        <div class="pick-name">${s.images?.symbol ? `<img class="sym" src="${esc(s.images.symbol)}" alt="" loading="lazy">` : ''}<b>${esc(s.name)}</b></div>
        <div class="muted small">${esc(s.series)} · ${s.total} kaarten<br>${esc(date(s.releaseDate))}</div>
        ${store.isTracked(s.id) ? '<div class="pick-done">✓ Toegevoegd</div>'
          : `<button class="btn" data-add="${esc(s.id)}">Toevoegen</button>`}
      </div>`).join('')}</div>`).join('') || '<p class="muted">Geen sets gevonden.</p>';
}
$('#year-chips').onclick = e => {
  const b = e.target.closest('[data-y]'); if (!b) return;
  yearFilter = b.dataset.y;
  drawSets();
  $('#set-list').scrollTop = 0;
};
$('#set-search').oninput = () => allSets && drawSets();
$('#set-list').onclick = e => {
  const id = e.target.closest('[data-add]')?.dataset.add; if (!id) return;
  store.addSet(allSets.find(s => s.id === id));
  const top = $('#set-list').scrollTop;
  drawSets();
  $('#set-list').scrollTop = top;
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

/* ---------- Kaartscanner ---------- */
initScanner();
$('#btn-scan').onclick = () => openScanner({
  trackedSets: () => store.trackedSets(),
  otherSets: async () => {
    allSets ??= await fetchSets();
    return allSets.filter(s => !store.isTracked(s.id));
  },
  // Eigen sets komen uit de cache; andere sets worden alleen opgehaald om te zoeken.
  getCards: async set => (store.isTracked(set.id) ? (await loadCards(set.id)).cards : fetchSetCards(set.id)),
  ownedMap: setId => store.ownedMap(setId),
  addSet: set => store.addSet(set),
  setOwned: (setId, cardId, cond) => store.setOwned(setId, cardId, cond),
  priceText: (card, tracked) => {
    const p = tracked ? priceFor(card, shownSource ?? prefs().source, null, prefs().want) : null;
    return p == null ? '' : `Laagste prijs: ${price(p, shownSource ?? prefs().source)}`;
  },
  onDone: () => { toast('Collectie bijgewerkt'); route(); },
});
