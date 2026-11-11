'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../src/clash/engine.js');

const root = path.resolve(__dirname, '..');
const read = name => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const playtest = read('content/clash/clash_playtest.json');
const services = read('content/clash/clash_services.json');
const roster = read('content/clash/clash_roster_96.json');
const caps = read('content/clash/capabilities.json');
const base = C.loadPack(playtest, caps);

function table() {
  const cards = Object.assign(Object.create(null), base.cards);
  for (const card of services.cards.concat(services.design_hosts)) cards[card.template_id] = card;
  const byId = Object.create(null);
  for (const card of roster.cards) byId[card.template_id] = card;
  cards.art_h050 = byId.art_h050;
  cards.art_h018 = byId.art_h018;
  cards.art_h024 = byId.art_h024;
  const chain = roster.cards.find(card => card.chain_piece && card.kind === 'attachment' && !card.grants_guard);
  cards[chain.template_id] = chain;
  cards.zero_atk = Object.assign({}, cards.art_h024, { template_id: 'zero_atk', name: '零攻', attack: 0 });
  return { cards, chainId: chain.template_id };
}

function arena() {
  const packed = table();
  const game = C.Game.empty(packed.cards, base.rules, base.capabilities);
  game.phase = 'main';
  game.seat = 0;
  game.supply = [10, 10];
  game.max_supply = [8, 8];
  return { game, chainId: packed.chainId, cards: packed.cards };
}

function fingerprint(game) {
  return JSON.stringify(game.view());
}

function rejects(code, fn) {
  assert.throws(fn, error => error instanceof C.ClashError && error.code === code);
}

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log('ok', name);
}

check('leader percent and low attack ceil', () => {
  const { game } = arena();
  game.spawn(0, 'xiao_yin', null, null, false);
  assert.equal(game.formationState(0).percent, 10);
  game.attack(0, 'xiao_yin', 'base');
  assert.equal(game.bases[1], 18);
});

check('zero attack stays zero', () => {
  const { game } = arena();
  game.spawn(0, 'zero_atk', null, null, false);
  game.attack(0, 'zero_atk', 'base');
  assert.equal(game.bases[1], 20);
});

check('chain run breaks and recalculates', () => {
  const { game, chainId } = arena();
  game.spawn(0, 'qiao_jian', null, null, false);
  game.spawn(0, 'xiao_yin', null, null, false);
  game.hands[0] = [chainId, 'lian_jie', chainId];
  game.play(0, chainId, 'qiao_jian', null, 1);
  assert.deepEqual(game.formationState(0), { leader: true, chain_run: 1, percent: 15 });
  game.play(0, 'lian_jie', 'xiao_yin');
  assert.equal(game.formationState(0).percent, 15);
  const before = fingerprint(game);
  rejects('bad_index', () => game.play(0, chainId, 'qiao_jian', null, 99));
  assert.equal(fingerprint(game), before);
  const link = game.boards[0].find(unit => unit.link && unit.card_id === chainId);
  game.boards[0].splice(game.boards[0].indexOf(link), 1);
  game.boards[0].splice(0, 0, link);
  game.reindex(0);
  assert.equal(game.formationState(0).percent, 0);
  const host = game.units(0).find(unit => unit.card_id === 'qiao_jian');
  host.durability = 0;
  game.check_deaths();
  assert.deepEqual(game.units(0).map(unit => unit.card_id), ['xiao_yin']);
  assert.equal(game.graves[0].filter(id => id === chainId).length, 1);
  assert.equal(game.boards[0].some(unit => unit.link && unit.card_id === 'lian_jie'), true);
});

check('three links and counter uses defender formation', () => {
  const { game, chainId } = arena();
  game.spawn(0, 'xiao_yin', null, null, false);
  game.spawn(0, 'dian_zhen', null, null, false);
  game.spawn(0, 'hou_ke', null, null, false);
  game.hands[0] = [chainId, chainId, chainId];
  game.play(0, chainId, 'xiao_yin', null, 1);
  game.play(0, chainId, 'dian_zhen', null, 2);
  game.play(0, chainId, 'hou_ke', null, 3);
  assert.equal(game.formationState(0).percent, 25);
  game.spawn(1, 'art_h024', null, null, false);
  game.attack(0, 'xiao_yin', 'art_h024');
  assert.deepEqual(game.units(1), []);
  assert.equal(game.units(0).some(unit => unit.card_id === 'xiao_yin'), false);
});

check('fixed spell ignores percent', () => {
  const { game } = arena();
  game.spawn(0, 'qiao_jian', null, null, false);
  game.spawn(1, 'hou_ke', null, null, false);
  game.hands[0] = ['gan_rao'];
  game.play(0, 'gan_rao', 'hou_ke');
  assert.equal(game.units(1)[0].durability, 5);
});

