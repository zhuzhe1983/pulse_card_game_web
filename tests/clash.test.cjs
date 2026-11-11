'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const C = require('../src/clash/engine.js');

const root = path.resolve(__dirname, '..');
const read = name => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const payload = () => read('content/clash/clash_playtest.json');
const lesson = () => read('content/clash/clash_v0_lesson.json');
const capabilities = () => read('content/clash/capabilities.json');
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex');

function setup(data = payload()) {
  const loaded = C.loadPack(data, capabilities());
  const roster = read('content/clash/clash_roster_96.json');
  loaded.cards.art_h024 = roster.cards.find(card => card.template_id === 'art_h024');
  return { data, ...loaded };
}

function newGame() {
  const { data, rules, cards, tokenId, capabilities: caps } = setup();
  return new C.Game(cards, data.decks.first, data.decks.second, rules, tokenId, caps);
}

function empty() {
  const { rules, cards, capabilities: caps } = setup();
  return C.Game.empty(cards, rules, caps);
}

function fingerprint(game) {
  return JSON.stringify({
    view: game.view(),
    fatigue: game.fatigue,
    decks: game.decks,
    attacked: game.boards.map(row => row.map(unit => unit && unit.attacked)),
    temp: game.boards.map(row => row.map(unit => unit && unit.temp_attack)),
    ability: game.ability_used,
    next: game._nextId,
    turns: game.turns_started
  });
}

function rejects(code, fn) {
  assert.throws(fn, error => error instanceof C.ClashError && error.code === code);
}

function unchanged(game, fn, code) {
  const before = fingerprint(game);
  rejects(code, fn);
  assert.equal(fingerprint(game), before);
}

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log('ok', name);
}

check('content is the handoff bytes and not the old ruleset', () => {
  const source = read('content/clash/SOURCE.json');
  assert.equal(source.prompt_commit, C.SOURCE_COMMIT);
  assert.equal(source.ruleset_id, 'pcg.clash.v0');
  assert.equal(sha('content/clash/clash_playtest.json'), source.copied_from_handoff['content/clash_playtest.json'].sha256);
  assert.equal(sha('content/clash/clash_v0_lesson.json'), source.copied_from_handoff['fixtures/clash_v0_lesson.json'].sha256);
  assert.equal(sha('content/clash/01_GAMEPLAY.md'), source.copied_from_handoff['docs/01_GAMEPLAY.md'].sha256);
  const data = payload();
  assert.equal(data.ruleset_id, 'pcg.clash.v0');
  assert.equal(data.balance, 'playtest_unverified');
  assert.equal(data.cards.length, 11);
  assert.equal(data.retired[0].replaced_by, 'art_h024');
  assert.equal(data.cards.some(card => card.template_id === 'art_h024'), false);
  assert.equal(C.RULESET, 'pcg.clash.v0');
  const engine = fs.readFileSync(path.join(root, 'src/clash/engine.js'), 'utf8');
  assert.equal(engine.includes('pcg.core.v1'), false);
  assert.equal(engine.includes('series'), false);
  assert.equal(engine.includes('nfc'), false);
  assert.equal(engine.includes('hardware_controller'), false);
});

check('pack keeps role, hardware and art separate', () => {
  const data = payload();
  const byId = Object.fromEntries(data.cards.map(card => [card.template_id, card]));
  assert.equal(byId.xiao_yin.effect, 'support');
  assert.equal(byId.hou_ke.effect, null);
  assert.equal(byId.lian_jie.game_role, 'attachment');
  assert.equal(byId.lian_jie.hardware_controller, 'auxiliary_programmable_mcu');
  assert.equal(byId.lian_jie.art_type, null);
  assert.equal(byId.lian_jie.kind, 'attachment');
  assert.equal(byId.lian_jie.attack_bonus, 1);
  assert.ok(byId.lian_jie.hardware_note.includes('不是无主控'));
  assert.ok(byId.lian_jie.hardware_note.includes('Chain DualKey'));
});

