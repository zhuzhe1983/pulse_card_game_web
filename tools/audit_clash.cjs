/* Reproducible diagnostic, not a human playtest or a balance certification.
 * Both seats use the shipped public-information AI. No runtime files are changed.
 * Usage: node tools/audit_clash.cjs > docs/review/clash-baseline.json
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const C = require('../src/clash/engine.js');
const root = path.resolve(__dirname, '..');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const data = read('content/clash/clash_playtest.json');
const roster = read('content/clash/clash_roster_96.json');
const services = read('content/clash/clash_tactics.json');
const balance = read('content/clash/clash_balance.json');
const caps = read('content/clash/capabilities.json');
const art = read('wiki/data/cards.json').cards.map(card => card.rid);
const loaded = C.loadPack(data, caps);
for (const card of roster.cards.concat(services.cards)) loaded.cards[card.template_id] = card;
loaded.cards.bei_yong_dian_chi = { ...data.second_player_token, template_id: 'bei_yong_dian_chi', name: '备用电池' };
for (const [id, patch] of Object.entries(balance.card_overrides)) Object.assign(loaded.cards[id], patch);
const serviceIds = services.cards.map(card => card.template_id);
const pool = C.simCatalog(roster.cards.map(card => loaded.cards[card.template_id]), art).included.concat(services.cards.filter(card => serviceIds.includes(card.template_id)));
const frequency = values => values.reduce((out, key) => { out[key] = (out[key] || 0) + 1; return out; }, {});
const summary = values => {
  const sorted = values.slice().sort((a, b) => a - b);
  return { min: sorted[0], median: sorted[Math.floor(sorted.length / 2)], p90: sorted[Math.floor(sorted.length * .9)], max: sorted.at(-1), mean: +(values.reduce((a, b) => a + b, 0) / values.length).toFixed(2) };
};
function publicView(game, seat) { return C.aiView(game, seat); }
const games = [], servicePositions = {}, counts = {}, drawn = {}, errors = {};
for (const id of serviceIds) servicePositions[id] = [];
for (let seed = 1; seed <= 200; seed++) {
  const built = C.buildSimDecks(pool, seed);
  for (const deck of built.decks) for (const id of serviceIds) servicePositions[id].push(deck.indexOf(id) + 1);
  const game = new C.Game(loaded.cards, built.decks[0], built.decks[1], balance.rules, 'bei_yong_dian_chi', caps);
  game.start_turn();
  let halfTurns = 0, attacksBase = 0, attacksUnit = 0, maxBoard = 0, spells = 0, maxBurst = 0;
  while (game.winner == null && halfTurns < 100) {
    const seat = game.seat, failed = new Set(), hpBefore = game.bases[1 - seat];
    for (const id of game.hands[seat]) if (serviceIds.includes(id)) drawn[id] = (drawn[id] || 0) + 1;
    for (let step = 0; step < 16 && game.winner == null; step++) {
      const action = C.planAi(publicView(game, seat), failed);
      if (!action) break;
      try {
        if (action.type === 'play') {
          game.play(seat, action.card, action.target == null ? null : action.target, action.mode || null);
          const card = loaded.cards[action.card];
          counts[action.card] = (counts[action.card] || 0) + 1;
          if (card.kind === 'spell' && card.effect !== 'supply') spells++;
        } else if (action.type === 'support') game.support(seat);
        else if (action.type === 'knob') game.knob(seat, action.card, action.target);
        else if (action.type === 'attack') {
          game.attack(seat, action.iid, action.target);
          if (action.target === 'base') attacksBase++; else attacksUnit++;
        }
        maxBoard = Math.max(maxBoard, game.units(0).length, game.units(1).length);
      } catch (error) { failed.add(action.key); errors[error.code] = (errors[error.code] || 0) + 1; }
    }
    maxBurst = Math.max(maxBurst, hpBefore - game.bases[1 - seat]);
    halfTurns++;
    if (game.winner == null) C.finishTurn(game);
  }
  games.push({ seed, winner: game.winner, halfTurns, attacksBase, attacksUnit, spells, maxBoard, maxBurst });
}
const mains = roster.cards.map(card => loaded.cards[card.template_id]).filter(card => card.kind === 'main');
console.log(JSON.stringify({
  ruleset: C.RULESET, source_commit: C.SOURCE_COMMIT, balance_version: balance.balance_version,
  methodology: '200 seeds (1..200), shipped planner mirrored at both seats; maximum 100 individual turns, 16 actions per turn. Diagnostic only. Not human win rates or fun evidence.',
  roster: { total: roster.cards.length, kinds: frequency(roster.cards.map(card => card.kind)), mainEffectCount: mains.filter(card => card.effect).length, mainGuardCount: mains.filter(card => card.guard).length, mainWithoutEffectGuardOrUpperHost: mains.filter(card => !card.effect && !card.guard && !card.upper_host).length },
  deck: { example: C.buildSimDecks(pool, 42).shapes[0], serviceOneBasedPositions: Object.fromEntries(Object.entries(servicePositions).map(([id, positions]) => [id, frequency(positions)])) },
  simulations: { count: games.length, unfinished: games.filter(game => game.winner == null).length, wins: frequency(games.map(game => game.winner)), individualTurns: summary(games.map(game => game.halfTurns)), maxBoard: summary(games.map(game => game.maxBoard)), largestBaseDamageInOneTurn: summary(games.map(game => game.maxBurst)), attacksBase: games.reduce((n, g) => n + g.attacksBase, 0), attacksUnit: games.reduce((n, g) => n + g.attacksUnit, 0), nonBatterySpellPlays: games.reduce((n, g) => n + g.spells, 0), serviceHandTurnOccurrences: drawn, rejectedActions: errors },
  playedCards: counts, games
}, null, 2));