check('connect aura does not stack or reprint', () => {
  const { game } = arena();
  const upper = game.spawn(0, 'art_h050', null, null, false);
  game.spawn(0, 'qiao_jian', null, null, false);
  const other = game.spawn(0, 'xiao_yin', null, null, false);
  game.spawn(0, 'cm4_stack', null, null, false);
  game.upperLink(0, 'art_h050', 'qiao_jian');
  assert.equal(game.supply[0], 9);
  assert.equal(game.upper_links[0].length, 1);
  game.supply[0] = 10;
  game.upperLink(0, 'cm4_stack', 'xiao_yin');
  assert.equal(game.supply[0], 9);
  game.attack(0, 'qiao_jian', 'base');
  assert.equal(game.bases[1], 13);
  const before = fingerprint(game);
  rejects('already_used_ability', () => game.upperLink(0, 'art_h050', 'xiao_yin'));
  assert.equal(fingerprint(game), before);
  other.durability = 0;
  game.check_deaths();
  assert.equal(game.upper_links[0].length, 1);
  upper.durability = 0;
  game.check_deaths();
  assert.deepEqual(game.upper_links[0], []);
  assert.equal(game.supply[0], 8);
});

check('illegal upper link types are atomic', () => {
  const { game, chainId } = arena();
  game.spawn(0, 'art_h018', null, null, false);
  game.spawn(0, 'art_h050', null, null, false);
  game.spawn(0, 'qiao_jian', null, null, false);
  game.spawn(1, 'xiao_yin', null, null, false);
  game.hands[0] = [chainId];
  game.play(0, chainId, 'qiao_jian');
  const link = game.boards[0].find(unit => unit.link);
  let before = fingerprint(game);
  for (const pair of [
    ['art_h018', 'qiao_jian'],
    ['art_h050', 'art_h018'],
    ['art_h050', 'xiao_yin'],
    ['art_h050', 'art_h050'],
    ['art_h050', link.iid]
  ]) {
    rejects('bad_target', () => game.upperLink(0, pair[0], pair[1]));
    assert.equal(fingerprint(game), before);
  }
  game.supply[0] = 0;
  before = fingerprint(game);
  rejects('not_enough_supply', () => game.upperLink(0, 'art_h050', 'qiao_jian'));
  assert.equal(fingerprint(game), before);
});

check('reconnect same turn does not grant supply again', () => {
  const { game } = arena();
  game.max_supply = [4, 4];
  game.supply = [4, 4];
  const upper = game.spawn(0, 'cm4_stack', null, null, false);
  const target = game.spawn(0, 'art_h024', null, null, false);
  game.upperLink(0, upper.iid, target.iid);
  assert.equal(game.supply[0], 4);
  target.durability = 0;
  game.check_deaths();
  assert.equal(game.supply[0], 4);
  game.supply[0] = 4;
  game.spawn(0, 'qiao_jian', null, null, false);
  game.upperLink(0, 'cm4_stack', 'qiao_jian');
  assert.equal(game.supply[0], 3);
  assert.equal(game.upper_links[0][0].source, upper.iid);
});

check('three services and combo order', () => {
  const { game } = arena();
  game.decks[0] = ['hou_ke'];
  game.hands[0] = ['uiflow_blocks', 'ezdata_note', 'aiflow_say', 'gan_rao'];
  game.play(0, 'uiflow_blocks');
  assert.equal(game.hands[0].at(-1), 'hou_ke');
  assert.equal(game.graves[0].includes('uiflow_blocks'), true);
  game.play(0, 'ezdata_note');
  assert.equal(game.hands[0].includes('uiflow_blocks'), true);
  assert.equal(game.graves[0].includes('uiflow_blocks'), false);
  game.graves[0] = [];
  game.hands[0] = ['ezdata_note'];
  game.supply[0] = 2;
  game.play(0, 'ezdata_note');
  assert.deepEqual(game.graves[0], ['ezdata_note']);
  game.hands[0] = ['aiflow_say', 'aiflow_say'];
  game.supply[0] = 8;
  game.spawn(0, 'art_h024', null, null, false);
  game.play(0, 'aiflow_say');
  const before = fingerprint(game);
  rejects('already_used_ability', () => game.play(0, 'aiflow_say'));
  assert.equal(fingerprint(game), before);
  game.attack(0, 'art_h024', 'base');
  assert.equal(game.bases[1], 15);
  assert.equal(game.aiflow_armed[0], false);
  game.hands[0] = ['aiflow_say', 'gan_rao'];
  game.supply[0] = 8;
  game.spawn(1, 'hou_ke', null, null, false);
  game.play(0, 'aiflow_say');
  game.play(0, 'gan_rao', 'hou_ke');
  assert.equal(game.units(1)[0].durability, 5);
  assert.equal(game.aiflow_armed[0], true);
  game.end_turn(0);
  assert.equal(game.aiflow_armed[0], false);
});

