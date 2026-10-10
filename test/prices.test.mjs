import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePricing, normNumber, candidateSetIds, pickDexSet } from '../src/prices.js';

test('parsePricing: Cardmarket en TCGplayer', () => {
  const p = parsePricing({
    cardmarket: { unit: 'EUR', low: 0.2, trend: 0.5, avg7: 0.4, 'low-holo': 0.1 },
    tcgplayer: { unit: 'USD', normal: { lowPrice: 0.5, marketPrice: 0.7 }, holofoil: { lowPrice: 0.3, marketPrice: 0.9 } },
  });
  assert.equal(p.cm.low, 0.1); assert.equal(p.cm.trend, 0.5); assert.equal(p.cm.lowEx, null);
  assert.equal(p.tcg.low, 0.3); assert.equal(p.tcg.market, 0.7);
});
test('parsePricing: leeg of nul geeft null', () => {
  assert.deepEqual(parsePricing(undefined), { cm: null, tcg: null });
  assert.deepEqual(parsePricing({ cardmarket: { low: 0, trend: 0 } }), { cm: null, tcg: null });
});
test('kaartnummers normaliseren', () => {
  assert.equal(normNumber('001'), '1'); assert.equal(normNumber('1'), '1');
  assert.equal(normNumber('tg01'), 'TG01'); assert.equal(normNumber('0'), '0');
});
test('set-id kandidaten', () => {
  assert.deepEqual(candidateSetIds('sv3pt5').sort(), ['sv03.5', 'sv3.5', 'sv3pt5']);
  assert.ok(candidateSetIds('sv1').includes('sv01'));
  assert.equal(candidateSetIds('base1')[0], 'base1');
});
test('pickDexSet: op id, anders op naam en grootte', () => {
  const list = [{ id: 'sv03.5', name: '151', cardCount: { total: 207 } }, { id: 'base1', name: 'Base Set', cardCount: { total: 102 } },
    { id: 'me02', name: 'Phantasmal Flames', cardCount: { total: 130 } }];
  assert.equal(pickDexSet(list, { id: 'sv3pt5', name: '151', total: 207 }), 'sv03.5');
  assert.equal(pickDexSet(list, { id: 'base1', name: 'Base', total: 102 }), 'base1');
  assert.equal(pickDexSet(list, { id: 'zzz', name: 'Base', total: 102 }), 'base1');
  assert.equal(pickDexSet(list, { id: 'me2', name: 'Phantasmal Flames', total: 130 }), 'me02');
  assert.equal(pickDexSet(list, { id: 'x', name: 'Onbekend', total: 1 }), null);
});
