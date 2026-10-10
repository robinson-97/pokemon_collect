import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCardNumber, cleanName, similarity, findCandidates, parseManual } from '../src/scan.js';

test('kaartnummer lezen', () => {
  assert.deepEqual(parseCardNumber('025/165'), { prefix: '', num: '25', den: '165' });
  assert.deepEqual(parseCardNumber('  4 / 102  C'), { prefix: '', num: '4', den: '102' });
  assert.deepEqual(parseCardNumber('199/165 ★'), { prefix: '', num: '199', den: '165' });
  assert.deepEqual(parseCardNumber('TG12/TG30'), { prefix: 'TG', num: '12', den: '30' });
  assert.deepEqual(parseCardNumber('SVP 045'), { prefix: 'SVP', num: '45', den: null });
  assert.equal(parseCardNumber('geen nummer'), null);
  assert.equal(parseCardNumber(''), null);
});
test('naam opschonen', () => {
  assert.equal(cleanName('BASIC Pokémon\nCharizard ex   HP 330\n'), 'Charizard ex');
  assert.equal(cleanName('x\n12'), '');
});
test('naamgelijkenis', () => {
  assert.equal(similarity('Pikachu', 'pikachu'), 1);
  assert.ok(similarity('Pikachu ex', 'Pikachu') >= 0.9);
  assert.ok(similarity('Charizrd', 'Charizard') > 0.8);
  assert.ok(similarity('Pikachu', 'Squirtle') < 0.5);
});

const sets = {
  s151: { id: 'sv3pt5', name: '151', printedTotal: 165, total: 207 },
  base: { id: 'base1', name: 'Base', printedTotal: 102, total: 102 },
  other: { id: 'sv1', name: 'Scarlet & Violet', printedTotal: 198, total: 258 },
};
const cardsBy = {
  sv3pt5: [{ id: 'sv3pt5-25', name: 'Pikachu', number: '25' }, { id: 'sv3pt5-26', name: 'Raichu', number: '26' }],
  base1: [{ id: 'base1-25', name: 'Other', number: '25' }],
  sv1: [{ id: 'sv1-25', name: 'Spidops', number: '025' }, { id: 'sv1-TG1', name: 'Tg', number: 'TG01' }],
};
const getCards = async s => cardsBy[s.id];

test('zoeken op nummer en totaal in je eigen sets', async () => {
  const r = await findCandidates({ parsed: { prefix: '', num: '25', den: '165' }, name: 'Pikachu', trackedSets: [sets.s151, sets.base], getCards });
  assert.equal(r.length, 1); assert.equal(r[0].card.id, 'sv3pt5-25'); assert.equal(r[0].tracked, true);
});
test('zoeken buiten je sets als er niets is', async () => {
  const r = await findCandidates({ parsed: { prefix: '', num: '25', den: '198' }, name: '', trackedSets: [sets.s151], otherSets: [sets.other, sets.base], getCards });
  assert.equal(r[0].card.id, 'sv1-25'); assert.equal(r[0].tracked, false);
});
test('naam bepaalt de volgorde bij meerdere treffers', async () => {
  const r = await findCandidates({ parsed: { prefix: '', num: '25', den: null }, name: 'Spidops', trackedSets: [sets.s151, sets.other], getCards });
  assert.equal(r[0].card.id, 'sv1-25');
});
test('promo-nummer met prefix', async () => {
  const r = await findCandidates({ parsed: { prefix: 'TG', num: '1', den: null }, name: '', trackedSets: [sets.other], getCards });
  assert.equal(r[0].card.id, 'sv1-TG1');
});
test('zoeken alleen op naam', async () => {
  const r = await findCandidates({ parsed: null, name: 'Raichu', trackedSets: [sets.s151], getCards });
  assert.equal(r[0].card.id, 'sv3pt5-26');
});
test('handmatige invoer', () => {
  assert.deepEqual(parseManual('25/165').parsed, { prefix: '', num: '25', den: '165' });
  assert.equal(parseManual('Pikachu').parsed, null);
  assert.equal(parseManual('Pikachu').name, 'Pikachu');
});