check('series and hardware labels do not change the lesson', () => {
  const data = payload();
  for (const card of data.cards) {
    card.series = 'rewritten-series';
    card.hardware_controller = 'not-a-rules-input';
    card.art_type = 'B';
  }
  const loaded = C.loadPack(data, capabilities());
  const roster = read('content/clash/clash_roster_96.json');
  loaded.cards.art_h024 = roster.cards.find(card => card.template_id === 'art_h024');
  const game = new C.Game(loaded.cards, data.decks.first, data.decks.second, loaded.rules, loaded.tokenId, loaded.capabilities);
  for (const step of lesson().lesson_steps) replayStep(game, step);
  assert.equal(game.bases[0], 18);
  assert.equal(game.bases[1], 20);
  assert.deepEqual(game.units(0).map(unit => unit.card_id), ['art_h024']);
  assert.deepEqual(game.units(1).map(unit => unit.card_id), ['dian_zhen', 'xiao_yin']);
});

function replayStep(game, step) {
  const seat = step.seat == null ? game.seat : step.seat;
  if (step.do === 'start') game.start_turn();
  else if (step.do === 'play') game.play(seat, step.card, step.target, step.mode);
  else if (step.do === 'attack') game.attack(seat, step.attacker, step.target);
  else if (step.do === 'end') game.end_turn(seat);
  else if (step.do === 'support') game.support(seat);
  else if (step.do === 'knob') game.knob(seat, step.host, step.target);
  else throw new Error(step.do);
  if (step.expect) {
    const actual = game.view();
    for (const key of Object.keys(step.expect)) {
      assert.deepEqual(actual[key], step.expect[key], (step.name || step.do) + ' ' + key);
    }
  }
}

check('lesson fixture matches every checkpoint', () => {
  const fixture = lesson();
  const data = payload();
  assert.equal(fixture.ruleset_id, data.ruleset_id);
  for (const key of ['base_life', 'max_supply', 'hand_limit', 'board_limit']) {
    assert.equal(fixture.rules[key], data[key]);
  }
  const game = newGame();
  assert.deepEqual(game.hands[0], ['art_h024', 'xiao_yin', 'bu_ji']);
  assert.deepEqual(game.hands[1].slice(0, 4), ['art_h024', 'hu_zhao', 'xiao_yin', 'gan_rao']);
  assert.ok(game.hands[1].includes('jie_yi_ge_dian'));
  assert.equal(game.decks[0][0], 'dian_zhen');
  for (const step of fixture.lesson_steps) replayStep(game, step);
  assert.deepEqual(game.bases, [18, 20]);
  assert.deepEqual(game.units(0).map(unit => unit.card_id), ['art_h024']);
  assert.deepEqual(game.units(1).map(unit => unit.card_id), ['dian_zhen', 'xiao_yin']);
  assert.equal(game.winner, null);
  assert.ok(game.log.join('\n').includes('同时结算'));
  assert.ok(game.log.join('\n').includes('小印进入座位0墓地'));
});

check('finishTurn is end plus the other side starting, with no gap', () => {
  const game = newGame();
  game.start_turn();
  game.play(0, 'xiao_yin');
  C.finishTurn(game);
  assert.equal(game.seat, 1);
  assert.equal(game.phase, 'main');
  assert.equal(game.supply[0], 0);
  assert.equal(game.max_supply[1], 1);
  assert.equal(game.supply[1], 1);
  assert.equal(game.hands[1].at(-1), 'dian_zhen');
  assert.equal(game.decks[1].length, 3);
});

