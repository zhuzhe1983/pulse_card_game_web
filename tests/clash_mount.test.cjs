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
const loaded = C.loadPack(playtest, caps);
roster.cards.forEach(card => { loaded.cards[card.template_id] = card; });

function board(supply, hand, hosts) {
  const game = C.Game.empty(loaded.cards, loaded.rules, loaded.capabilities);
  game.phase = 'main';
  game.seat = 0;
  game.supply = [supply, supply];
  game.hands = [hand.slice(), []];
  hosts.forEach(id => game.spawn(0, id, null, null, false));
  return game;
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

check('hat, module, base and unit slots', () => {
  const hat = board(2, ['art_a001', 'art_a002'], ['art_h024']);
  hat.play(0, 'art_a001', 'art_h024');
  const beforeHat = JSON.stringify(hat.view());
  rejects('hat_slot_full', () => hat.play(0, 'art_a002', 'art_h024'));
  assert.equal(JSON.stringify(hat.view()), beforeHat);
  const wrong = board(1, ['art_a001'], ['xiao_yin']);
  const beforeWrong = JSON.stringify(wrong.view());
  assert.throws(() => wrong.play(0, 'art_a001', 'xiao_yin'), error => {
    return error instanceof C.ClashError && error.code === 'wrong_host' && String(error.message).includes('Hat');
  });
  assert.equal(JSON.stringify(wrong.view()), beforeWrong);

  const module = board(4, ['art_s001a'], ['art_h003']);
  module.play(0, 'art_s001a', 'art_h003');
  assert.deepEqual(module.units(0)[0].attachments, ['art_s001a']);
  rejects('wrong_host', () => board(4, ['art_s001a'], ['art_h024']).play(0, 'art_s001a', 'art_h024'));

  const base = board(2, ['art_c004c', 'art_c004h'], ['dian_zhen']);
  base.play(0, 'art_c004c', 'dian_zhen');
  const beforeBase = JSON.stringify(base.view());
  rejects('base_slot_full', () => base.play(0, 'art_c004h', 'dian_zhen'));
  assert.equal(JSON.stringify(base.view()), beforeBase);

  const unit = board(8, ['art_u002a', 'art_u002a'], ['dian_zhen']);
  unit.play(0, 'art_u002a', 'dian_zhen');
  const beforeUnit = JSON.stringify(unit.view());
  rejects('unit_slot_full', () => unit.play(0, 'art_u002a', 'dian_zhen'));
  assert.equal(JSON.stringify(unit.view()), beforeUnit);

  const widened = board(13, ['art_c004a', 'art_u002a', 'art_u002a', 'art_u002a'], ['dian_zhen']);
  widened.play(0, 'art_c004a', 'dian_zhen');
  widened.play(0, 'art_u002a', 'dian_zhen');
  widened.play(0, 'art_u002a', 'dian_zhen');
  assert.equal(widened.units(0)[0].attachments.filter(id => id === 'art_u002a').length, 2);
  const beforeWide = JSON.stringify(widened.view());
  rejects('unit_slot_full', () => widened.play(0, 'art_u002a', 'dian_zhen'));
  assert.equal(JSON.stringify(widened.view()), beforeWide);
});

check('chain needs the atom bus and a severed piece stops later bonuses', () => {
  const bare = board(1, ['art_c002c'], ['dian_zhen']);
  const beforeBare = JSON.stringify(bare.view());
  rejects('need_to_chain', () => bare.play(0, 'art_c002c', 'dian_zhen'));
  assert.equal(JSON.stringify(bare.view()), beforeBare);

  const stamp = board(2, ['art_c002c', 'art_c002c'], ['xiao_yin']);
  stamp.play(0, 'art_c002c', 'xiao_yin');
  const beforeStamp = JSON.stringify(stamp.view());
  rejects('chain_slot_full', () => stamp.play(0, 'art_c002c', 'xiao_yin'));
  assert.equal(JSON.stringify(stamp.view()), beforeStamp);

  const bus = board(7, ['art_c003'].concat(new Array(6).fill('art_c002c')), ['dian_zhen']);
  bus.play(0, 'art_c003', 'dian_zhen');
  for (let n = 0; n < 6; n += 1) bus.play(0, 'art_c002c', 'dian_zhen');
  const host = bus.units(0)[0];
  assert.equal(host.attachments.filter(id => id === 'art_c002c').length, 6);
  assert.equal(bus.profile(0, host).attack, 1);
  host.attachment_meta.forEach(meta => { meta.ready = true; });
  assert.equal(bus.profile(0, host).attack, 13);
  bus.spawn(1, 'xiao_yin', null, null, false);
  bus.seat = 1;
  bus.attack(1, 'xiao_yin', host.attachment_meta[3].iid);
  assert.equal(host.attachment_meta[3].severed, true);
  assert.equal(bus.profile(0, host).attack, 5);
});

check('same-series neighbors add one each and leave when the row dies', () => {
  const game = board(0, [], []);
  const left = game.spawn(0, 'art_h024', null, null, false);
  const right = game.spawn(0, 'art_h022', null, null, false);
  assert.equal(left.durability, game.cards.art_h024.durability + 1);
  assert.equal(right.durability, game.cards.art_h022.durability + 1);
  const leftProfile = game.profile(0, left);
  assert.equal(leftProfile.attack, game.cards.art_h024.attack + 1);
  assert.ok(leftProfile.parts.some(part => part[0] === '右邻同系' && part[1] === 1 && part[2] === 1));
  assert.equal(JSON.stringify(leftProfile.parts).includes('最左主控'), false);
  const rightProfile = game.profile(0, right);
  assert.ok(rightProfile.parts.some(part => part[0] === '左邻同系'));
  const third = game.spawn(0, 'art_h023', null, null, false);
  assert.equal(right.line_durability, 2);
  assert.equal(right.durability, game.cards.art_h022.durability + 2);
  const mid = game.profile(0, right);
  assert.ok(mid.parts.some(part => part[0] === '左邻同系'));
  assert.ok(mid.parts.some(part => part[0] === '右邻同系'));
  [left, right, third].forEach(unit => { unit.durability = 0; });
  game.check_deaths();
  assert.deepEqual(game.units(0), []);
});

check('the opponent plays a main before an attachment', () => {
  const game = board(4, [], ['art_h024']);
  const host = game.units(0)[0];
  game.boards[1] = game.boards[0];
  game.boards[0] = [];
  game.hands[1] = ['art_a001', 'xiao_yin'];
  game.seat = 1;
  const choice = C.planAi(C.aiView(game), new Set());
  assert.equal(choice.type, 'play');
  assert.equal(choice.card, 'xiao_yin');
  game.hands[1] = ['art_a001'];
  const attached = C.planAi(C.aiView(game), new Set());
  assert.equal(attached.type, 'play');
  assert.equal(attached.card, 'art_a001');
  assert.equal(attached.target, host.iid);
});

console.log('PASS mount', passed);
