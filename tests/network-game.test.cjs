'use strict';
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/engine.js');
require('../src/content.js');
require('../src/rtc.js');
const realRtc = globalThis.PCGRtc;
const packets = [];
const peers = new Map();
let serial = 0;
class FakePeer {
  constructor(callbacks) { this.cb = callbacks; this.role = null; this.isOpen = false; this.other = null; this.closed = false; this.id = String(++serial); peers.set(this.id, this); }
  async createOffer() { this.role = 'host'; return 'offer:' + this.id; }
  async acceptOffer(code) { this.role = 'guest'; this.other = peers.get(code.split(':')[1]); this.other.other = this; return 'answer:' + this.id; }
  async acceptAnswer(code) { assert.equal(this.other.id, code.split(':')[1]); this.isOpen = this.other.isOpen = true; this.cb.onOpen(); this.other.cb.onOpen(); }
  send(packet) {
    assert.ok(this.isOpen, 'transport must be open');
    realRtc.validateEnvelope(packet);
    const copy = JSON.parse(JSON.stringify(packet)); packets.push({ sender: this, packet: copy });
    queueMicrotask(() => { if (this.other && !this.other.closed) this.other.cb.onMessage(copy); }); return true;
  }
  close() { if (this.closed) return; this.closed = true; this.isOpen = false; this.cb.onState({ state: 'closed', role: this.role }); }
}
globalThis.PCGRtc = { ...realRtc, PeerSession: FakePeer };
require('../src/network-game.js');
const N = globalThis.PCGNet;
const clone = v => JSON.parse(JSON.stringify(v));
const pack = globalThis.PCGContent.pack;
const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
const local = seat => ({ player_id: ids[seat], name: seat ? '客机' : '房主', skin: seat ? '02' : '01', deck: pack.starter_deck.slice() });
const tick = () => new Promise(resolve => setImmediate(resolve));
async function pair({ hostPack = pack, guestPack = pack, guestLocal = local(1) } = {}) {
  const log = { host: [], guest: [], hostErrors: [], guestErrors: [] };
  const host = new N.GameSession({ pack: hostPack, local: local(0), onUpdate: v => log.host.push(v), onError: e => log.hostErrors.push(e), iceServers: [] });
  const guest = new N.GameSession({ pack: guestPack, local: guestLocal, onUpdate: v => log.guest.push(v), onError: e => log.guestErrors.push(e), iceServers: [] });
  await host.acceptAnswer(await guest.acceptOffer(await host.createOffer())); await tick();
  return { host, guest, log, close() { host.close(); guest.close(); } };
}
function pass(game, actionId = E.newActionId()) {
  return { match_id: game.view.match_id, action_id: actionId, expected_revision: game.view.revision, kind: 'pass', card_instance_id: null, row: null, target_instance_id: null };
}

test('handshake starts one shared match while keeping host hand out of guest packets', async () => {
  const { host, guest, log, close } = await pair();
  assert.equal(host.role, 'host'); assert.equal(guest.role, 'guest');
  assert.equal(host.seat, 0); assert.equal(guest.seat, 1);
  assert.equal(host.view.match_id, guest.view.match_id); assert.equal(host.view.revision, 0);
  assert.equal(host.view.players[0].hand.length, 10); assert.equal(host.view.players[1].hand, undefined);
  assert.equal(guest.view.players[1].hand.length, 10); assert.equal(guest.view.players[0].hand, undefined);
  const hello = packets.find(x => x.sender === host.peer && x.packet.type === 'HELLO').packet;
  assert.equal(hello.deck, undefined);
  assert.deepEqual(guest.identities.map(p => p.player_id), ids);
  assert.deepEqual(log.hostErrors, []); assert.deepEqual(log.guestErrors, []);
  close();
});

test('different content and duplicate player identity reject before any match', async () => {
  const other = clone(pack); other.cards[0].base_power += 1;
  const mismatch = await pair({ guestPack: other });
  assert.equal(mismatch.host.view, null); assert.equal(mismatch.guest.view, null);
  assert.ok(mismatch.log.hostErrors.concat(mismatch.log.guestErrors).some(e => e.code === 'CONTENT_MISMATCH')); mismatch.close();
  const same = await pair({ guestLocal: { ...local(1), player_id: ids[0] } });
  assert.equal(same.host.view, null);
  assert.ok(same.log.hostErrors.concat(same.log.guestErrors).some(e => e.code === 'SAME_PLAYER')); same.close();
});

test('host and guest actions converge, duplicate IDs do not execute twice, conflict is rejected', async () => {
  const game = await pair(); const { host, guest, log } = game;
  const actor = host.view.turn_player === 0 ? host : guest;
  const command = E.legalCommands(pack, actor.view, actor.seat, 'same-command')[1];
  actor.sendAction(command); await tick();
  assert.equal(host.view.revision, 1); assert.equal(guest.view.revision, 1);
  assert.deepEqual(host.view.scores, guest.view.scores);
  const stateHash = E.digest(host._authority.state);
  actor.sendAction(command); await tick();
  assert.equal(E.digest(host._authority.state), stateHash); assert.equal(guest.view.revision, 1);
  assert.deepEqual(log.guest.at(-1).events, []);
  actor.sendAction({ ...command, kind: 'pass', card_instance_id: null, row: null, target_instance_id: null }); await tick();
  assert.equal(host.view.revision, 1);
  assert.equal(log.guest.at(-1).result.error_code, 'ACTION_ID_CONFLICT');
  assert.equal(guest.pendingActionId, null);
  assert.deepEqual(log.hostErrors, []); assert.deepEqual(log.guestErrors, []);
  game.close();
});