check('first three turns and the coin above the cap', () => {
  const game = newGame();
  game.start_turn();
  assert.equal(game.decks[0].length, 5);
  assert.deepEqual(game.hands[0], ['art_h024', 'xiao_yin', 'bu_ji']);
  game.play(0, 'xiao_yin');
  game.end_turn(0);
  game.start_turn();
  assert.deepEqual(game.hands[1].slice(-2), ['jie_yi_ge_dian', 'dian_zhen']);
  game.play(1, 'jie_yi_ge_dian');
  assert.equal(game.supply[1], 2);
  assert.equal(game.max_supply[1], 1);
  game.play(1, 'dian_zhen');
  unchanged(game, () => game.attack(1, 'dian_zhen', 'base'), 'summoning_sickness');
  game.end_turn(1);
  assert.equal(game.supply[1], 0);
  game.start_turn();
  game.attack(0, 'xiao_yin', 'dian_zhen');
  assert.deepEqual(game.bases, [20, 20]);
  assert.deepEqual(game.graves[0], ['xiao_yin']);
  assert.equal(game.units(1)[0].durability, 1);
  game.end_turn(0);
  game.start_turn();
  game.attack(1, 'dian_zhen', 'base');
  assert.deepEqual(game.bases, [18, 20]);
  game.play(1, 'xiao_yin');
  unchanged(game, () => game.attack(1, 'xiao_yin', 'base'), 'summoning_sickness');
  game.end_turn(1);
  game.start_turn();
  game.play(0, 'art_h024');
  assert.equal(game.units(0)[0].card_id, 'art_h024');
  assert.equal(game.units(0)[0].sick, true);
  assert.deepEqual(game.units(1).map(unit => unit.card_id), ['dian_zhen', 'xiao_yin']);
  assert.equal(game.winner, null);
});

check('support while the stamp is already on board', () => {
  const game = empty();
  game.supply = [6, 6];
  game.max_supply = [6, 6];
  game.bases = [16, 18];
  game.hands = [['bu_ji', 'gan_rao'], []];
  game.graves = [['hou_ke'], []];
  game.spawn(0, 'xiao_yin', 0, null, false);
  game.spawn(1, 'dian_zhen', 0);
  game.support(0);
  assert.equal(game.supply[0], 5);
  assert.deepEqual(game.graves[0], []);
  assert.deepEqual(game.units(0).map(unit => unit.card_id), ['hou_ke', 'xiao_yin']);
  const shell = game.units(0).find(unit => unit.card_id === 'hou_ke');
  const stamp = game.units(0).find(unit => unit.card_id === 'xiao_yin');
  assert.equal(shell.durability, 7);
  assert.equal(shell.sick, true);
  assert.equal(shell.slot, 0);
  assert.equal(stamp.slot, 1);
  assert.equal(stamp.sick, false);
  assert.equal(C.hasGuard(game.cards, shell), true);
  assert.deepEqual(shell.attachments, []);
  unchanged(game, () => game.support(0), 'already_used_ability');
  unchanged(game, () => game.attack(0, 'hou_ke', 'dian_zhen'), 'summoning_sickness');
  unchanged(game, () => game.attack(0, 'xiao_yin', 'base'), 'guard_blocks');
  game.play(0, 'bu_ji', 'hou_ke', 'heal');
  assert.equal(shell.durability, 7);
  assert.equal(game.supply[0], 4);
  game.play(0, 'gan_rao', 'dian_zhen');
  assert.equal(game.units(1)[0].durability, 1);
  assert.equal(game.supply[0], 2);
  assert.deepEqual(game.units(0).map(unit => unit.card_id), ['hou_ke', 'xiao_yin']);
});

check('support after deploying the stamp, and again after the shell dies', () => {
  const later = empty();
  later.supply = [6, 6];
  later.max_supply = [6, 6];
  later.hands = [['xiao_yin'], []];
  later.graves = [['hou_ke'], []];
  unchanged(later, () => later.support(0), 'no_stamp_on_board');
  later.play(0, 'xiao_yin');
  assert.equal(later.supply[0], 5);
  assert.equal(later.units(0)[0].sick, true);
  later.support(0);
  assert.equal(later.supply[0], 4);
  const shell = later.units(0).find(unit => unit.card_id === 'hou_ke');
  assert.equal(shell.durability, 7);
  assert.equal(shell.sick, true);
  unchanged(later, () => later.attack(0, 'hou_ke', 'base'), 'summoning_sickness');
  unchanged(later, () => later.attack(0, 'xiao_yin', 'base'), 'summoning_sickness');

  const stayed = empty();
  stayed.supply = [4, 4];
  stayed.max_supply = [4, 4];
  stayed.hands = [[], ['gan_rao']];
  stayed.spawn(0, 'hou_ke', 0, 2);
  stayed.spawn(0, 'xiao_yin', 1, null, false);
  stayed.seat = 1;
  stayed.phase = 'main';
  stayed.play(1, 'gan_rao', 'hou_ke');
  assert.deepEqual(stayed.units(0).map(unit => unit.card_id), ['xiao_yin']);
  assert.deepEqual(stayed.graves[0], ['hou_ke']);
  assert.equal(stayed.boards[0][0].card_id, 'xiao_yin');
  stayed.end_turn(1);
  stayed.seat = 0;
  stayed.phase = 'main';
  stayed.supply[0] = 4;
  stayed.support(0);
  const revived = stayed.units(0).find(unit => unit.card_id === 'hou_ke');
  assert.deepEqual(stayed.units(0).map(unit => unit.card_id), ['hou_ke', 'xiao_yin']);
  assert.equal(revived.slot, 0);
  assert.equal(revived.durability, 7);
  assert.equal(revived.sick, true);
  assert.equal(stayed.supply[0], 3);
  assert.equal(stayed.boards[0][1].card_id, 'xiao_yin');
});

