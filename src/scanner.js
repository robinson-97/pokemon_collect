// Kaartscanner: camera -> kaartnummer en naam lezen (OCR in de browser) -> kaart zoeken -> bevestigen en toevoegen.
import { parseCardNumber, cleanName, findCandidates, parseManual } from './scan.js?v=15';
import { CONDITIONS } from './calc.js?v=15';

const $ = sel => document.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const OCR_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
const CARD_W = 63, CARD_H = 88; // verhouding van een Pokémon-kaart in mm

let ctx, stream = null, worker = null, workerPromise = null, busy = false, added = false, guide = null;

const status = (msg, kind = '') => { const el = $('#scan-status'); el.textContent = msg; el.dataset.kind = kind; };

/* ---------- camera ---------- */
async function startCamera() {
  const video = $('#scan-video');
  if (!navigator.mediaDevices?.getUserMedia) { status('Deze browser geeft geen toegang tot de camera. Typ het kaartnummer hieronder.', 'warn'); $('#scan-view').hidden = true; $('#scan-go').hidden = true; return; }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
    video.srcObject = stream;
    await video.play();
    await new Promise(r => (video.videoWidth ? r() : video.addEventListener('loadedmetadata', r, { once: true })));
    layoutGuide(video);
    $('#scan-view').hidden = false; $('#scan-go').hidden = false;
    status('Leg de kaart recht in het kader, goed belicht, en tik op Scan.');
  } catch (e) {
    $('#scan-view').hidden = true; $('#scan-go').hidden = true;
    status(e?.name === 'NotAllowedError'
      ? 'Geen toegang tot de camera. Sta de camera toe in je browser, of typ het kaartnummer hieronder.'
      : 'Camera starten mislukt. Typ het kaartnummer hieronder.', 'warn');
  }
}
function stopCamera() { stream?.getTracks().forEach(t => t.stop()); stream = null; }

// Het kader (kaartverhouding) in video-pixels; dezelfde verhoudingen worden als procenten over de video getekend.
function layoutGuide(video) {
  const vw = video.videoWidth, vh = video.videoHeight;
  const gh = Math.min(vh * 0.86, ((vw * 0.92) * CARD_H) / CARD_W), gw = (gh * CARD_W) / CARD_H;
  guide = { x: (vw - gw) / 2, y: (vh - gh) / 2, w: gw, h: gh };
  const view = $('#scan-view');
  view.style.aspectRatio = `${vw} / ${vh}`;
  view.style.width = `min(100%, ${(52 * vw) / vh}vh)`;
  Object.assign($('#scan-guide').style, { left: `${(guide.x / vw) * 100}%`, top: `${(guide.y / vh) * 100}%`, width: `${(guide.w / vw) * 100}%`, height: `${(guide.h / vh) * 100}%` });
}

// Knipt de kaart uit het beeld, op vaste breedte.
function captureCard() {
  const video = $('#scan-video'), c = document.createElement('canvas');
  c.width = 800; c.height = Math.round((800 * CARD_H) / CARD_W);
  c.getContext('2d').drawImage(video, guide.x, guide.y, guide.w, guide.h, 0, 0, c.width, c.height);
  return c;
}

// Strook van de kaart, vergroot en met meer contrast; optioneel omgekeerd (lichte tekst op donker).
function strip(card, from, to, invert) {
  const sy = Math.round(card.height * from), sh = Math.round(card.height * (to - from)), scale = 2;
  const c = document.createElement('canvas');
  c.width = card.width * scale; c.height = sh * scale;
  const g = c.getContext('2d');
  g.drawImage(card, 0, sy, card.width, sh, 0, 0, c.width, c.height);
  const img = g.getImageData(0, 0, c.width, c.height), d = img.data;
  let lo = 255, hi = 0;
  for (let i = 0; i < d.length; i += 4) { const y = 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2]; d[i] = y; if (y < lo) lo = y; if (y > hi) hi = y; }
  const span = Math.max(1, hi - lo);
  for (let i = 0; i < d.length; i += 4) {
    let y = ((d[i] - lo) / span) * 255;
    y = y < 128 ? Math.max(0, y - 40) : Math.min(255, y + 40); // contrast
    if (invert) y = 255 - y;
    d[i] = d[i + 1] = d[i + 2] = y; d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

/* ---------- OCR (tesseract.js, wordt pas bij de eerste scan geladen) ---------- */
function getWorker() {
  workerPromise ??= (async () => {
    status('Tekstherkenning laden (eenmalig, enkele MB)…');
    if (!window.Tesseract) {
      await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = OCR_URL; s.onload = res; s.onerror = () => rej(new Error('OCR laden mislukt'));
        document.head.append(s);
      });
    }
    worker = await window.Tesseract.createWorker('eng', 1, {
      logger: m => { if (m.status && m.progress != null && busy) status(`${m.status}… ${Math.round(m.progress * 100)}%`); },
    });
    return worker;
  })().catch(e => { workerPromise = null; throw e; });
  return workerPromise;
}
async function read(w, canvas, params) {
  await w.setParameters(params);
  return (await w.recognize(canvas)).data.text || '';
}

