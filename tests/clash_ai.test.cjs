'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../src/clash/engine.js');

const root = path.resolve(__dirname, '..');
const read = name => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));

function setup() {
  const data = read('content/clash/clash_playtest.json');
  const loaded = C.loadPack(data, read('content/clash/capabilities.json'));
  const roster = read('content/clash/clash_roster_96.json');
  loaded.cards.art_h024 = roster.cards.find(card => card.template_id === 'art_h024');
  return { data, ...loaded };
}

function started() {
  const { data, rules, cards, tokenId, capabilities } = setup();
  const game = new C.Game(cards, data.decks.first, data.decks.second, rules, tokenId, capabilities);
  game.start_turn();
  return game;
}

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log('ok', name);
}

check('planner only sees the opponent public view', () => {
  const game = started();
  C.finishTurn(game);
  const secret = game.hands[0].slice();
  const deck = game.decks[0].slice();
  let peekedHand = false;
  let peekedDeck = false;
  const hands = game.hands;
  const decks = game.decks;
  game.hands = new Proxy(hands, {
    get(target, prop, receiver) {
      if (prop === '0' || prop === 0) peekedHand = true;
      return Reflect.get(target, prop, receiver);
    }
  });
  game.decks = new Proxy(decks, {
    get(target, prop, receiver) {
      if (prop === '0' || prop === 0 || prop === '1' || prop === 1) peekedDeck = true;
      return Reflect.get(target, prop, receiver);
    }
  });
  const view = C.aiView(game);
  assert.deepEqual(view.hand.map(card => card.id), hands[1].slice());
  C.planAi(view, new Set());
  assert.equal(peekedHand, false);
  assert.equal(peekedDeck, false);
  game.hands = hands;
  game.decks = decks;
  assert.deepEqual(game.hands[0], secret);
  assert.deepEqual(game.decks[0], deck);
});

check('a bounded opponent turn does not play the player hand', () => {
  const game = started();
  const before = game.hands[0].slice();
  C.finishTurn(game);
  const done = C.runAiTurn(game);
  assert.ok(done.length <= 16);
  assert.equal(game.seat, 0);
  assert.deepEqual(game.hands[0].slice(0, before.length), before);
  assert.equal(game.hands[0].length, before.length + 1);
});

check('probe rejects a sick attack without changing the board', () => {
  const game = started();
  const card = game.hands[0].find(id => id === 'xiao_yin');
  game.play(0, card, null, null, 0);
  const before = JSON.stringify(game.view());
  const result = C.probe(game, () => game.attack(0, game.boards[0][0].iid, 'base'));
  assert.equal(result.ok, false);
  assert.equal(result.code, 'summoning_sickness');
  assert.equal(C.reasonText(result.code), '刚上场，本回合不能攻击');
  assert.equal(JSON.stringify(game.view()), before);
});

check('the five refusal sentences stay distinct', () => {
  const texts = ['summoning_sickness', 'already_attacked', 'not_enough_supply', 'guard_blocks', 'bad_target'].map(C.reasonText);
  assert.equal(new Set(texts).size, 5);
  assert.equal(texts.includes('本回合这个技能已经用过'), false);
});

console.log('PASS', passed, 'ai');