check('used support reports already used even when supply is also empty', () => {
  const game = empty();
  game.supply = [1, 0];
  game.hands = [[], []];
  game.graves = [['hou_ke'], []];
  game.spawn(0, 'xiao_yin', 0, null, false);
  game.support(0);
  assert.equal(game.supply[0], 0);
  unchanged(game, () => game.support(0), 'already_used_ability');
  const poor = empty();
  poor.supply = [0, 0];
  poor.graves = [['hou_ke'], []];
  poor.spawn(0, 'xiao_yin', 0, null, false);
  unchanged(poor, () => poor.support(0), 'not_enough_supply');
});

check('full board, attachments, guard bypass, mend and burn', () => {
  const full = empty();
  full.supply = [8, 5];
  full.max_supply = [8, 5];
  ['xiao_yin', 'dian_zhen', 'xuan_niu', 'qiao_jian', 'art_h024'].forEach((cardId, slot) => {
    full.spawn(0, cardId, slot, null, false);
  });
  full.hands[0] = ['art_h024', 'art_h024'];
  full.play(0, 'art_h024');
  assert.equal(full.boards[0].length, 6);
  assert.equal(full.boards[0][5].card_id, 'art_h024');
  const shifted = full.boards[0][0].iid;
  full.graves[0] = ['hou_ke'];
  full.support(0);
  assert.equal(full.boards[0][0].card_id, 'hou_ke');
  assert.equal(full.boards[0].length, 7);
  assert.equal(full.boards[0][1].iid, shifted);
  assert.equal(full.boards[0][1].card_id, 'xiao_yin');
  full.spawn(1, 'art_h024', 0, 5, false);
  full.spawn(1, 'art_h024', 1, 5, false);
  const foe = full.boards[1][1];
  const attacker = full.boards[0][6];
  attacker.sick = false;
  full.attack(0, attacker.iid, foe.iid);
  assert.equal(foe.durability, 2);
  assert.equal(full.boards[1][0].durability, 5);
  const queued = JSON.stringify(full.view());
  unchanged(full, () => full.play(0, 'art_h024', null, null, 99), 'bad_index');
  assert.equal(JSON.stringify(full.view()), queued);

  const guard = empty();
  guard.supply = [4, 2];
  guard.hands = [['hu_zhao', 'qian_li'], []];
  guard.spawn(0, 'dian_zhen', 0);
  unchanged(guard, () => guard.play(0, 'hu_zhao', 'dian_zhen'), 'already_has_guard');
  guard.play(0, 'qian_li', 'dian_zhen');
  guard.spawn(1, 'hou_ke', 0);
  const host = guard.units(0)[0];
  host.sick = false;
  guard.attack(0, 'dian_zhen', 'base');
  assert.equal(guard.bases[1], 18);

  const mend = empty();
  mend.supply = [1, 1];
  mend.hands = [['bu_ji'], []];
  const unit = mend.spawn(0, 'xiao_yin', 0, 1);
  mend.play(0, 'bu_ji', 'xiao_yin', 'heal');
  assert.equal(unit.durability, 2);
  mend.hands[0] = ['bu_ji'];
  mend.supply[0] = 1;
  mend.play(0, 'bu_ji', 'xiao_yin', 'temp');
  assert.equal(unit.temp_attack, 1);
  assert.equal(C.attackOf(mend.cards, unit), 2);
  mend.end_turn(0);
  assert.equal(unit.temp_attack, 0);

  const burn = empty();
  burn.decks[0] = ['art_h024'];
  burn.hands[0] = Array(8).fill('bu_ji');
  burn.draw(0);
  assert.deepEqual(burn.graves[0], ['art_h024']);
  assert.equal(burn.hands[0].length, 8);
  assert.equal(burn.boards[0].every(slot => slot == null), true);

  const link = empty();
  link.supply = [1, 1];
  link.hands = [['lian_jie'], []];
  const linked = link.spawn(0, 'xiao_yin', 0, null, false);
  link.play(0, 'lian_jie', 'xiao_yin');
  assert.deepEqual(linked.attachments, ['lian_jie']);
  link.spawn(1, 'qiao_jian', 0, 3, false);
  link.attack(0, 'xiao_yin', 'qiao_jian');
  assert.deepEqual(link.graves[0], ['lian_jie', 'xiao_yin']);
  assert.deepEqual(link.graves[1], ['qiao_jian']);
  assert.deepEqual(link.units(0), []);
  const deathLog = link.log.join('\n');
  assert.ok(deathLog.indexOf('链节随宿主进入墓地') < deathLog.indexOf('小印进入座位0墓地'));
  assert.ok(deathLog.indexOf('小印进入座位0墓地') < deathLog.indexOf('敲键进入座位1墓地'));
});