test('a complete three-round duel converges and resync does not replay animations', async () => {
  const { host, guest, log, close } = await pair();
  for (let i = 0; i < 40 && host.view.phase === 'playing'; i++) {
    const actor = host.view.turn_player === 0 ? host : guest;
    const command = E.chooseAction(pack, actor.view, actor.seat, 'turn-' + i);
    actor.sendAction(command); await tick();
    assert.equal(host.view.revision, guest.view.revision);
    assert.deepEqual(host.view.round_results, guest.view.round_results);
    assert.deepEqual(log.hostErrors, []); assert.deepEqual(log.guestErrors, []);
  }
  assert.equal(host.view.phase, 'finished'); assert.equal(guest.view.phase, 'finished'); assert.equal(host.view.winner, guest.view.winner);
  guest.requestResync(); await tick(); assert.deepEqual(log.guest.at(-1).events, []); assert.equal(log.guest.at(-1).result, null);
  close();
});

test('stale and wrong-turn actions are rejected by the host with state preserved', async () => {
  const { host, guest, log, close } = await pair();
  const wrong = host.view.turn_player === 0 ? guest : host;
  wrong.sendAction(pass(wrong, 'wrong-turn')); await tick();
  assert.equal(host.view.revision, 0); assert.equal(log.guest.at(-1).result.error_code, 'NOT_YOUR_TURN');
  const right = host.view.turn_player === 0 ? host : guest;
  right.sendAction(pass(right, 'correct')); await tick();
  const stale = { ...pass(guest, 'stale'), expected_revision: 0 };
  guest.sendAction(stale); await tick();
  assert.equal(host.view.revision, 1); assert.equal(log.guest.at(-1).result.error_code, 'STALE_REVISION'); close();
});

test('guest cannot submit a chosen actor or an authoritative view', async () => {
  const first = await pair();
  first.guest.peer.send(realRtc.makeEnvelope('ACTION', { actor: 0, command: pass(first.guest) })); await tick();
  assert.ok(first.log.hostErrors.some(e => e.code === 'MESSAGE_FIELDS')); assert.equal(first.host.view.revision, 0); first.close();
  const second = await pair();
  const fake = clone(second.guest.view);
  second.guest.peer.send(realRtc.makeEnvelope('VIEW', { view: fake, view_hash: E.digest(fake), events: [], result: null })); await tick();
  assert.ok(second.log.hostErrors.some(e => e.code === 'VIEW_STATE')); second.close();
});

test('guest rejects a view that leaks the hidden hand even with a valid digest', async () => {
  const { host, guest, log, close } = await pair();
  const bad = clone(guest.view); bad.players[0].hand = clone(host.view.players[0].hand);
  host.peer.send(realRtc.makeEnvelope('VIEW', { view: bad, view_hash: E.digest(bad), events: [], result: null })); await tick();
  assert.ok(log.guestErrors.some(e => e.code === 'VIEW_PRIVATE_HAND')); assert.equal(guest.view.players[0].hand, undefined); close();
});

test('guest rejects unknown cards, invalid counts and mismatched digest', async () => {
  for (const [mutate, code] of [
    [v => { v.players[1].hand[0].template_id = 'unknown_card'; }, 'VIEW_CARD'],
    [v => { v.players[0].hand_count = 9; }, 'VIEW_CARD_COUNT'],
    [v => { v.scores = [99, 99]; }, 'VIEW_SCORES']
  ]) {
    const game = await pair(); const bad = clone(game.guest.view); mutate(bad);
    game.host.peer.send(realRtc.makeEnvelope('VIEW', { view: bad, view_hash: E.digest(bad), events: [], result: null })); await tick();
    assert.ok(game.log.guestErrors.some(e => e.code === code), code); game.close();
  }
  const game = await pair(); game.host.peer.send(realRtc.makeEnvelope('VIEW', { view: game.guest.view, view_hash: '0'.repeat(64), events: [], result: null })); await tick();
  assert.ok(game.log.guestErrors.some(e => e.code === 'VIEW_HASH')); game.close();
});

test('local invalid identities and decks fail before opening a connection', () => {
  assert.throws(() => new N.GameSession({ pack, local: { ...local(0), name: 'x'.repeat(25) } }), e => e.code === 'PLAYER_IDENTITY');
  assert.throws(() => new N.GameSession({ pack, local: { ...local(0), player_id: 'not-a-uuid' } }), e => e.code === 'PLAYER_IDENTITY');
  assert.throws(() => new N.GameSession({ pack, local: { ...local(0), deck: Array(10).fill('core_vanguard') } }), e => e.code === 'DECK_INVALID');
});

test('identity names count Unicode code points and reject unpaired surrogates', () => {
  const make = name => new N.GameSession({ pack, local: { ...local(0), name } });
  const mixed = make('a'.repeat(23) + '😀');
  assert.equal(mixed.local.name, 'a'.repeat(23) + '😀'); mixed.close();
  const emoji = make('😀'.repeat(24)); assert.equal(Array.from(emoji.local.name).length, 24); emoji.close();
  assert.throws(() => make('a'.repeat(24) + '😀'), e => e.code === 'PLAYER_IDENTITY');
  assert.throws(() => make('a'.repeat(23) + '\ud83d'), e => e.code === 'JSON_INVALID_UNICODE');
  assert.throws(() => make('\ude00'), e => e.code === 'JSON_INVALID_UNICODE');
});
