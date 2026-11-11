'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../src/clash/engine.js');

const root = path.resolve(__dirname, '..');
const read = name => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const playtest = read('content/clash/clash_playtest.json');
const roster = read('content/clash/clash_roster_96.json');
const caps = read('content/clash/capabilities.json');
const base = C.loadPack(playtest, caps);

function table() {
  const cards = Object.assign(Object.create(null), base.cards);
  for (const card of roster.cards) cards[card.template_id] = card;
  return cards;
}

function fresh() {
  return C.Game.empty(table(), base.rules, base.capabilities);
}

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log('ok', name);
}

check('roster is the 96-card handoff and keeps the baseline cards', () => {
  assert.equal(roster.ruleset_id, 'pcg.clash.v0');
  assert.equal(roster.schema, 'pcg.clash.roster.v0');
  assert.equal(roster.cards.length, 96);
  assert.equal(new Set(roster.cards.map(card => card.rid)).size, 96);
  assert.equal(new Set(roster.cards.map(card => card.template_id)).size, 96);
  assert.equal(new Set(roster.cards.map(card => card.game_name_zh)).size, 96);
  const byTemplate = Object.create(null);
  for (const card of roster.cards) byTemplate[card.template_id] = card;
  const linked = [];
  for (const card of roster.cards) {
    assert.equal(card.design_status, 'playtest_draft');
    assert.equal(card.game_role, card.kind);
    assert.equal(C.starOf({ version: card.precise_model_or_revision }), null);
    if (!card.baseline_template_id) continue;
    linked.push(card.baseline_template_id);
    const src = playtest.cards.find(item => item.template_id === card.baseline_template_id);
    for (const key of ['cost', 'attack', 'durability', 'guard', 'effect']) {
      assert.equal(card[key], src[key], card.rid + ' ' + key);
    }
  }
  assert.deepEqual(linked.slice().sort(), ['dian_zhen', 'hou_ke', 'qiao_jian', 'xiao_yin', 'xuan_niu']);
  for (const id of ['xi_tiao', 'lian_jie', 'qian_li', 'hu_zhao', 'bu_ji', 'gan_rao', 'hui_chong']) {
    assert.equal(byTemplate[id], undefined);
    assert.ok(base.cards[id]);
  }
  const families = {};
  for (const card of roster.cards) {
    if (card.growth_kind !== 'chain') {
      assert.equal(card.star, null);
      assert.equal(card.next_template_id, null);
      continue;
    }
    (families[card.growth_family] || (families[card.growth_family] = [])).push(card);
  }
  assert.equal(Object.keys(families).length, 9);
});

check('all nine chains promote in place and reject skips', () => {
  const families = {};
  for (const card of roster.cards) {
    if (card.growth_kind === 'chain') (families[card.growth_family] || (families[card.growth_family] = [])).push(card);
  }
  for (const rows of Object.values(families)) {
    rows.sort((a, b) => a.star - b.star);
    assert.deepEqual(rows.map(card => card.star), [1, 2]);
    const game = fresh();
    const current = rows[0];
    const next = rows[1];
    const cost = Math.max(1, next.cost - current.cost);
    game.supply = [cost, 0];
    game.max_supply = [cost, 0];
    game.hands = [[next.template_id], []];
    if (current.kind === 'main') {
      game.spawn(0, 'xi_tiao', 0, null, false);
      game.spawn(0, 'xi_tiao', 1, null, false);
      game.spawn(0, 'xi_tiao', 2, null, false);
      const unit = game.spawn(0, current.template_id, 3, 1, false);
      unit.attachments = ['lian_jie'];
      unit.attacked = true;
      game.promote(0, current.template_id);
      const promoted = game.boards[0][3];
      assert.equal(promoted.card_id, next.template_id);
      assert.equal(promoted.durability, next.durability);
      assert.equal(promoted.sick, true);
      assert.deepEqual(promoted.attachments, []);
      assert.equal(promoted.attacked, false);
      assert.deepEqual(game.graves[0].slice(-2), ['lian_jie', current.template_id]);
    } else {
      const host = game.spawn(0, 'qiao_jian', 0, null, false);
      host.attachments = [current.template_id];
      game.promote(0, current.template_id);
      assert.deepEqual(host.attachments, [next.template_id]);
      assert.equal(host.sick, false);
      assert.deepEqual(game.graves[0], [current.template_id]);
    }
    assert.equal(game.supply[0], 0);
    assert.equal(game.hands[0].length, 0);
    const before = JSON.stringify(game.view());
    assert.throws(() => game.promote(0, next.template_id), error => error.code === 'no_growth');
    assert.equal(JSON.stringify(game.view()), before);
  }
});