check('illegal plays do not spend, and game over locks the table', () => {
  const game = empty();
  game.supply = [1, 1];
  game.max_supply = [1, 1];
  game.hands = [['lian_jie', 'hu_zhao', 'xuan_niu'], []];
  game.spawn(0, 'xiao_yin', 0, null, false);
  game.spawn(1, 'art_h024', 0, null, false);
  unchanged(game, () => game.play(0, 'lian_jie', 'art_h024'), 'bad_target');
  unchanged(game, () => game.play(1, 'lian_jie', 'xiao_yin'), 'not_your_turn');
  game.play(0, 'lian_jie', 'xiao_yin');
  assert.equal(game.supply[0], 0);
  game.supply[0] = 1;
  unchanged(game, () => game.play(0, 'hu_zhao', 'xiao_yin'), 'already_has_attachment');

  const knob = empty();
  knob.supply = [9, 0];
  knob.max_supply = [9, 0];
  knob.hands = [['xuan_niu'], []];
  knob.play(0, 'xuan_niu');
  assert.equal(knob.units(0)[0].sick, true);
  knob.knob(0, 'xuan_niu', 'xuan_niu');
  assert.equal(knob.view().boards[0][0].attack, 4);
  assert.equal(knob.supply[0], 0);
  unchanged(knob, () => knob.knob(0, 'xuan_niu', 'xuan_niu'), 'already_used_ability');
  const broke = empty();
  broke.supply = [0, 0];
  broke.spawn(0, 'xuan_niu', 0, null, false);
  unchanged(broke, () => broke.knob(0, 'xuan_niu', 'xuan_niu'), 'not_enough_supply');
  unchanged(knob, () => knob.attack(0, 'xuan_niu', 'base'), 'summoning_sickness');
  knob.end_turn(0);
  assert.equal(knob.units(0)[0].temp_attack, 0);
  assert.equal(knob.supply[0], 0);
  knob.start_turn();
  unchanged(knob, () => knob.start_turn(), 'bad_phase');

  const tired = empty();
  tired.bases = [1, 3];
  tired.decks = [[], []];
  tired.phase = 'between';
  tired.turns_started = [1, 0];
  const sickBefore = tired.units(0).map(unit => unit.sick);
  tired.start_turn();
  assert.equal(tired.winner, 1);
  assert.equal(tired.max_supply[0], 0);
  assert.equal(tired.supply[0], 0);
  assert.equal(tired.bases[0], 0);
  assert.deepEqual(tired.units(0).map(unit => unit.sick), sickBefore);
  unchanged(tired, () => tired.play(0, 'art_h024'), 'game_over');
  unchanged(tired, () => tired.attack(0, 'xiao_yin', 'base'), 'game_over');
  unchanged(tired, () => tired.support(0), 'game_over');
  unchanged(tired, () => tired.end_turn(0), 'game_over');
  unchanged(tired, () => tired.knob(0, 'xuan_niu', 'xuan_niu'), 'game_over');

  const soft = empty();
  soft.bases = [5, 20];
  soft.decks = [[], []];
  soft.phase = 'between';
  soft.turns_started = [1, 0];
  soft.start_turn();
  assert.equal(soft.winner, null);
  assert.equal(soft.bases[0], 4);
  assert.equal(soft.fatigue[0], 1);
  assert.equal(soft.max_supply[0], 1);
  assert.equal(soft.supply[0], 1);

  const guards = empty();
  guards.spawn(0, 'qiao_jian', 0, null, false);
  guards.spawn(1, 'dian_zhen', 0, null, false);
  guards.spawn(1, 'hou_ke', 1, null, false);
  guards.spawn(1, 'art_h024', 2, null, false);
  unchanged(guards, () => guards.attack(0, 'qiao_jian', 'art_h024'), 'guard_blocks');
  unchanged(guards, () => guards.attack(0, 'qiao_jian', 'base'), 'guard_blocks');
  guards.attack(0, 'qiao_jian', 'hou_ke');
  assert.equal(guards.units(1).some(unit => unit.card_id === 'hou_ke'), true);
  guards.spawn(0, 'qiao_jian', guards.boards[0].length, null, false);
  guards.attack(0, guards.units(0).find(unit => !unit.attacked).iid, 'dian_zhen');
  assert.deepEqual(guards.graves[1], ['dian_zhen']);
});

