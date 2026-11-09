/* Pulse Card Game — portable pcg.core.v1 rules. No browser, clock or transport
 * dependency in the reducer. The AI's action-id helper is intentionally outside it. */
(function (root) {
  'use strict';
  const RULESET = 'pcg.core.v1';
  const OPS = new Set(['NONE', 'BOOST', 'DAMAGE', 'SELF_BOOST_OTHER_ROW']);
  const TRAITS = new Set(['shield_once', 'stable']);
  const ROWS = new Set(['front', 'rear']);
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const clone = value => JSON.parse(JSON.stringify(value));
  class PCGError extends Error {
    constructor(code, detail = '') { super(detail ? code + ': ' + detail : code); this.name = 'PCGError'; this.code = code; this.detail = detail; }
  }
  const fail = (code, detail) => { throw new PCGError(code, detail); };
  function validateJSON(value, depth = 0) {
    if (depth > 32) fail('JSON_DEPTH');
    if (value === null || typeof value === 'boolean') return;
    if (typeof value === 'number') {
      if (!Number.isInteger(value)) fail('JSON_TYPE', 'Only safe integers are supported');
      if (!Number.isSafeInteger(value)) fail('JSON_INTEGER_RANGE');
      return;
    }
    if (typeof value === 'string') {
      for (let i = 0; i < value.length; i++) {
        const c = value.charCodeAt(i);
        if (c >= 0xD800 && c <= 0xDBFF) {
          const low = value.charCodeAt(++i);
          if (!(low >= 0xDC00 && low <= 0xDFFF)) fail('JSON_INVALID_UNICODE');
        } else if (c >= 0xDC00 && c <= 0xDFFF) fail('JSON_INVALID_UNICODE');
      }
      return;
    }
    if (Array.isArray(value)) { for (const item of value) validateJSON(item, depth + 1); return; }
    if (value && typeof value === 'object' && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
      for (const key of Object.keys(value)) {
        if (!/^[\x20-\x7e]+$/.test(key)) fail('JSON_KEY');
        validateJSON(value[key], depth + 1);
      }
      return;
    }
    fail('JSON_TYPE');
  }
  // Build objects directly; JSON.stringify on a sorted object reorders numeric keys.
  function canonical(value) {
    validateJSON(value);
    function encode(v) {
      if (v === null || typeof v !== 'object') return JSON.stringify(v);
      if (Array.isArray(v)) return '[' + v.map(encode).join(',') + ']';
      return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + encode(v[k])).join(',') + '}';
    }
    return encode(value);
  }
  const SHA_K = new Uint32Array([
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
  ]);
  const rotr = (n, b) => (n >>> b) | (n << (32 - b));
  function sha256(input) {
    const data = typeof input === 'string' ? new TextEncoder().encode(input) : new Uint8Array(input);
    const total = Math.ceil((data.length + 9) / 64) * 64;
    const bytes = new Uint8Array(total); bytes.set(data); bytes[data.length] = 0x80;
    const view = new DataView(bytes.buffer); const bitLength = data.length * 8;
    view.setUint32(total - 8, Math.floor(bitLength / 0x100000000)); view.setUint32(total - 4, bitLength >>> 0);
    const h = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
    const w = new Uint32Array(64);
    for (let off = 0; off < total; off += 64) {
      for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
      for (let i = 16; i < 64; i++) {
        const x = w[i-15], y = w[i-2];
        w[i] = (w[i-16] + (rotr(x,7) ^ rotr(x,18) ^ (x >>> 3)) + w[i-7] + (rotr(y,17) ^ rotr(y,19) ^ (y >>> 10))) >>> 0;
      }
      let [a,b,c,d,e,f,g,j] = h;
      for (let i = 0; i < 64; i++) {
        const t1 = (j + (rotr(e,6) ^ rotr(e,11) ^ rotr(e,25)) + ((e & f) ^ (~e & g)) + SHA_K[i] + w[i]) >>> 0;
        const t2 = ((rotr(a,2) ^ rotr(a,13) ^ rotr(a,22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
        j = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      const out = [a,b,c,d,e,f,g,j]; for (let i = 0; i < 8; i++) h[i] = (h[i] + out[i]) >>> 0;
    }
    return Array.from(h, n => n.toString(16).padStart(8, '0')).join('');
  }
  const digest = value => sha256(canonical(value));
  function parseJSON(input, maxBytes = 65536) {
    let text;
    try { text = typeof input === 'string' ? input : new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(input); }
    catch (_) { fail('JSON_INVALID'); }
    if (new TextEncoder().encode(text).length > maxBytes) fail('JSON_TOO_LARGE');
    let pos = 0;
    const space = () => { while (pos < text.length && /[ \t\r\n]/.test(text[pos])) pos++; };
    function string() {
      const start = pos++;
      while (pos < text.length) {
        const ch = text[pos++];
        if (ch === '"') { try { return JSON.parse(text.slice(start, pos)); } catch (_) { fail('JSON_INVALID'); } }
        if (ch === '\\') pos++;
      }
      fail('JSON_INVALID');
    }
    function value(depth) {
      if (depth > 32) fail('JSON_DEPTH');
      space(); const c = text[pos];
      if (c === '"') return string();
      if (c === '{') {
        pos++; space(); const out = {};
        if (text[pos] === '}') { pos++; return out; }
        while (true) {
          space(); if (text[pos] !== '"') fail('JSON_INVALID');
          const key = string(); if (own(out, key)) fail('JSON_DUPLICATE_KEY', key);
          space(); if (text[pos++] !== ':') fail('JSON_INVALID');
          const item = value(depth + 1);
          Object.defineProperty(out, key, { value: item, enumerable: true, configurable: true, writable: true });
          space(); const end = text[pos++]; if (end === '}') return out; if (end !== ',') fail('JSON_INVALID');
        }
      }
      if (c === '[') {
        pos++; space(); const out = []; if (text[pos] === ']') { pos++; return out; }
        while (true) { out.push(value(depth + 1)); space(); const end = text[pos++]; if (end === ']') return out; if (end !== ',') fail('JSON_INVALID'); }
      }
      for (const [token, result] of [['true', true], ['false', false], ['null', null]]) {
        if (text.startsWith(token, pos)) { pos += token.length; return result; }
      }
      const number = text.slice(pos).match(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/);
      if (!number) fail('JSON_INVALID');
      pos += number[0].length;
      if (/[.eE]/.test(number[0])) fail('JSON_FLOAT');
      return Number(number[0]);
    }
    const result = value(0); space(); if (pos !== text.length) fail('JSON_INVALID'); validateJSON(result); return result;
  }
  function parseCanonical(input, maxBytes = 65536) {
    const value = parseJSON(input, maxBytes);
    let text; try { text = typeof input === 'string' ? input : new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(input); } catch (_) { fail('JSON_INVALID'); }
    if (canonical(value) !== text) fail('NON_CANONICAL_JSON'); return value;
  }
  function heroIdFromUID(technology, uidHex) {
    if (!['nfc-a', 'nfc-b', 'nfc-f', 'nfc-v'].includes(technology)) fail('TAG_TECHNOLOGY');
    if (typeof uidHex !== 'string' || !/^(?:[0-9a-fA-F]{2}){1,16}$/.test(uidHex)) fail('TAG_UID');
    return 'uid:' + sha256('pcg.hero.uid.v1\n' + technology + '\n' + uidHex.toUpperCase());
  }
  function validatePack(pack) {
    if (!pack || pack.ruleset_id !== RULESET) fail('RULESET_UNSUPPORTED');
    if ((pack.required_ops || []).some(x => !OPS.has(x)) || (pack.required_traits || []).some(x => !TRAITS.has(x))) fail('CONTENT_UNSUPPORTED');
    if (!Array.isArray(pack.cards)) fail('CONTENT_UNSUPPORTED');
    const catalog = Object.create(null);
    for (const card of pack.cards) {
      if (!card || typeof card.template_id !== 'string' || !card.template_id || !Array.isArray(card.traits) || !Array.isArray(card.allowed_rows) || !card.effect) fail('CONTENT_UNSUPPORTED');
      if (own(catalog, card.template_id)) fail('CONTENT_DUPLICATE_ID');
      if (!['unit', 'tactic'].includes(card.kind) || !OPS.has(card.effect.op) || card.traits.some(t => !TRAITS.has(t))) fail('CONTENT_UNSUPPORTED');
      if (card.kind === 'unit') {
        if (!card.allowed_rows.length || card.allowed_rows.some(r => !ROWS.has(r))) fail('CONTENT_ROW');
        if (!Number.isInteger(card.base_power) || card.base_power < 0 || card.base_power > 99) fail('CONTENT_POWER');
      } else if (card.base_power !== 0 || card.allowed_rows.length || card.traits.length) fail('CONTENT_TACTIC');
      if (card.effect.amount !== (card.effect.op === 'NONE' ? 0 : 2)) fail('CONTENT_EFFECT_AMOUNT');
      if (card.kind === 'tactic' && !['BOOST', 'DAMAGE'].includes(card.effect.op)) fail('CONTENT_TACTIC_EFFECT');
      catalog[card.template_id] = card;
    }
    return catalog;
  }
  function newMatch(pack, matchId, playerIds, decks, seedUint32) {
    const catalog = validatePack(pack);
    if (!Array.isArray(playerIds) || playerIds.length !== 2 || playerIds[0] === playerIds[1] || !Array.isArray(decks) || decks.length !== 2) fail('MATCH_PLAYERS');
    if (!Number.isInteger(seedUint32) || seedUint32 < 0 || seedUint32 > 0xffffffff) fail('MATCH_SEED');
    const players = decks.map((templates, seat) => {
      if (!Array.isArray(templates) || templates.length !== 10 || new Set(templates).size !== 10) fail('DECK_SIZE_OR_DUPLICATE');
      if (templates.some(t => !own(catalog, t))) fail('DECK_UNKNOWN_CARD');
      if (templates.filter(t => catalog[t].kind === 'unit').length < 6) fail('DECK_TOO_FEW_UNITS');
      return { player_id: playerIds[seat], hand: templates.map((template_id, i) => ({ instance_id: 'p' + seat + ':' + String(i).padStart(2,'0'), template_id })), board: [], discard: [], played_count: 0, passed: false, match_points: 0 };
    });
    return { ruleset_id: RULESET, content_hash: digest(pack), match_id: matchId, revision: 0, round_index: 1, phase: 'playing', round_starter: seedUint32 & 1, turn_player: seedUint32 & 1, players, round_results: [], winner: null, result_reason: null };
  }
  const boardScores = state => state.players.map(p => p.board.reduce((n, u) => n + u.power, 0));
  function targets(state, actor, op) { return op === 'BOOST' ? state.players[actor].board : op === 'DAMAGE' ? state.players[1-actor].board : []; }
  function applyEffect(state, actor, definition, source, targetId, events) {
    const op = definition.effect.op, amount = definition.effect.amount;
    if (op === 'NONE') return;
    if (op === 'SELF_BOOST_OTHER_ROW') {
      if (state.players[actor].board.some(u => u.row !== source.row) && !source.stable) { source.power += amount; events.push({ kind: 'power', instance_id: source.instance_id, delta: amount }); }
      return;
    }
    if (targetId === null) { events.push({ kind: 'effect_skipped', source_instance_id: source.instance_id }); return; }
    const target = targets(state, actor, op).find(u => u.instance_id === targetId);
    if (target.stable) events.push({ kind: 'immune', instance_id: targetId });
    else if (op === 'DAMAGE' && target.shield) { target.shield = false; events.push({ kind: 'shield_consumed', instance_id: targetId }); }
    else { const before = target.power; target.power = op === 'DAMAGE' ? Math.max(0, before - amount) : before + amount; events.push({ kind: 'power', instance_id: targetId, delta: target.power - before }); }
  }
  function settleRound(state, events) {
    const scores = boardScores(state), winner = scores[0] === scores[1] ? null : scores[0] > scores[1] ? 0 : 1;
    const awards = winner === null ? [1,1] : winner === 0 ? [2,0] : [0,2];
    const result = { round_index: state.round_index, scores, winner, awards }; state.round_results.push(result);
    events.push({ kind: 'round_ended', ...clone(result), final_boards: state.players.map(p => clone(p.board)), played_counts: state.players.map(p => p.played_count), passed: state.players.map(p => p.passed) });
    state.players.forEach((player, seat) => { player.match_points += awards[seat]; player.discard.push(...player.board.map(u => ({ instance_id: u.instance_id, template_id: u.template_id }))); player.board = []; });
    const points = state.players.map(p => p.match_points);
    if (Math.max(...points) >= 4 || state.round_index === 3) {
      state.phase = 'finished'; state.turn_player = null; state.winner = points[0] === points[1] ? null : points[0] > points[1] ? 0 : 1; state.result_reason = 'points';
      events.push({ kind: 'match_ended', winner: state.winner, match_points: points }); return;
    }
    state.round_index++; state.round_starter = winner === null ? 1 - state.round_starter : winner; state.turn_player = state.round_starter;
    for (const player of state.players) { player.passed = false; player.played_count = 0; }
  }
  function normalize(state, events) {
    while (state.phase === 'playing') {
      state.players.forEach((player, seat) => { if (!player.passed && (!player.hand.length || player.played_count >= 5)) { player.passed = true; events.push({ kind: 'auto_pass', actor: seat }); } });
      if (state.players.every(p => p.passed)) { settleRound(state, events); continue; }
      if (state.players[state.turn_player].passed) state.turn_player = 1 - state.turn_player;
      break;
    }
  }
  function applyAction(pack, current, actor, command) {
    const catalog = validatePack(pack);
    if (digest(pack) !== current.content_hash) fail('CONTENT_MISMATCH');
    const required = ['match_id','action_id','expected_revision','kind','card_instance_id','row','target_instance_id'].sort();
    if (!command || Array.isArray(command) || typeof command !== 'object' || Object.keys(command).sort().join('\n') !== required.join('\n')) fail('COMMAND_FIELDS');
    if (command.match_id !== current.match_id) fail('MATCH_MISMATCH');
    if (!Number.isInteger(command.expected_revision) || command.expected_revision !== current.revision) fail('STALE_REVISION');
    if (current.phase !== 'playing') fail('MATCH_FINISHED');
    if (!Number.isInteger(actor) || ![0,1].includes(actor) || actor !== current.turn_player) fail('NOT_YOUR_TURN');
    if (current.players[actor].passed) fail('ALREADY_PASSED');
    const state = clone(current), player = state.players[actor], events = [];
    if (command.kind === 'pass') {
      if (['card_instance_id','row','target_instance_id'].some(k => command[k] !== null)) fail('PASS_ARGUMENTS');
      player.passed = true; events.push({ kind: 'pass', actor });
    } else if (command.kind === 'play') {
      const handCard = player.hand.find(c => c.instance_id === command.card_instance_id); if (!handCard) fail('CARD_NOT_IN_HAND');
      const definition = catalog[handCard.template_id];
      if (definition.kind === 'unit') { if (!definition.allowed_rows.includes(command.row)) fail('ILLEGAL_ROW'); }
      else if (command.row !== null) fail('TACTIC_ROW');
      const op = definition.effect.op, candidates = targets(state, actor, op), targetId = command.target_instance_id;
      if (op === 'BOOST' || op === 'DAMAGE') {
        if (candidates.length) { if (!candidates.some(u => u.instance_id === targetId)) fail('TARGET_REQUIRED_OR_INVALID'); }
        else if (definition.kind === 'tactic') fail('NO_TACTIC_TARGET');
        else if (targetId !== null) fail('TARGET_INVALID');
      } else if (targetId !== null) fail('TARGET_NOT_ALLOWED');
      player.hand.splice(player.hand.indexOf(handCard), 1); player.played_count++;
      let source;
      if (definition.kind === 'unit') { source = { ...handCard, row: command.row, base_power: definition.base_power, power: definition.base_power, shield: definition.traits.includes('shield_once'), stable: definition.traits.includes('stable'), deploy_order: player.played_count }; player.board.push(source); }
      else { source = handCard; player.discard.push(clone(handCard)); }
      events.push({ kind: 'played', actor, card: clone(handCard), row: command.row }); applyEffect(state, actor, definition, source, targetId, events);
    } else fail('COMMAND_KIND');
    state.revision++; state.turn_player = 1 - actor; normalize(state, events); return { state, events };
  }
  function projectView(state, viewer) {
    if (viewer !== null && (!Number.isInteger(viewer) || ![0,1].includes(viewer))) fail('VIEWER');
    const view = clone(state); view.viewer_seat = viewer;
    view.players.forEach((p, seat) => { p.hand_count = p.hand.length; if (seat !== viewer) delete p.hand; });
    view.scores = boardScores(state); return view;
  }
  function legalCommands(pack, state, actor, actionId) {
    if (state.phase !== 'playing' || actor !== state.turn_player) return [];
    const base = { match_id: state.match_id, action_id: actionId, expected_revision: state.revision, kind: 'pass', card_instance_id: null, row: null, target_instance_id: null };
    const out = [base], catalog = validatePack(pack);
    for (const card of state.players[actor].hand) {
      const definition = catalog[card.template_id], candidates = targets(state, actor, definition.effect.op);
      if (definition.kind === 'tactic' && !candidates.length) continue;
      const targetIds = candidates.length ? candidates.map(u => u.instance_id) : [null];
      for (const row of definition.kind === 'unit' ? definition.allowed_rows : [null]) for (const targetId of targetIds) out.push({ ...base, kind: 'play', card_instance_id: card.instance_id, row, target_instance_id: targetId });
    }
    return out;
  }
  class Authority {
    constructor(pack, state, results = {}) { this.pack = clone(pack); this.state = clone(state); this.results = clone(results); }
    submit(actor, command) {
      const actionId = command && own(command, 'action_id') ? command.action_id : null;
      const key = canonical([actor, actionId]), fingerprint = canonical(command);
      if (own(this.results, key)) { const previous = this.results[key]; if (fingerprint !== previous.fingerprint) fail('ACTION_ID_CONFLICT'); return clone(previous.result); }
      let result;
      try {
        const applied = applyAction(this.pack, this.state, actor, command); this.state = applied.state;
        result = { match_id: this.state.match_id, action_id: command.action_id, status: 'accepted', revision: this.state.revision, error_code: null, events: applied.events, snapshot_required: true };
      } catch (error) {
        if (!(error instanceof PCGError)) throw error;
        result = { match_id: this.state.match_id, action_id: actionId, status: 'rejected', revision: this.state.revision, error_code: error.code, events: [], snapshot_required: true };
      }
      this.results[key] = { fingerprint, result: clone(result) }; return clone(result);
    }
    exportLedger() { return clone(this.results); }
  }
  let aiCounter = 0;
  function newActionId() {
    if (root.crypto && typeof root.crypto.randomUUID === 'function') return root.crypto.randomUUID();
    return 'action_' + Date.now().toString(36) + '_' + (++aiCounter).toString(36);
  }
  // This baseline AI sees its own hand and the public board only. It does not
  // inspect the opponent's cards. It saves cards, takes cheap wins and can concede.
  function chooseAction(pack, state, actor, actionId = newActionId()) {
    const legal = legalCommands(pack, state, actor, actionId); if (!legal.length) return null;
    const pass = legal[0], plays = legal.slice(1); if (!plays.length) return pass;
    const me = state.players[actor], foe = state.players[1-actor], catalog = validatePack(pack);
    const scores = boardScores(state), lead = scores[actor] - scores[1-actor], mustFight = foe.match_points >= 2 || state.round_index === 3;
    if (foe.passed && lead > 0) return pass;
    const ranked = plays.map(command => {
      const card = me.hand.find(c => c.instance_id === command.card_instance_id), def = catalog[card.template_id];
      let gain = def.base_power, potential = def.base_power, secondary = 0;
      const target = command.target_instance_id === null ? null : targets(state, actor, def.effect.op).find(u => u.instance_id === command.target_instance_id);
      if (def.effect.op !== 'NONE') potential += 2;
      if (def.effect.op === 'SELF_BOOST_OTHER_ROW' && me.board.some(u => u.row !== command.row) && !def.traits.includes('stable')) gain += 2;
      if (target && !target.stable) {
        if (def.effect.op === 'BOOST') gain += 2;
        if (def.effect.op === 'DAMAGE') { if (target.shield) secondary += .25; else gain += Math.min(2, target.power); }
      }
      if (def.traits.includes('shield_once')) secondary += .15;
      if (def.traits.includes('stable')) secondary += .12;
      // Small cross-row preference makes future link effects possible.
      if (def.kind === 'unit' && me.board.length && !me.board.some(u => u.row === command.row)) secondary += .08;
      return { command, gain, potential, secondary };
    });
    const byCard = new Map(); for (const r of ranked) { const id = r.command.card_instance_id; if (!byCard.has(id) || r.gain > byCard.get(id)) byCard.set(id, r.gain); }
    const ceiling = Array.from(byCard.values()).sort((a,b) => b-a).slice(0, 5-me.played_count).reduce((a,b) => a+b, 0);
    if (foe.passed) {
      if (lead + ceiling < 0) return pass;
      const winners = ranked.filter(r => lead + r.gain > 0);
      if (winners.length) { winners.sort((a,b) => a.potential-b.potential || a.gain-b.gain || b.secondary-a.secondary); return winners[0].command; }
      if (lead === 0 && !mustFight && me.hand.length <= 3) return pass;
    }
    if (!mustFight && !foe.passed) {
      if (lead < -9 && me.played_count >= 2 && me.hand.length >= 4) return pass;
      if (state.round_index === 2 && me.match_points >= 2 && lead < -5 && me.hand.length <= 5) return pass;
      const budget = state.round_index === 1 ? 4 : Math.max(2, Math.ceil(me.hand.length / 2));
      if (me.played_count >= budget && lead > 0) return pass;
      if (lead >= 6 && me.played_count >= 2 && me.hand.length >= 4) return pass;
    }
    ranked.sort((a,b) => (b.gain+b.secondary-.22*b.potential) - (a.gain+a.secondary-.22*a.potential));
    if (ranked[0].gain <= 0 && !mustFight) return pass;
    return ranked[0].command;
  }
  root.PCGEngine = Object.freeze({ RULESET, PCGError, canonical, digest, sha256, validateJSON, parseJSON, parseCanonical, heroIdFromUID, validatePack, newMatch, applyAction, projectView, legalCommands, boardScores, Authority, chooseAction, newActionId });
  if (typeof module === 'object' && module.exports) module.exports = root.PCGEngine;
})(typeof globalThis !== 'undefined' ? globalThis : window);
