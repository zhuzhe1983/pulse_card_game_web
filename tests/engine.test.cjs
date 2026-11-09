'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const E = require('../src/engine.js');
const bundledReference = path.join(__dirname, 'reference');
const source = fs.existsSync(bundledReference) ? bundledReference : path.resolve(__dirname, '../../pulse_source');
const load = name => JSON.parse(fs.readFileSync(path.join(source, name), 'utf8'));
const pack = load('content/core_pack.json'), deck = pack.starter_deck;
let assertions = 0;
const eq = (actual, expected, label) => { assert.deepStrictEqual(actual, expected, label); assertions++; };
const error = (code, fn) => { assert.throws(fn, e => e instanceof E.PCGError && e.code === code); assertions++; };
const newState = (seed = 0) => E.newMatch(pack, 'test_match', ['player_a','player_b'], [deck,deck], seed);
const cmd = (s, actor, index = null, row = null, target = null, id = null) => ({ match_id: s.match_id, action_id: id || 'action_' + s.revision + '_' + actor, expected_revision: s.revision, kind: index === null ? 'pass' : 'play', card_instance_id: index === null ? null : 'p' + actor + ':' + String(index).padStart(2,'0'), row, target_instance_id: target });
const move = (s, actor, index = null, row = null, target = null) => E.applyAction(pack, s, actor, cmd(s,actor,index,row,target)).state;

for (const v of load('fixtures/canonical_vectors.json').valid) {
  eq(E.canonical(v.value), v.canonical_text, 'canonical text');
  eq(Buffer.from(E.canonical(v.value)).toString('hex'), v.canonical_utf8_hex, 'UTF-8 bytes');
  eq(E.digest(v.value), v.sha256, 'canonical hash');
  eq(E.parseCanonical(v.canonical_text), v.value);
}
for (const hex of load('fixtures/canonical_vectors.json').invalid_hex) { assert.throws(() => E.parseCanonical(Buffer.from(hex, 'hex')), E.PCGError); assertions++; }
for (const size of [0,1,55,56,63,64,65,255,1024,65536]) {
  const bytes = Buffer.alloc(size); for (let i = 0; i < size; i++) bytes[i] = (i * 79) & 255;
  eq(E.sha256(bytes), crypto.createHash('sha256').update(bytes).digest('hex'), 'SHA-256 ' + size);
}
eq(E.canonical({'2':'two','10':'ten','1':'one'}), '{"1":"one","10":"ten","2":"two"}');
error('JSON_INTEGER_RANGE', () => E.canonical({x:9007199254740992}));
error('JSON_TYPE', () => E.canonical({x:1.25}));
error('JSON_INVALID_UNICODE', () => E.canonical({x:'\ud800'}));
error('JSON_KEY', () => E.canonical({'中文':1}));
error('JSON_DUPLICATE_KEY', () => E.parseJSON('{"x":1,"x":2}'));
error('JSON_TOO_LARGE', () => E.parseJSON('{}',1));
error('JSON_FLOAT', () => E.parseJSON('{"x":1e0}'));
eq(E.parseJSON('{"__proto__":1}').__proto__, 1);
eq({}.polluted, undefined);
const uid = load('fixtures/draw_vectors.json').uid_vector;
eq(E.heroIdFromUID(uid.technology, uid.uid_hex.toLowerCase()), uid.hero_card_id);

const f = load('fixtures/battle_golden.json');
let s = E.newMatch(pack,f.init.match_id,f.init.player_ids,f.init.decks,f.init.seed_uint32);
eq(E.digest(pack), f.content_hash, 'original pack');
eq(s, f.initial_state, 'golden initial state');
eq(E.digest(s), f.initial_state_hash);
for (const step of f.steps) {
  const before = E.canonical(s), applied = E.applyAction(pack,s,step.actor,step.command);
  eq(E.canonical(s),before,'input immutability'); s = applied.state;
  eq(s,step.expected_state,'golden revision ' + s.revision);
  eq(E.digest(s),step.expected_state_hash);
  eq(applied.events,step.events,'golden events ' + s.revision);
  eq([0,1].map(i => E.digest(E.projectView(s,i))),step.expected_view_hashes,'private view hashes');
}
eq(s.round_results.map(r => r.scores),[[6,8],[8,6],[13,11]]);
eq(s.players.map(p => p.match_points),[4,2]);
eq(s.winner,0);

s = newState(); const before = E.canonical(s);
error('NOT_YOUR_TURN', () => E.applyAction(pack,s,1,cmd(s,1)));
error('STALE_REVISION', () => E.applyAction(pack,s,0,{...cmd(s,0),expected_revision:1}));
error('ILLEGAL_ROW', () => E.applyAction(pack,s,0,cmd(s,0,0,'rear')));
error('NO_TACTIC_TARGET', () => E.applyAction(pack,s,0,cmd(s,0,8)));
error('COMMAND_FIELDS', () => E.applyAction(pack,s,0,{...cmd(s,0),actor:0}));
eq(E.canonical(s),before,'invalid actions are atomic');
eq(newState(1).turn_player,1);
error('DECK_SIZE_OR_DUPLICATE', () => E.newMatch(pack,'m',['a','b'],[deck.slice(1),deck],0));
error('DECK_SIZE_OR_DUPLICATE', () => E.newMatch(pack,'m',['a','b'],[Array(10).fill(deck[0]),deck],0));
error('MATCH_SEED', () => newState(-1));

