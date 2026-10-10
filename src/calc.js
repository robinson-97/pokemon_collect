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
