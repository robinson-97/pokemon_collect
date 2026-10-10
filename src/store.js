// Opslag in localStorage: gekozen sets, bezit en een cache van kaartdata.
const KEY = 'pokemon-collect/v1';
const PRICE_PREFIX = 'pokemon-collect/prices-v1/';
const CACHE_PREFIX = 'pokemon-collect/cards-v3/';
const CACHE_TTL = 24 * 3600 * 1000; // prijzen na 24 uur verversen

export const DEFAULT_CONDITION = 'NM';
// source: 'cm' (Cardmarket, EUR) of 'tcg' (TCGplayer, USD); want: staat waarvoor ontbrekende kaarten geprijsd worden.
const DEFAULT_PREFS = { source: 'cm', want: 'NM' };

// Bezit is {setId: {kaartId: staat}}. Oudere versies bewaarden alleen een lijst kaart-id's.
function normalizeOwned(owned) {
  const out = {};
  for (const [setId, v] of Object.entries(owned || {})) {
    out[setId] = Array.isArray(v) ? Object.fromEntries(v.map(id => [id, DEFAULT_CONDITION])) : { ...v };
  }
  return out;
}

const state = load();

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && Array.isArray(s.sets) && s.owned) return { sets: s.sets, owned: normalizeOwned(s.owned), prefs: { ...DEFAULT_PREFS, ...s.prefs } };
  } catch {}
  return { sets: [], owned: {}, prefs: { ...DEFAULT_PREFS } };
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
}

export const prefs = () => state.prefs;
export function setPref(key, value) { state.prefs[key] = value; save(); }

export const trackedSets = () => state.sets;
export const isTracked = id => state.sets.some(s => s.id === id);

export function addSet(set) {
  if (isTracked(set.id)) return;
  const { id, name, series, printedTotal, total, releaseDate, images } = set;
  state.sets.push({ id, name, series, printedTotal, total, releaseDate, images });
  save();
}
export function removeSet(id) {
  state.sets = state.sets.filter(s => s.id !== id);
  delete state.owned[id];
  try { localStorage.removeItem(CACHE_PREFIX + id); localStorage.removeItem(PRICE_PREFIX + id); } catch {}
  save();
}

// Map kaart-id -> staat voor één set (leest alleen; schrijven gaat via setOwned).
export const ownedMap = setId => new Map(Object.entries(state.owned[setId] || {}));
// condition = null verwijdert de kaart uit je bezit.
export function setOwned(setId, cardId, condition) {
  const cur = { ...(state.owned[setId] || {}) };
  if (condition) cur[cardId] = condition; else delete cur[cardId];
  state.owned[setId] = cur;
  save();
}

export function getCachedCards(setId) {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_PREFIX + setId));
    if (c && Array.isArray(c.cards)) return { cards: c.cards, fresh: Date.now() - c.at < CACHE_TTL, at: c.at };
  } catch {}
  return null;
}
export function setCachedCards(setId, cards) {
  try { localStorage.setItem(CACHE_PREFIX + setId, JSON.stringify({ at: Date.now(), cards })); } catch {}
}

export function getCachedPrices(setId) {
  try {
    const c = JSON.parse(localStorage.getItem(PRICE_PREFIX + setId));
    if (c && c.map) return { map: c.map, fresh: Date.now() - c.at < CACHE_TTL, at: c.at };
  } catch {}
  return null;
}
export function setCachedPrices(setId, map) {
  try { localStorage.setItem(PRICE_PREFIX + setId, JSON.stringify({ at: Date.now(), map })); } catch {}
}
export function clearCachedPrices(setId) {
  try { localStorage.removeItem(PRICE_PREFIX + setId); } catch {}
}

export const exportData = () => JSON.stringify(state, null, 2);
export function importData(text) {
  const s = JSON.parse(text);
  if (!s || !Array.isArray(s.sets) || typeof s.owned !== 'object') throw new Error('Ongeldig back-upbestand');
  state.sets = s.sets;
  state.owned = normalizeOwned(s.owned);
  save();
}