s = move(newState(),0,1,'front'); s = move(s,1,0,'front');
error('TARGET_REQUIRED_OR_INVALID', () => E.applyAction(pack,s,0,cmd(s,0,5,'rear')));
error('TARGET_REQUIRED_OR_INVALID', () => E.applyAction(pack,s,0,cmd(s,0,5,'rear','p0:05')));
s = move(s,0,3,'rear'); eq(E.boardScores(s)[0],9,'cross-row link');
s = move(newState(),0,3,'rear'); s = move(s,1,1,'front'); s = move(s,0,1,'front'); eq(E.boardScores(s)[0],7,'link does not trigger later');
s = move(newState(),0,4,'rear'); s = move(s,1,6,'rear','p0:04'); s = move(s,0,5,'rear','p0:04'); eq(E.boardScores(s),[8,3],'stable ignores damage and boost');
s = move(newState(),0,7,'front'); s = move(s,1,6,'rear','p0:07'); eq(s.players[0].board[0].shield,false);
s = move(s,0,1,'front'); s = move(s,1,9,null,'p0:07'); eq(s.players[0].board[0].power,2,'shield once');
s = move(newState(),0,1,'front'); s = move(s,1,6,'rear','p0:01'); s = move(s,0,2,'rear'); s = move(s,1,9,null,'p0:01'); eq(s.players[0].board[0].power,0);
s = move(s,0,3,'rear'); eq(s.players[0].board.at(-1).power,5,'zero unit remains on row');
s = move(newState(),0,1,'front'); s = move(s,1,1,'front');
error('TACTIC_ROW', () => E.applyAction(pack,s,0,cmd(s,0,8,'front','p0:01')));
s = move(s,0,8,null,'p0:01'); eq([s.players[0].played_count,s.players[0].board.length,s.players[0].discard.length],[2,1,1]);
s = move(newState(),0,1,'front'); s = move(s,1);
for (const [i,r,t] of [[0,'front',null],[2,'rear',null],[3,'rear',null],[8,null,'p0:01']]) s = move(s,0,i,r,t);
eq([s.round_index,s.players[0].hand.length,s.players[0].discard.length,s.turn_player],[2,5,5,0],'five plays auto-pass');
s = move(newState(),0); s = move(s,1,1,'front'); eq(s.turn_player,1); error('NOT_YOUR_TURN',()=>E.applyAction(pack,s,0,cmd(s,0,0,'front')));
s = move(s,1); eq([s.round_index,s.players[0].passed],[2,false]);
s = newState(); const starters = [];
for (let i = 0; i < 3; i++) { starters.push(s.round_starter); s = move(s,s.turn_player); s = move(s,s.turn_player); }
eq(starters,[0,1,0]); eq(s.players.map(p=>p.match_points),[3,3]); eq(s.phase,'finished'); eq(s.winner,null);
s = newState(); for (const p of s.players) { p.discard=p.hand; p.hand=[]; } s = move(s,0);
eq([s.round_results.length,s.revision,s.phase],[3,1,'finished'],'empty hands auto-settle');

const authority = new E.Authority(pack,newState()); const c = cmd(authority.state,0,0,'front',null,'same');
const result = authority.submit(0,c); eq(authority.submit(0,c),result); eq(authority.state.revision,1);
error('ACTION_ID_CONFLICT',()=>authority.submit(0,{...c,row:'rear'}));
const rejected = cmd(authority.state,0,null,null,null,'rejected'); const rejectResult = authority.submit(0,rejected); eq(rejectResult.status,'rejected'); eq(authority.submit(0,rejected),rejectResult);
const restored = new E.Authority(pack,authority.state,authority.exportLedger()); eq(restored.submit(0,c),result,'persisted deduplication');
s = newState(); const privateView = E.projectView(s,0);
eq(privateView.players[0].hand.length,10); eq(own(privateView.players[1],'hand'),false); eq(privateView.players[1].hand_count,10);
eq(E.projectView(s,null).players.every(p=>!own(p,'hand')),true); eq(s.players[1].hand.length,10);
for (const command of E.legalCommands(pack,s,0,'candidate')) { E.applyAction(pack,s,0,command); assertions++; }
eq(E.legalCommands(pack,E.projectView(s,0),0,'candidate'),E.legalCommands(pack,s,0,'candidate'),'projected view legal moves');

// Complete AI games and assert the AI can run on a view without the enemy hand.
for (let seed = 0; seed < 12; seed++) {
  s = newState(seed); let count = 0;
  while (s.phase === 'playing' && count++ < 32) {
    const actor = s.turn_player, full = E.chooseAction(pack,s,actor,'ai_'+count);
    eq(E.chooseAction(pack,E.projectView(s,actor),actor,'ai_'+count),full,'AI never peeks');
    s = E.applyAction(pack,s,actor,full).state;
  }
  eq(s.phase,'finished','AI game terminates');
}
console.log('PASS: ' + assertions + ' engine assertions; all 20 reference battle states, events and view hashes match.');
function own(o,k) { return Object.prototype.hasOwnProperty.call(o,k); }
