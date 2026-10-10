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

// TCGplayer-prijzen zijn in US-dollars.
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