async function scan() {
  if (busy) return;
  busy = true; $('#scan-go').disabled = true; $('#scan-results').innerHTML = '';
  try {
    const card = captureCard();
    const w = await getWorker();
    status('Kaart lezen…');
    const numParams = { tessedit_char_whitelist: '0123456789/ABCDEFGHIJKLMNOPQRSTUVWXYZ ', tessedit_pageseg_mode: '11' };
    let parsed = null, numText = '';
    for (const invert of [false, true]) {
      numText = await read(w, strip(card, 0.86, 1, invert), numParams);
      parsed = parseCardNumber(numText);
      if (parsed) break;
    }
    const nameText = await read(w, strip(card, 0.02, 0.13, false), { tessedit_char_whitelist: '', tessedit_pageseg_mode: '7' });
    const name = cleanName(nameText);
    if (!parsed && !name) { status('Niets kunnen lezen. Houd de kaart rechter en dichterbij, met genoeg licht, of typ het nummer hieronder.', 'warn'); return; }
    await search(parsed, name, `Gelezen: ${parsed ? `${parsed.prefix}${parsed.num}${parsed.den ? '/' + parsed.den : ''}` : 'geen nummer'}${name ? ` · ${name}` : ''}`);
  } catch (e) {
    status(`Scannen mislukt (${e.message}). Typ het kaartnummer hieronder.`, 'warn');
  } finally { busy = false; $('#scan-go').disabled = false; }
}

/* ---------- zoeken en tonen ---------- */
async function search(parsed, name, readLine) {
  status(`${readLine} · zoeken…`);
  const tracked = ctx.trackedSets();
  const found = await findCandidates({
    parsed, name, trackedSets: tracked,
    otherSets: parsed?.den ? (await ctx.otherSets()) : [],
    getCards: s => ctx.getCards(s),
    searchByName: ctx.searchByName,
  });
  if (!found.length) { status(`${readLine}. Geen kaart gevonden. Probeer opnieuw of typ het nummer (bijv. 25/165).`, 'warn'); return; }
  status(`${readLine}. Klopt dit? Kies de staat en voeg toe.`);
  renderResults(found);
}

function renderResults(found) {
  const box = $('#scan-results');
  box.innerHTML = found.slice(0, 3).map((f, i) => {
    const cur = ctx.ownedMap(f.set.id).get(f.card.id);
    return `<div class="scan-hit" data-i="${i}">
      <img src="${esc(f.card.small || f.card.large)}" alt="${esc(f.card.name)}">
      <div class="scan-hit-info">
        <b>${esc(f.card.number)} ${esc(f.card.name)}</b>
        <span class="muted small">${esc(f.set.name)}${f.tracked ? '' : ' · nieuwe set, wordt automatisch aan je sets toegevoegd'}</span>
        <span class="small">${esc(ctx.priceText(f.card, f.tracked))}</span>
        ${cur ? `<span class="small ok">Al in bezit (${esc(cur)})</span>` : ''}
        <div class="conds" role="group" aria-label="Staat">${CONDITIONS.map(k => `<button data-c="${k.code}" class="${(cur || 'NM') === k.code ? 'on' : ''}" title="${esc(k.nl)}">${k.code}</button>`).join('')}</div>
        <button class="btn primary" data-add>${cur ? 'Staat bijwerken' : 'Toevoegen aan collectie'}</button>
      </div></div>`;
  }).join('');
  box.onclick = e => {
    const hit = e.target.closest('.scan-hit'); if (!hit) return;
    const f = found[Number(hit.dataset.i)];
    const cond = e.target.closest('[data-c]');
    if (cond) { for (const b of hit.querySelectorAll('[data-c]')) b.classList.toggle('on', b === cond); return; }
    if (!e.target.closest('[data-add]')) return;
    const chosen = hit.querySelector('[data-c].on')?.dataset.c || 'NM';
    if (!f.tracked) ctx.addSet(f.set);
    ctx.setOwned(f.set.id, f.card.id, chosen);
    added = true;
    box.innerHTML = '';
    status(`✓ ${f.card.name} (${f.set.name}, ${chosen}) toegevoegd. Scan de volgende kaart.`, 'ok');
  };
}

/* ---------- open / sluiten ---------- */
export async function openScanner(context) {
  ctx = context; added = false;
  const dlg = $('#dlg-scan');
  $('#scan-results').innerHTML = ''; $('#scan-input').value = '';
  dlg.showModal();
  await startCamera();
}

export function initScanner() {
  const dlg = $('#dlg-scan');
  $('#scan-go').onclick = scan;
  $('#scan-close').onclick = () => dlg.close();
  dlg.addEventListener('close', () => { stopCamera(); if (added) ctx.onDone(); });
  $('#scan-form').onsubmit = async e => {
    e.preventDefault();
    const text = $('#scan-input').value.trim(); if (!text || busy) return;
    busy = true; $('#scan-results').innerHTML = '';
    try { const { parsed, name } = parseManual(text); await search(parsed, name, `Gezocht: ${text}`); }
    catch (err) { status(`Zoeken mislukt (${err.message})`, 'warn'); }
    finally { busy = false; }
  };
}
