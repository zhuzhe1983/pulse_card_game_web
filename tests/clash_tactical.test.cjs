'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../src/clash/engine.js');
const read = name => JSON.parse(fs.readFileSync(path.join(__dirname, '../content/clash', name)));
const baseline = read('clash_playtest.json'), caps = read('capabilities.json');
const balance = read('clash_balance.json'), tactics = read('clash_tactics.json');
const cards = C.loadPack(baseline, caps).cards;
for (const card of read('clash_roster_96.json').cards.concat(tactics.cards)) cards[card.template_id] = { ...card };
for (const [id, patch] of Object.entries(balance.card_overrides)) Object.assign(cards[id], patch);
function setup() { const g = C.Game.empty(cards, balance.rules, caps); g.supply = [10, 10]; g.max_supply = [10, 10]; g.decks = [['art_h024','dian_zhen','xiao_yin'],['art_h024','dian_zhen','xiao_yin']]; return g; }
function cast(g, id, target = null) { g.hands[g.seat].push(id); g.play(g.seat, id, target); }
function rejects(g, id, target, code) {
  g.hands[g.seat].push(id);
  const before = JSON.stringify(g);
  assert.throws(() => g.play(g.seat, id, target), e => e.code === code);
  assert.equal(JSON.stringify(g), before, 'rejection must be atomic');
}
let checks = 0;
function check(name, fn) { fn(); checks++; console.log('ok', name); }
check('profile is explicit, all 12 tactical spells use supported effects', () => {
  assert.equal(balance.rules.baseLife, 30); assert.equal(balance.rules.boardLimit, 7);
  assert.equal(tactics.cards.length, 12);
  tactics.cards.forEach(card => assert.ok(C.IMPLEMENTED_EFFECTS.includes(card.effect), card.effect));
});
check('damage kills a target without retaliating; own targets reject', () => {
  const g = setup(), foe = g.spawn(1, 'art_h028');
  cast(g, 'pulse_bolt', foe.iid); assert.equal(g.units(1).length, 0); assert.equal(g.bases[0], 30);
  const ally = g.spawn(0, 'xiao_yin'); rejects(g, 'pulse_bolt', ally.iid, 'bad_target');
});
check('area damage hits enemy simultaneously, preserves friendly units and grave order', () => {
  const g = setup(), ally = g.spawn(0, 'xiao_yin');
  const first = g.spawn(1, 'art_h028'), second = g.spawn(1, 'art_h039b');
  first.attachments.push('lian_jie');
  cast(g, 'arc_wave');
  assert.equal(g.units(1).length, 0); assert.equal(g.units(0)[0], ally);
  assert.deepEqual(g.graves[1], ['lian_jie', 'art_h028', 'art_h039b']);
});
check('freeze lasts through exactly the next owner turn, draws, and does not stack', () => {
  const g = setup(), foe = g.spawn(1, 'art_h028');
  cast(g, 'emergency_stop', foe.iid); assert.equal(g.hands[0].at(-1), 'art_h024');
  rejects(g, 'emergency_stop', foe.iid, 'frozen');
  C.finishTurn(g); assert.throws(() => g.attack(1, foe.iid, 'base'), e => e.code === 'frozen');
  C.finishTurn(g); assert.equal(foe.frozen, false); C.finishTurn(g);
  g.attack(1, foe.iid, 'base'); assert.equal(g.bases[0], 27);
});
check('bounce clears attachments and buffs; full hand burns the returned unit', () => {
  const g = setup(), foe = g.spawn(1, 'art_h028');
  foe.attachments.push('lian_jie'); foe.temp_attack = 3; foe.durability = 1;
  cast(g, 'factory_reset', foe.iid); assert.deepEqual(g.hands[1], ['art_h028']); assert.deepEqual(g.graves[1], ['lian_jie']);
  const next = g.spawn(1, 'art_h024'); g.hands[1] = Array(10).fill('xiao_yin');
  cast(g, 'factory_reset', next.iid); assert.equal(g.hands[1].length, 10); assert.equal(g.graves[1].at(-1), 'art_h024');
});
check('execute checks current attack; overclock is temporary and cannot grant an attack', () => {
  const g = setup(), low = g.spawn(1, 'art_h028');
  rejects(g, 'safe_shutdown', low.iid, 'attack_too_low'); low.temp_attack = 2;
  cast(g, 'safe_shutdown', low.iid); assert.equal(g.units(1).length, 0);
  const ally = g.spawn(0, 'xiao_yin', 0, null, true);
  cast(g, 'overclock', ally.iid); assert.equal(g.profile(0, ally, false).attack, 5);
  assert.throws(() => g.attack(0, ally.iid, 'base'), e => e.code === 'summoning_sickness');
  C.finishTurn(g); assert.equal(ally.temp_attack, 0);
});
check('repair caps at 30; draw-two stops at fatigue lethal', () => {
  const g = setup(); g.bases[0] = 28; cast(g, 'repair_protocol'); assert.equal(g.bases[0], 30); assert.equal(g.hands[0].length, 1);
  g.hands[0] = []; g.decks[0] = []; g.bases[0] = 1; cast(g, 'cache_read');
  assert.equal(g.winner, 1); assert.equal(g.fatigue[0], 1);
});
check('board cap rejects deployment, support and seize before costs or hand change', () => {
  const g = setup(); for (let i = 0; i < 7; i++) g.spawn(0, 'xiao_yin');
  rejects(g, 'art_h024', null, 'board_full'); const foe = g.spawn(1, 'art_h028');
  rejects(g, 'burner_seize', foe.iid, 'board_full'); g.graves[0].push('hou_ke');
  const before = JSON.stringify(g); assert.throws(() => g.support(0), e => e.code === 'board_full'); assert.equal(JSON.stringify(g), before);
});
check('adjacency only grants one durability, never attack, and vanishes with neighbors', () => {
  const g = setup(), units = [0,1,2].map(() => g.spawn(0, 'art_h028'));
  assert.equal(g.profile(0, units[1], false).attack, 3); assert.equal(units[1].durability, 3);
  units[0].durability = 0; units[2].durability = 0; g.check_deaths();
  assert.equal(g.units(0).length, 1); assert.equal(units[1].durability, 2);
});
check('a full board can promote in place, and attachments retire exactly once', () => {
  const g = setup(), stamp = g.spawn(0, 'xiao_yin');
  stamp.attachments.push('lian_jie');
  for (let i = 0; i < 6; i++) g.spawn(0, 'art_h024');
  g.hands[0] = ['art_h038a'];
  g.promote(0, 'xiao_yin');
  assert.equal(g.units(0).length, 7);
  assert.equal(g.units(0)[0].card_id, 'art_h038a');
  assert.equal(g.units(0)[0].sick, true);
  assert.deepEqual(g.graves[0], ['lian_jie', 'xiao_yin']);
});
check('AI uses spells, makes favorable trades, and does not access either deck', () => {
  const g = setup(); g.seat = 1; g.spawn(0, 'art_h028'); g.hands[1] = ['pulse_bolt'];
  Object.defineProperty(g, 'decks', { get() { throw Error('private deck accessed'); } });
  const a = C.planAi(C.aiView(g), new Set()); assert.equal(a.card, 'pulse_bolt');
  C.applyAi(g, a); assert.equal(g.units(0).length, 0);
  g.hands[1] = []; const ally = g.spawn(1, 'art_h015'); const foe = g.spawn(0, 'xiao_yin');
  const trade = C.planAi(C.aiView(g), new Set()); assert.equal(trade.target, foe.iid); assert.equal(trade.iid, ally.iid);
});
console.log(`PASS tactical ${checks} groups`);
