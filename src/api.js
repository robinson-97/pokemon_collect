// Dunne laag rond de pokemontcg.io v2 API (gratis, levert o.a. TCGplayer-prijzen).
const BASE = 'https://api.pokemontcg.io/v2';
const CARD_FIELDS = 'id,name,number,rarity,images,tcgplayer';

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
export function lowestPrice(prices) {
  if (!prices) return null;
  let best = null;
  for (const v of Object.values(prices)) {
    const p = v.low ?? v.market;
    if (typeof p === 'number' && p > 0 && (best === null || p < best)) best = p;
  }
  return best;
}

function slimCard(c) {
  return {
    id: c.id,
    name: c.name,
    number: c.number,
    rarity: c.rarity || '',
    small: c.images?.small,
    large: c.images?.large,
    price: lowestPrice(c.tcgplayer?.prices),
    url: c.tcgplayer?.url || null,
    priceDate: c.tcgplayer?.updatedAt || null,
  };
}

export function byNumber(a, b) {
  return a.number.localeCompare(b.number, 'en', { numeric: true });
}
