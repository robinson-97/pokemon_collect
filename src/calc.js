// Pure berekeningen (los van de DOM, zodat ze testbaar zijn).
export function summarize(cards, owned) {
  const missing = cards.filter(c => !owned.has(c.id));
  const pricedMissing = missing.filter(c => c.price != null);
  return {
    total: cards.length,
    owned: cards.length - missing.length,
    missing: missing.length,
    percent: cards.length ? Math.round(((cards.length - missing.length) / cards.length) * 100) : 0,
    costToComplete: pricedMissing.reduce((sum, c) => sum + c.price, 0),
    withoutPrice: missing.length - pricedMissing.length,
  };
}

export const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

// Filtercategorie van een kaart: Pokémon-type (Fire, Water, …), of Trainer / Energy.
export function categoryOf(card) {
  if (card.supertype === 'Pokémon') return card.types[0] || 'Colorless';
  return card.supertype || 'Overig';
}
export const TYPE_NL = {
  Grass: 'Gras', Fire: 'Vuur', Water: 'Water', Lightning: 'Elektrisch', Psychic: 'Psychisch',
  Fighting: 'Gevecht', Darkness: 'Duister', Metal: 'Metaal', Fairy: 'Fee', Dragon: 'Draak',
  Colorless: 'Kleurloos', Trainer: 'Trainer', Energy: 'Energie',
};
export const TYPE_COLOR = {
  Grass: '#4caf50', Fire: '#f4511e', Water: '#1e88e5', Lightning: '#fbc02d', Psychic: '#ab47bc',
  Fighting: '#a1572b', Darkness: '#455a64', Metal: '#90a4ae', Fairy: '#ec7fb6', Dragon: '#b8860b',
  Colorless: '#bdbdbd', Trainer: '#5c6bc0', Energy: '#26a69a',
};

// Staat van de kaart, volgens de TCGplayer-indeling.
export const CONDITIONS = [
  { code: 'NM', nl: 'Near Mint', hint: 'Bijna perfect' },
  { code: 'LP', nl: 'Lightly Played', hint: 'Lichte gebruikssporen' },
  { code: 'MP', nl: 'Moderately Played', hint: 'Duidelijke gebruikssporen' },
  { code: 'HP', nl: 'Heavily Played', hint: 'Veel slijtage' },
  { code: 'DMG', nl: 'Damaged', hint: 'Beschadigd' },
];

export const eur = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' });
export const SOURCES = {
  cm: { name: 'Cardmarket', fmt: eur },
  tcg: { name: 'TCGplayer', fmt: usd },
};

// Laagste prijs voor een kaart. cond = staat van je kaart, of null voor een kaart die je nog mist
// (dan geldt 'want': 'NM' = Excellent of beter, 'any' = goedkoopste exemplaar in welke staat dan ook).
// Cardmarket kent geen prijs per staat; NM en LP krijgen de 'Excellent of beter'-prijs, MP/HP/DMG de laagste prijs.
// TCGplayer-prijzen gelden voor Near Mint en zijn niet per staat beschikbaar.
export function priceFor(card, source, cond, want = 'NM') {
  if (source === 'tcg') return card.tcg?.low ?? card.tcg?.market ?? null;
  const cm = card.cm;
  if (!cm) return null;
  const c = cond || want;
  const excellentPlus = c === 'NM' || c === 'LP';
  return (excellentPlus ? cm.lowEx ?? cm.low : cm.low) ?? null;
}

// Geeft kaarten met een 'price' voor de gekozen bron, klaar voor summarize().
export const withPrices = (cards, source, want) => cards.map(c => ({ ...c, price: priceFor(c, source, null, want) }));

// Heeft de gekozen bron voor deze set helemaal geen prijzen (bijv. promosets zonder TCGplayer-aanbod),
// maar de andere wel? Dan tonen we de andere bron.
export function effectiveSource(cards, pref, want) {
  const count = src => cards.filter(c => priceFor(c, src, null, want) != null).length;
  if (count(pref) > 0) return pref;
  const other = pref === 'cm' ? 'tcg' : 'cm';
  return count(other) > 0 ? other : pref;
}