check('floors, recharge cap, mend on an enemy, and a drawn game', () => {
  const heal = empty();
  heal.supply = [2, 2];
  heal.bases = [19, 20];
  heal.hands = [['hui_chong'], []];
  heal.play(0, 'hui_chong');
  assert.equal(heal.bases[0], 20);
  assert.deepEqual(heal.graves[0], ['hui_chong']);

  const smack = empty();
  smack.spawn(0, 'qiao_jian', 0, null, false);
  smack.bases[1] = 3;
  smack.attack(0, 'qiao_jian', 'base');
  assert.equal(smack.bases[1], 0);
  assert.equal(smack.winner, 0);
  assert.equal(smack.phase, 'over');

  const zero = empty();
  const cards = zero.cards;
  cards.art_h024 = Object.assign({}, cards.art_h024, { attack: 0 });
  const attacker = zero.spawn(0, 'art_h024', 0, null, false);
  const defender = zero.spawn(1, 'art_h024', 0, null, false);
  zero.attack(0, 'art_h024', 'art_h024');
  assert.equal(attacker.attacked, true);
  assert.equal(attacker.durability, 3);
  assert.equal(defender.durability, 3);

  const mend = empty();
  mend.supply = [1, 0];
  mend.hands = [['bu_ji'], []];
  mend.spawn(0, 'xiao_yin', 0, 1);
  const enemy = mend.spawn(1, 'art_h024', 0);
  unchanged(mend, () => mend.play(0, 'bu_ji', enemy.iid, 'heal'), 'bad_target');

  const drawn = empty();
  drawn.bases = [0, 0];
  drawn.check_bases();
  assert.equal(drawn.winner, 'draw');
  assert.equal(drawn.phase, 'over');
  unchanged(drawn, () => drawn.end_turn(0), 'game_over');
});

check('a newly entered unit may use the knob but may not attack', () => {
  const game = empty();
  game.supply = [9, 0];
  game.hands = [['xuan_niu'], []];
  game.play(0, 'xuan_niu');
  game.knob(0, 'xuan_niu', 'xuan_niu');
  assert.equal(game.view().boards[0][0].attack, 4);
  unchanged(game, () => game.attack(0, 'xuan_niu', 'base'), 'summoning_sickness');
});

