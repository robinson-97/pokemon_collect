// Dunne laag rond de pokemontcg.io v2 API (gratis, levert o.a. TCGplayer-prijzen).
const BASE = 'https://api.pokemontcg.io/v2';
const CARD_FIELDS = 'id,name,number,rarity,supertype,types,images,tcgplayer,cardmarket';

async function get(path, params) {
  const url = `${BASE}${path}?${new URLSearchParams(params)}`;
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok) return res.json();
      lastErr = new Error(`API-fout ${res.status}`);
      if (res.status < 500) break;
    } catch (e) {
      lastErr = e;
    }
    await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
  }
  throw lastErr;
}

export async function fetchSets() {
  const { data } = await get('/sets', {
    select: 'id,name,series,printedTotal,total,releaseDate,images',
    orderBy: '-releaseDate',
    pageSize: 500,
  });
  return data;
}

export async function fetchSetCards(setId) {
  const cards = [];
  for (let page = 1; ; page++) {
    const res = await get('/cards', {
      q: `set.id:${setId}`,
      select: CARD_FIELDS,
      pageSize: 250,
      page,
    });
    cards.push(...res.data);
    if (cards.length >= res.totalCount || res.data.length === 0) break;
  }
  return cards.map(slimCard).sort(byNumber);
}

// Laagste prijs: goedkoopste TCGplayer-variant (normal/holo/reverse…), op basis van 'low',
// met 'market' als terugval. Geeft null als er geen prijs is.
export function lowestPrice(prices, field = 'low') {
  if (!prices) return null;
  let best = null;
  for (const v of Object.values(prices)) {
    const p = field === 'low' ? v.low ?? v.market ?? v.mid : v[field];
    if (typeof p === 'number' && p > 0 && (best === null || p < best)) best = p;
  }
  return best;
}

const pos = n => (typeof n === 'number' && n > 0 ? n : null);

// Prijzen per bron. TCGplayer (USD): goedkoopste variant. Cardmarket (EUR): laagste
// prijs in elke staat ('low') en laagste prijs voor Excellent of beter ('lowEx').
export function slimCard(c) {
  const cp = c.cardmarket?.prices;
  return {
    id: c.id,
    name: c.name,
    number: c.number,
    rarity: c.rarity || '',
    supertype: c.supertype || '',
    types: c.types || [],
    small: c.images?.small,
    large: c.images?.large,
    tcg: {
      low: lowestPrice(c.tcgplayer?.prices),
      market: lowestPrice(c.tcgplayer?.prices, 'market'),
      url: c.tcgplayer?.url || null,
      at: c.tcgplayer?.updatedAt || null,
    },
    cm: cp ? {
      low: pos(cp.lowPrice), lowEx: pos(cp.lowPriceExPlus), trend: pos(cp.trendPrice), avg7: pos(cp.avg7),
      url: c.cardmarket.url || null, at: c.cardmarket.updatedAt || null,
    } : null,
  };
}

export function byNumber(a, b) {
  return a.number.localeCompare(b.number, 'en', { numeric: true });
}

// Haalt één kaart ongefilterd op, om te zien wat de database echt teruggeeft (voor de Diagnose-knop).
export async function diagnose(setId) {
  const url = `${BASE}/cards?${new URLSearchParams({ q: `set.id:${setId}`, pageSize: 1, select: 'id,name,tcgplayer,cardmarket' })}`;
  const t0 = Date.now();
  try {
    const res = await fetch(url);
    const text = await res.text();
    return `HTTP ${res.status} in ${Date.now() - t0} ms\n${text.slice(0, 1500)}`;
  } catch (e) {
    return `Geen verbinding: ${e.message} (na ${Date.now() - t0} ms)`;
  }
}

// Zoekt kaarten op naam in álle sets (voor de scanner). Geeft {card, set} met de set-gegevens erbij.
export async function searchCardsByName(name) {
  const clean = String(name).replace(/["\\]/g, '').trim();
  if (clean.length < 3) return [];
  const res = await get('/cards', {
    q: `name:"${clean}"`,
    select: 'id,name,number,rarity,supertype,types,images,set',
    orderBy: '-set.releaseDate',
    pageSize: 40,
  });
  return res.data.map(c => ({ card: slimCard(c), set: c.set }));
}
