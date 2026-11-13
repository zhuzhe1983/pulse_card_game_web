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
const services = read('content/clash/clash_tactics.json');
const balance = read('content/clash/clash_balance.json');
roster.cards = roster.cards.map(card => ({ ...card, ...(balance.card_overrides[card.template_id] || {}) }));
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

function chainTop(card) {
  return !!(card && card.growth_kind === 'chain' && card.star && !card.next_template_id);
}

check('many seeds deal two 30-card decks and replay', () => {
  const seeds = [1, 2, 7, 42, 99, 123456, 0x7ba58fb3, 999983];
  const seen = new Set();
  const servicesIn = services.cards;
  const pool = catalog.included.concat(servicesIn);
  const byId = Object.create(null);
  pool.forEach(card => { byId[card.template_id] = card; });
  const serviceIds = ['pulse_bolt','arc_wave','emergency_stop','cache_read','repair_protocol'];
  function hostOk(deck, card) {
    const mains = deck.map(id => byId[id]).filter(item => item && item.kind === 'main');
    if (card.mount_class === 'hat') return mains.some(item => item.host_family === 'stick');
    if (card.mount_class === 'module') return mains.some(item => item.host_family === 'core');
    if (card.mount_class === 'base' || card.mount_class === 'unit') return mains.some(item => item.host_family === 'atom');
    if (card.mount_class === 'chain') return mains.length > 0;
    return true;
  }
  seeds.forEach(seed => {
    const once = C.buildSimDecks(pool, seed);
    const twice = C.buildSimDecks(pool, seed);
    assert.deepEqual(twice.decks, once.decks);
    assert.equal(once.notes.includes('牌池不足'), false, JSON.stringify(once.notes));
    seen.add(JSON.stringify(once.decks));
    assert.notEqual(once.decks[0].join(','), once.decks[1].join(','));
    once.decks.forEach(deck => {
      assert.equal(deck.length, 30);
      assert.equal(deck.includes('jie_yi_ge_dian') || deck.includes('bei_yong_dian_chi'), false);
      const counts = {};
      deck.forEach(id => { counts[id] = (counts[id] || 0) + 1; });
      Object.keys(counts).forEach(id => {
        const card = byId[id];
        assert.ok(card, id);
        assert.ok(counts[id] <= (chainTop(card) ? 1 : 2));
        if (chainTop(card)) assert.ok(counts[id] <= 1);
      });
      const cards = deck.map(id => byId[id]);
      const mains = cards.filter(card => card.kind === 'main');
      assert.ok(cards.slice(0, 4).filter(card => card.kind === 'main' && card.cost <= 2).length >= 2, 'opening protection includes actual deployable bodies');
      const parts = cards.filter(card => card.kind === 'attachment');
      assert.equal(mains.length, 16);
      assert.equal(cards.filter(card => card.kind === 'spell').length, 10);
      assert.ok(parts.length >= 4 && parts.length <= 6);
      serviceIds.forEach(id => assert.ok(counts[id] >= 1, id));
      parts.forEach(card => assert.equal(hostOk(deck, card), true, card.template_id));
      assert.ok(mains.filter(card => card.cost <= 2).length >= 5);
      assert.ok(cards.filter(card => card.cost >= 3 && card.cost <= 5).length >= 5);
      assert.ok(cards.filter(card => card.cost >= 6).length >= 2);
      assert.ok(cards.slice(0, 4).filter(card => card.cost <= 2).length >= 2);
    });
  });
  assert.equal(seen.size, seeds.length);
  assert.equal(playtest.decks.first.length, 8);
  assert.equal(playtest.hand_limit, 8);
});

check('a 30-card deck deals 3 and 4, burns at 10, fatigues the core, and the spare battery is legal for the opponent', () => {
  const loaded = C.loadPack(playtest, caps);
  roster.cards.forEach(card => { loaded.cards[card.template_id] = card; });
  services.cards.forEach(card => { loaded.cards[card.template_id] = card; });
  loaded.cards.bei_yong_dian_chi = {
    template_id: 'bei_yong_dian_chi', name: '备用电池', kind: 'spell', cost: 0, attack: 0, durability: 0,
    attack_bonus: 0, grants_guard: false, bypass_guard: false, guard: false, effect: 'supply', amount: 1
  };
  const servicesIn = services.cards;
  const built = C.buildSimDecks(catalog.included.concat(servicesIn), 42);
  const simRules = Object.assign({}, loaded.rules, { handLimit: 10 });
  const game = new C.Game(loaded.cards, built.decks[0], built.decks[1], simRules, 'bei_yong_dian_chi', loaded.capabilities);
  game.start_turn();
  assert.equal(game.hands[0].length, 3);
  assert.equal(game.hands[1].length, 5);
  assert.equal(game.hands[1].includes('bei_yong_dian_chi'), true);
  assert.equal(game.decks[0].length, 27);
  assert.equal(game.decks[1].length, 26);
  assert.equal(built.decks[1].includes('bei_yong_dian_chi'), false);
  const burned = C.Game.empty(loaded.cards, simRules, loaded.capabilities);
  burned.hands[0] = new Array(10).fill('xiao_yin');
  burned.decks[0] = ['art_h024'];
  burned.draw(0);
  assert.equal(burned.hands[0].length, 10);
  assert.deepEqual(burned.graves[0], ['art_h024']);
  const tired = C.Game.empty(loaded.cards, simRules, loaded.capabilities);
  tired.decks[0] = [];
  tired.bases[0] = 20;
  tired.draw(0);
  tired.draw(0);
  assert.equal(tired.bases[0], 17);
  assert.equal(tired.fatigue[0], 2);
  const ai = C.Game.empty(loaded.cards, simRules, loaded.capabilities);
  ai.seat = 1;
  ai.hands[1] = ['bei_yong_dian_chi', 'dian_zhen'];
  ai.supply[1] = 1;
  const action = C.planAi(C.aiView(ai), new Set());
  assert.equal(action.type, 'play');
  assert.equal(action.card, 'bei_yong_dian_chi');
  C.applyAi(ai, action);
  assert.equal(ai.supply[1], 2);
  C.finishTurn(ai);
  assert.equal(ai.supply[1], 0);
});

console.log('PASS', passed, 'sim', 'pool', catalog.included.length, 'excluded', catalog.excluded.length);
