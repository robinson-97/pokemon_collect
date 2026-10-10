import test from 'node:test';
import assert from 'node:assert/strict';
import { summarize, priceFor, withPrices } from '../src/calc.js';
import { lowestPrice, byNumber } from '../src/api.js';

const cards = [
  { id: 'a-1', price: 1.5 }, { id: 'a-2', price: 0.25 }, { id: 'a-3', price: null }, { id: 'a-4', price: 10 },
];

test('summarize telt ontbrekende kaarten en kosten', () => {
  const s = summarize(cards, new Set(['a-4']));
  assert.equal(s.owned, 1); assert.equal(s.missing, 3); assert.equal(s.percent, 25);
  assert.equal(s.costToComplete, 1.75); assert.equal(s.withoutPrice, 1);
});
test('compleet = 100% en 0 kosten', () => {
  const s = summarize(cards, new Set(cards.map(c => c.id)));
  assert.equal(s.percent, 100); assert.equal(s.costToComplete, 0);
});
test('lowestPrice kiest goedkoopste variant, valt terug op market', () => {
  assert.equal(lowestPrice({ normal: { low: 2 }, holofoil: { low: 0.5 } }), 0.5);
  assert.equal(lowestPrice({ normal: { low: null, market: 3 } }), 3);
  assert.equal(lowestPrice(undefined), null);
});
test('kaartnummers sorteren natuurlijk', () => {
  const sorted = [{ number: '10' }, { number: '2' }, { number: 'TG01' }, { number: '1' }].sort(byNumber);
  assert.deepEqual(sorted.map(c => c.number), ['1', '2', '10', 'TG01']);
});

const card = { tcg: { low: 2, market: 3 }, cm: { low: 0.5, lowEx: 0.9 } };
test('priceFor Cardmarket kiest op staat', () => {
  assert.equal(priceFor(card, 'cm', 'NM'), 0.9);
  assert.equal(priceFor(card, 'cm', 'LP'), 0.9);
  assert.equal(priceFor(card, 'cm', 'HP'), 0.5);
  assert.equal(priceFor(card, 'cm', null, 'NM'), 0.9);
  assert.equal(priceFor(card, 'cm', null, 'any'), 0.5);
  assert.equal(priceFor({ cm: { low: 0.5, lowEx: null } }, 'cm', 'NM'), 0.5);
  assert.equal(priceFor({ cm: null }, 'cm', 'NM'), null);
});
test('priceFor TCGplayer en withPrices', () => {
  assert.equal(priceFor(card, 'tcg', 'HP'), 2);
  assert.equal(priceFor({ tcg: { low: null, market: 3 } }, 'tcg', null), 3);
  assert.equal(summarize(withPrices([{ id: 'a', ...card }], 'cm', 'any'), new Set()).costToComplete, 0.5);
});
