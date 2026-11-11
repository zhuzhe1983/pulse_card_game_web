'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../src/clash/engine.js');

const root = path.resolve(__dirname, '..');
const read = name => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const roster = read('content/clash/clash_roster_96.json');
const wiki = read('wiki/data/cards.json');
const playtest = read('content/clash/clash_playtest.json');
const services = read('content/clash/clash_services.json');
const caps = read('content/clash/capabilities.json');
const art = wiki.cards.map(card => card.rid);
const catalog = C.simCatalog(roster.cards, art);
const outside = [
  'lian_jie', 'qian_li', 'hu_zhao', 'bu_ji', 'gan_rao', 'hui_chong', 'jie_yi_ge_dian', 'xi_tiao',
  'uiflow_blocks', 'ezdata_note', 'aiflow_say', 'burner_seize', 'cm4_stack'
];

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log('ok', name);
}

check('the illustrated roster is the candidate pool', () => {
  assert.equal(roster.cards.length, 96);
  assert.equal(catalog.included.length, 96);
  assert.equal(catalog.excluded.length, 0);
  const ids = new Set(catalog.included.map(card => card.template_id));
  assert.equal(ids.size, 96);
  outside.forEach(id => assert.equal(ids.has(id), false, id));
  services.cards.concat(services.design_hosts || []).forEach(card => {
    assert.equal(ids.has(card.template_id), false, card.template_id);
  });
  catalog.included.forEach(card => {
    assert.ok(card.kind === 'main' || card.kind === 'attachment');
    assert.ok(!card.effect || C.IMPLEMENTED_EFFECTS.includes(card.effect), card.template_id);
    assert.ok(art.includes(card.rid), card.rid);
  });
});

check('many seeds deal two playable twelve-card decks and replay', () => {
  const seeds = [1, 2, 7, 42, 99, 123456, 0x7ba58fb3, 999983];
  const seen = new Set();
  const byId = Object.create(null);
  catalog.included.forEach(card => { byId[card.template_id] = card; });
  seeds.forEach(seed => {
    const once = C.buildSimDecks(catalog.included, seed);
    const twice = C.buildSimDecks(catalog.included, seed);
    assert.deepEqual(twice.decks, once.decks);
    assert.equal(once.notes.includes('牌池不足'), false, JSON.stringify(once.notes));
    seen.add(JSON.stringify(once.decks));
    assert.notEqual(once.decks[0].join(','), once.decks[1].join(','));
    once.decks.forEach(deck => {
      assert.equal(deck.length, 12);
      assert.equal(new Set(deck).size, 12);
      assert.equal(deck.includes('jie_yi_ge_dian'), false);
      const cards = deck.map(id => byId[id]);
      assert.ok(cards.every(Boolean));
      assert.ok(cards.filter(card => card.kind === 'main').length >= 4);
      assert.ok(cards.filter(card => card.kind === 'main' && card.cost <= 2).length >= 2);
      assert.ok(cards.filter(card => card.cost >= 3 && card.cost <= 5).length >= 2);
      assert.ok(cards.filter(card => card.cost >= 6).length >= 1);
      assert.ok(cards.filter(card => card.kind === 'attachment').length >= 2);
      assert.ok(cards.slice(0, 4).filter(card => card.cost <= 2).length >= 2);
    });
  });
  assert.equal(seen.size, seeds.length);
});

check('a seeded deck can be played and the coin stays outside the twelve', () => {
  const loaded = C.loadPack(playtest, caps);
  roster.cards.forEach(card => { loaded.cards[card.template_id] = card; });
  const built = C.buildSimDecks(catalog.included, 42);
  const game = new C.Game(loaded.cards, built.decks[0], built.decks[1], loaded.rules, loaded.tokenId, loaded.capabilities);
  game.start_turn();
  assert.equal(game.hands[1].includes(loaded.tokenId), true);
  assert.equal(built.decks[0].includes(loaded.tokenId), false);
  assert.equal(built.decks[1].includes(loaded.tokenId), false);
  game.supply[0] = 10;
  const main = game.hands[0].find(id => loaded.cards[id].kind === 'main');
  game.play(0, main, null, null, 0);
  assert.equal(game.boards[0].some(unit => unit.card_id === main), true);
  assert.equal(game.hands[0].includes(main), false);
});

console.log('PASS', passed, 'sim', 'pool', catalog.included.length, 'excluded', catalog.excluded.length);
