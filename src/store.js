// Opslag in localStorage: gekozen sets, bezit en een cache van kaartdata.
const KEY = 'pokemon-collect/v1';
const CACHE_PREFIX = 'pokemon-collect/cards/';
const CACHE_TTL = 24 * 3600 * 1000; // prijzen na 24 uur verversen

const state = load();

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && Array.isArray(s.sets) && s.owned) return s;
  } catch {}
  return { sets: [], owned: {} };
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
}

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
  try { localStorage.removeItem(CACHE_PREFIX + id); } catch {}
  save();
}

export const ownedIds = setId => new Set(state.owned[setId] || []);
export function toggleOwned(setId, cardId) {
  const set = ownedIds(setId);
  set.has(cardId) ? set.delete(cardId) : set.add(cardId);
  state.owned[setId] = [...set];
  save();
  return set.has(cardId);
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

export const exportData = () => JSON.stringify(state, null, 2);
export function importData(text) {
  const s = JSON.parse(text);
  if (!s || !Array.isArray(s.sets) || typeof s.owned !== 'object') throw new Error('Ongeldig back-upbestand');
  state.sets = s.sets;
  state.owned = s.owned;
  save();
}