check('promote is atomic and does not refresh support or revive a retired shell', () => {
  const game = fresh();
  game.supply = [5, 0];
  game.hands = [['art_h038a'], []];
  const stamp = game.spawn(0, 'xiao_yin', 0, null, false);
  stamp.attachments = ['lian_jie'];
  game.graves = [['hou_ke'], []];
  game.support(0);
  assert.equal(game.supply[0], 3);
  const held = game.hands[0].pop();
  assert.throws(() => game.promote(0, 'xiao_yin'), error => error.code === 'not_in_hand');
  assert.equal(game.supply[0], 3);
  game.hands[0].push(held);
  game.supply[0] = 0;
  assert.throws(() => game.promote(0, 'xiao_yin'), error => error.code === 'not_enough_supply');
  assert.equal(game.hands[0][0], 'art_h038a');
  game.supply[0] = 3;
  game.promote(0, 'xiao_yin');
  assert.equal(game.supply[0], 2);
  assert.equal(game.boards[0][0].card_id, 'hou_ke');
  assert.equal(game.boards[0][1].card_id, 'art_h038a');
  assert.throws(() => game.support(0), error => error.code === 'already_used_ability');
  assert.equal(game.supply[0], 2);
  assert.throws(() => game.promote(0, 'art_h038b'), error => error.code === 'no_growth');

  const banned = fresh();
  banned.supply = [6, 0];
  banned.spawn(0, 'xiao_yin', 0, null, false);
  banned.graves = [['hou_ke'], []];
  banned.promoteBan[0].push('hou_ke');
  assert.throws(() => banned.support(0), error => error.code === 'no_shell_in_grave');
  assert.equal(banned.supply[0], 6);
  assert.deepEqual(banned.graves[0], ['hou_ke']);
  banned.promoteBan[0] = [];
  banned.support(0);
  assert.equal(banned.supply[0], 4);
  assert.equal(banned.boards[0][0].card_id, 'hou_ke');
  assert.equal(banned.boards[0][1].card_id, 'xiao_yin');
});

check('guarded host blocks a guarding upgrade, and rush or entry effects resolve', () => {
  const blocked = fresh();
  blocked.supply = [2, 0];
  blocked.hands = [['art_c004d'], []];
  const host = blocked.spawn(0, 'dian_zhen', 0, null, false);
  host.attachments = ['art_c004c'];
  blocked.cards.art_c004d = Object.assign({}, blocked.cards.art_c004d, { grants_guard: true });
  assert.throws(() => blocked.promote(0, 'art_c004c'), error => error.code === 'already_has_guard');
  assert.equal(blocked.supply[0], 2);
  assert.deepEqual(host.attachments, ['art_c004c']);
  assert.deepEqual(blocked.hands[0], ['art_c004d']);

  const rush = fresh();
  rush.supply = [3, 20];
  rush.hands = [['art_h003'], []];
  rush.play(0, 'art_h003');
  assert.equal(rush.units(0)[0].sick, false);
  rush.attack(0, 'art_h003', 'base');
  assert.equal(rush.bases[1], 17);

  const draw = fresh();
  draw.supply = [5, 0];
  draw.decks[0] = ['xi_tiao'];
  draw.hands = [['art_h012'], []];
  draw.play(0, 'art_h012');
  assert.deepEqual(draw.hands[0], ['xi_tiao']);
  assert.equal(draw.decks[0].length, 0);

  const peck = fresh();
  peck.supply = [3, 0];
  peck.hands = [['art_h025'], []];
  const sentry = peck.spawn(1, 'dian_zhen', 0, null, false);
  peck.play(0, 'art_h025', sentry.iid);
  assert.equal(sentry.durability, 3);
  assert.equal(peck.supply[0], 0);
  const miss = fresh();
  miss.supply = [3, 0];
  miss.hands = [['art_h025'], []];
  miss.play(0, 'art_h025');
  assert.equal(miss.units(0)[0].card_id, 'art_h025');
  assert.equal(miss.supply[0], 0);
  const bad = fresh();
  bad.supply = [3, 0];
  bad.hands = [['art_h025'], []];
  assert.throws(() => bad.play(0, 'art_h025', 'missing'), error => error.code === 'bad_target');
  assert.equal(bad.supply[0], 3);
  assert.deepEqual(bad.hands[0], ['art_h025']);
});

check('a free deck can contain roster cards and the kept baseline cards', () => {
  const cards = table();
  const deck = ['xiao_yin', 'art_h038a', 'hou_ke', 'art_h003', 'art_h012', 'art_h025', 'xi_tiao', 'lian_jie'];
  assert.equal(deck.length >= 8 && deck.length <= 12, true);
  assert.ok(deck.filter(id => cards[id].kind === 'main').length >= 4);
  const game = new C.Game(cards, deck, deck, base.rules, base.tokenId, base.capabilities);
  game.start_turn();
  assert.equal(game.hands[0][0], 'xiao_yin');
  assert.equal(cards.art_h038a.name, '小印改');
  assert.equal(C.starOf(cards.art_h038a), 2);
  assert.equal(C.starOf(cards.xi_tiao), null);
});

console.log('PASS roster', passed, 'groups');