check('seize moves control and keeps state', () => {
  const { game, chainId } = arena();
  game.hands[0] = ['burner_seize'];
  const foe = game.spawn(1, 'qiao_jian', null, null, false);
  foe.durability = 2;
  game.hands[1] = [chainId];
  game.spawn(1, 'art_h050', null, null, false);
  game.seat = 1;
  game.play(1, chainId, 'qiao_jian', null, 1);
  game.upperLink(1, 'art_h050', 'qiao_jian');
  game.seat = 0;
  const beforeDur = foe.durability;
  game.play(0, 'burner_seize', 'qiao_jian');
  assert.equal(game.supply[0], 3);
  assert.deepEqual(game.units(0).map(unit => unit.card_id), ['qiao_jian']);
  const moved = game.units(0)[0];
  assert.equal(moved.durability, beforeDur);
  assert.deepEqual(moved.attachments, [chainId]);
  assert.equal(moved.sick, true);
  assert.equal(moved.ability_lock, true);
  assert.equal(game.boards[0].at(-1).link, true);
  assert.equal(game.formationState(0).percent, 15);
  assert.equal(game.formationState(1).percent, 10);
  assert.deepEqual(game.upper_links[1], []);
  rejects('summoning_sickness', () => game.attack(0, 'qiao_jian', 'base'));
  assert.equal(game.graves[0].includes('burner_seize'), true);
  moved.durability = 0;
  game.check_deaths();
  assert.deepEqual(game.graves[0].slice(-2), [chainId, 'qiao_jian']);
  assert.equal(game.graves[1].includes('qiao_jian'), false);
});

check('illegal seize is atomic and leader can be taken', () => {
  const { game, chainId } = arena();
  game.hands[0] = ['burner_seize', 'burner_seize', 'burner_seize'];
  game.spawn(0, 'xiao_yin', null, null, false);
  const leader = game.spawn(1, 'art_h050', null, null, false);
  game.hands[1] = [chainId];
  game.seat = 1;
  game.play(1, chainId, 'art_h050', null, 1);
  game.seat = 0;
  const link = game.boards[1].find(unit => unit.link);
  const before = fingerprint(game);
  assert.throws(() => game.play(0, 'burner_seize', 'base'));
  assert.throws(() => game.play(0, 'burner_seize', link.iid));
  assert.throws(() => game.play(0, 'burner_seize', 'xiao_yin'));
  assert.equal(fingerprint(game), before);
  game.play(0, 'burner_seize', leader.iid);
  assert.equal(game.units(0).at(-1).card_id, 'art_h050');
  assert.deepEqual(game.units(1), []);
  assert.equal(game.supply[0], 3);
});

check('seized shell returns to the current controller', () => {
  const { game } = arena();
  game.hands[0] = ['burner_seize'];
  game.spawn(0, 'xiao_yin', null, null, false);
  game.spawn(1, 'xiao_yin', null, null, false);
  game.spawn(1, 'hou_ke', null, null, false);
  game.play(0, 'burner_seize', 'hou_ke');
  const seized = game.units(0).find(unit => unit.card_id === 'hou_ke');
  seized.durability = 0;
  seized.sick = false;
  game.check_deaths();
  game.ability_used[0].support = 1;
  const before = game.supply[0];
  rejects('already_used_ability', () => game.support(0));
  assert.equal(game.supply[0], before);
  game.ability_used[0] = {};
  game.support(0);
  assert.equal(game.units(0)[0].card_id, 'hou_ke');
  assert.equal(game.units(0)[0].durability, 7);
  game.seat = 1;
  rejects('no_shell_in_grave', () => game.support(1));
});

check('services are not hardware cards', () => {
  const rosterIds = new Set(roster.cards.map(card => card.template_id));
  assert.equal(roster.cards.length, 96);
  for (const id of ['uiflow_blocks', 'ezdata_note', 'aiflow_say', 'burner_seize']) {
    assert.equal(rosterIds.has(id), false);
  }
  for (const card of services.cards.concat(services.design_hosts)) {
    assert.equal(card.trusted_sku, null);
    assert.equal(card.artwork, null);
  }
  const zero = roster.cards.find(card => card.template_id === 'art_h050');
  assert.deepEqual([zero.cost, zero.attack, zero.durability], [10, 4, 7]);
  assert.equal(zero.upper_host, true);
  const core = roster.cards.find(card => card.template_id === 'art_h018');
  assert.equal(Object.prototype.hasOwnProperty.call(core, 'upper_host'), false);
  const byId = Object.create(null);
  for (const card of playtest.cards) byId[card.template_id] = card;
  assert.equal(byId.lian_jie.attack_bonus, 1);
  assert.equal(byId.xiao_yin.cost, 1);
  assert.equal(byId.lian_jie.chain_piece, true);
});

console.log('PASS clash synergy ' + passed);