check('pack size is data, unknown effects and star ranks stay closed', () => {
  const caps = capabilities();
  assert.deepEqual(caps.effects, C.IMPLEMENTED_EFFECTS);
  assert.deepEqual(caps.not_implemented, []);
  const base = payload();
  const extra = JSON.parse(JSON.stringify(base));
  extra.cards.push(Object.assign({}, extra.cards.find(card => card.template_id === 'gan_rao'), {
    template_id: 'extra_zap',
    name: '额外干扰',
    version: 'v1.3'
  }));
  const loaded = C.loadPack(extra, caps);
  assert.equal(Object.keys(loaded.cards).length, 13);
  assert.equal(C.starOf(loaded.cards.extra_zap), null);
  assert.equal(C.familyOf(loaded.cards.extra_zap), null);
  const game = C.Game.empty(loaded.cards, loaded.rules, loaded.capabilities);
  game.supply = [2, 2];
  game.hands = [['extra_zap'], []];
  game.spawn(1, 'dian_zhen', 0, 2);
  game.play(0, 'extra_zap', 'dian_zhen');
  assert.equal(game.units(1).length, 0);
  assert.deepEqual(game.graves[1], ['dian_zhen']);
  assert.equal(typeof game.promote, 'function');
  assert.equal(typeof game.starUpgrade, 'undefined');

  const marked = JSON.parse(JSON.stringify(base));
  const stamp = marked.cards.find(card => card.template_id === 'xiao_yin');
  stamp.star = 2;
  stamp.family = 'stamp-host';
  stamp.version = 'v1.1';
  const ranked = C.loadPack(marked, caps);
  ranked.cards.art_h024 = read('content/clash/clash_roster_96.json').cards.find(card => card.template_id === 'art_h024');
  assert.equal(C.starOf(ranked.cards.xiao_yin), 2);
  assert.equal(C.familyOf(ranked.cards.xiao_yin), 'stamp-host');
  assert.equal(C.attackOf(ranked.cards, { card_id: 'xiao_yin', attachments: [], temp_attack: 0 }), 1);
  const played = new C.Game(ranked.cards, marked.decks.first, marked.decks.second, ranked.rules, ranked.tokenId, ranked.capabilities);
  played.start_turn();
  for (const step of lesson().lesson_steps.slice(1)) replayStep(played, step);
  assert.deepEqual(played.bases, [18, 20]);

  const invented = JSON.parse(JSON.stringify(base));
  invented.cards[0] = Object.assign({}, invented.cards[0], { effect: 'rush', version: 'v1.2' });
  assert.throws(() => C.loadPack(invented, caps), error => error instanceof C.ClashError && error.code === 'unsupported_effect');
  const widened = JSON.parse(JSON.stringify(caps));
  widened.effects = caps.effects.concat('star_upgrade');
  assert.throws(() => C.loadPack(base, widened), error => error instanceof C.ClashError && error.code === 'unsupported_effect');
  const secondSupport = JSON.parse(JSON.stringify(base));
  secondSupport.cards.push(Object.assign({}, secondSupport.cards.find(card => card.template_id === 'xiao_yin'), {
    template_id: 'another_stamp',
    name: '另一台小印'
  }));
  const loadedSecond = C.loadPack(secondSupport, caps);
  assert.equal(loadedSecond.cards.another_stamp.effect, 'support');
  assert.equal(C.starOf(loadedSecond.cards.another_stamp), null);
  assert.equal(C.starOf({ version: 'v1.3' }), null);
  assert.equal(C.starOf({ star: 2, version: 'v1.1' }), 2);
  assert.equal(C.familyOf({ family: 'stamp-host', series: 'other' }), 'stamp-host');
  const badStar = JSON.parse(JSON.stringify(base));
  badStar.cards[0].star = 'v1.3';
  assert.throws(() => C.loadPack(badStar, caps), error => error instanceof C.ClashError && error.code === 'bad_star');
});

console.log('PASS clash', passed, 'groups');
