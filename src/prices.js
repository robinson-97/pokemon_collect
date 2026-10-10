// Prijzen komen van TCGdex (gratis, geen sleutel nodig), want pokemontcg.io levert alleen nog een link.
// Kaarten en afbeeldingen blijven van pokemontcg.io. Sets en kaarten worden aan elkaar gekoppeld
// op set-naam/id en kaartnummer.
const BASE = 'https://api.tcgdex.net/v2/en';

async function get(path) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(BASE + path);
      if (res.status === 404) return null;
      if (res.ok) return res.json();
      lastErr = new Error(`TCGdex-fout ${res.status}`);
    } catch (e) {
      lastErr = e;
    }
    await new Promise(r => setTimeout(r, 600 * (attempt + 1)));
  }
  throw lastErr;
}

const pos = n => (typeof n === 'number' && n > 0 ? n : null);
const minPos = (...xs) => xs.map(pos).filter(x => x !== null).reduce((a, b) => (a === null || b < a ? b : a), null);

// TCGdex-prijzen -> {tcg, cm} in de vorm die de app gebruikt.
// Cardmarket (EUR): laagste aanbod, trend, 7-daags gemiddelde; ook voor holo-varianten.
// TCGplayer (USD): per variant lowPrice/marketPrice, we nemen de goedkoopste variant.
export function parsePricing(pricing) {
  const cmRaw = pricing?.cardmarket, tpRaw = pricing?.tcgplayer;
  const cm = cmRaw ? {
    low: minPos(cmRaw.low, cmRaw['low-holo']),
    lowEx: null,
    trend: minPos(cmRaw.trend, cmRaw['trend-holo']),
    avg7: minPos(cmRaw.avg7, cmRaw['avg7-holo']),
  } : null;
  let tcgLow = null, tcgMarket = null;
  if (tpRaw) {
    for (const v of Object.values(tpRaw)) {
      if (v && typeof v === 'object') {
        tcgLow = minPos(tcgLow, v.lowPrice ?? v.marketPrice);
        tcgMarket = minPos(tcgMarket, v.marketPrice);
      }
    }
  }
  const hasCm = cm && (cm.low || cm.trend || cm.avg7);
  return { cm: hasCm ? cm : null, tcg: tcgLow || tcgMarket ? { low: tcgLow, market: tcgMarket } : null };
}

// '001' en '1' zijn dezelfde kaart; 'TG01' blijft 'TG01'.
export const normNumber = n => String(n ?? '').trim().toUpperCase().replace(/^0+(?=\d)/, '');

const normName = n => String(n).toLowerCase().replace(/\b(set|series)\b/g, '').replace(/[^a-z0-9]/g, '');

// pokemontcg.io-id's als 'sv3pt5' heten bij TCGdex 'sv03.5'.
export function candidateSetIds(id) {
  const out = new Set([id]);
  const m = id.match(/^([a-z]+)(\d+)(?:pt(\d+))?$/);
  if (m) {
    const [, series, num, half] = m;
    for (const n of new Set([num, num.padStart(2, '0')])) {
      out.add(`${series}${n}${half ? '.' + half : ''}`);
    }
  }
  return [...out];
}

export function pickDexSet(list, set) {
  const byId = new Map(list.map(s => [s.id, s]));
  for (const id of candidateSetIds(set.id)) if (byId.has(id)) return byId.get(id).id;
  const sameName = list.filter(s => normName(s.name) === normName(set.name));
  const sameSize = sameName.find(s => (s.cardCount?.total ?? s.cardCount?.official) === set.total);
  return (sameSize || sameName[0])?.id ?? null;
}

let setList = null;
export async function resolveDexSet(set) {
  setList ??= (await get('/sets')) || [];
  return pickDexSet(setList, set);
}

// Haalt prijzen voor alle kaarten van de set. Geeft {map: {kaartId: {tcg, cm}}, dexSetId}.
export async function fetchSetPrices(set, cards, onProgress = () => {}) {
  const dexSetId = await resolveDexSet(set);
  if (!dexSetId) return { map: {}, dexSetId: null };
  const dexSet = await get(`/sets/${encodeURIComponent(dexSetId)}`);
  const dexCards = dexSet?.cards || [];
  const byNumber = new Map(dexCards.map(c => [normNumber(c.localId), c.id]));
  const jobs = cards.map(c => ({ card: c, dexId: byNumber.get(normNumber(c.number)) })).filter(j => j.dexId);
  const map = {};
  let done = 0, next = 0;
  async function worker() {
    while (next < jobs.length) {
      const j = jobs[next++];
      try {
        const full = await get(`/cards/${encodeURIComponent(j.dexId)}`);
        const p = parsePricing(full?.pricing);
        if (p.cm || p.tcg) map[j.card.id] = p;
      } catch {}
      onProgress(++done, jobs.length);
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));
  return { map, dexSetId };
}

// Voor de Diagnose-knop.
export async function diagnosePrices(set) {
  try {
    const dexSetId = await resolveDexSet(set);
    if (!dexSetId) return `TCGdex: geen set gevonden voor "${set.name}" (${set.id})`;
    const dexSet = await get(`/sets/${encodeURIComponent(dexSetId)}`);
    const first = dexSet?.cards?.[0];
    const full = first ? await get(`/cards/${encodeURIComponent(first.id)}`) : null;
    return `TCGdex-set: ${dexSetId} (${dexSet?.cards?.length ?? 0} kaarten)\nkaart ${first?.id}: ${JSON.stringify(full?.pricing ?? null).slice(0, 700)}`;
  } catch (e) {
    return `TCGdex: geen verbinding (${e.message})`;
  }
}
