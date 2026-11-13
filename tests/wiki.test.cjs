const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const wiki = require('../wiki/catalog.js');

const root = path.resolve(__dirname, '..');
const wikiRoot = path.join(root, 'wiki');
const catalog = JSON.parse(fs.readFileSync(path.join(wikiRoot, 'data/cards.json'), 'utf8'));
const pack = JSON.parse(fs.readFileSync(path.join(wikiRoot, 'data/design-pack.json'), 'utf8'));
const roster = JSON.parse(fs.readFileSync(path.join(wikiRoot, 'data/clash_roster_96.json'), 'utf8'));
const merged = wiki.mergeCatalog(catalog, pack);
const cards = merged.cards;
let checks = 0;
const ok = (cond, message) => { assert.ok(cond, message); checks++; };

ok(cards.length === 96 && new Set(cards.map(card => card.rid)).size === 96, '96 unique rids');
ok(new Set(roster.cards.map(card => card.rid)).size === 96, 'roster has 96 rids');
ok(pack.status === 'integrated' && pack.design_status === 'playtest_draft', 'design is integrated and still a draft');
ok(pack.ruleset_id === 'pcg.clash.v0', 'ruleset');
ok(pack.source_commit === '8a9acd2e221708835dab446d019a47dcd90896c6', 'source commit');
ok(wiki.filterCards(cards, {cost: '1'}).length === cards.filter(card => card.design.gameplay.cost === 1).length, 'cost filter matches the printed cost');
ok(wiki.filterCards(cards, {cost: '7'}).some(card => card.rid === 'H050'), 'zero key is in the tactical 7 cost tier');
ok(wiki.filterCards(cards, {band: 'series_machine'}).some(card => card.rid === 'H041'), 'StamPLC stays in the machine band');
ok(cards.find(card => card.rid === 'H038').design.gameplay.cost === 1 && cards.find(card => card.rid === 'H038').design.gameplay.attack === 2 && cards.find(card => card.rid === 'H038').design.gameplay.durability === 2, 'stamp S3 is 1 cost 2/2');
ok(cards.find(card => card.rid === 'H041').design.gameplay.cost === 5 && cards.find(card => card.rid === 'H041').design.gameplay.durability === 5 && cards.find(card => card.rid === 'H041').design.gameplay.attack === 3, 'industrial shell is 5 cost 3/5');
const costCounts = cards.reduce((map, card) => {
  const cost = card.design.gameplay.cost;
  map[cost] = (map[cost] || 0) + 1;
  return map;
}, {});
ok(pack.balance_version === 'tactical-v1', 'wiki displays the active balance profile');
const balance = JSON.parse(fs.readFileSync(path.join(root, 'content/clash/clash_balance.json')));
for (const raw of roster.cards) { const expected = {...raw,...balance.card_overrides[raw.template_id]}; const current = pack.cards[raw.rid].gameplay; ok(current.cost === expected.cost, raw.rid + ' cost matches runtime'); if(raw.kind === 'main') { ok(current.attack === expected.attack && current.durability === expected.durability && current.effect === expected.effect, raw.rid + ' body and skill match runtime'); } }
const playOf = rid => cards.find(card => card.rid === rid).design.gameplay;
ok(playOf('H016').cost === 3 && playOf('H016').attack === 1 && playOf('H016').durability === 4 && playOf('H016').guard === true, 'CoreMatrix is 3/1/4 guard');
ok(playOf('H017').cost === 6 && playOf('H017').attack === 4 && playOf('H017').durability === 7 && playOf('H017').guard === true && playOf('H017').cost_band === 'series_machine', 'PowerHub is 6/4/7 guard');
ok(playOf('H036').cost === 2 && playOf('H036').attack === 3 && playOf('H036').durability === 2 && playOf('H036').series_confidence === 'official', 'DinMeter is the 2-cost S3 kit');
ok(playOf('H036a').cost === 3 && playOf('H036a').attack === 4 && playOf('H036a').durability === 2, 'DinMeter star 2 is 3/4/2');
ok(playOf('H037').cost === 2 && playOf('H037').attack === 3 && playOf('H037').durability === 2 && playOf('H037').series_confidence === 'official', 'Air Quality is the 2-cost S3 kit');
ok(playOf('H037a').cost === 3 && playOf('H037a').attack === 4 && playOf('H037a').durability === 2, 'Air Quality star 2 is 3/4/2');
ok(pack.counts.chains === 9 && pack.counts.star1 === 9 && pack.counts.star2 === 9 && pack.counts.unstarred === 78, 'nine two-step chains');
ok(cards.every(card => card.design && card.design.identity.game_name_zh && card.design.identity.faction), 'every card has a Chinese name and faction');
ok(cards.every(card => card.preview_status === 'preview_not_accepted'), 'art remains unaccepted');
ok(cards.filter(card => card.type === 'typeA').length === 67 && cards.filter(card => card.type === 'typeB').length === 29, 'hardware type counts');

cards.forEach(card => {
  const raw = roster.cards.find(item => item.rid === card.rid);
  ok(raw.official_product_name_en === card.official_product_name_en, card.rid + ' official name stays with the artwork metadata');
  ok(raw.art_type === card.type && raw.game_name_zh === card.design.identity.game_name_zh, card.rid + ' design maps by rid');
  ok(card.design.gameplay.role === raw.game_role, card.rid + ' role');
  if (card.design.gameplay.role === 'main') {
    ok(Number.isInteger(card.design.gameplay.attack) && card.design.gameplay.attack > 0, card.rid + ' main attack');
    ok(Number.isInteger(card.design.gameplay.durability) && card.design.gameplay.durability > 0, card.rid + ' main durability');
    ok(card.design.gameplay.attack_bonus == null, card.rid + ' main has no attachment bonus');
  } else {
    ok(card.design.gameplay.attack == null && card.design.gameplay.durability == null, card.rid + ' attachment omits attack and durability');
    ok(card.design.gameplay.attack_bonus || card.design.gameplay.grants_guard || card.design.gameplay.bypass_guard, card.rid + ' attachment effect');
  }
});

ok(cards.find(card => card.rid === 'H005').design.identity.game_name_zh === '二代壳', 'Core2 is 二代壳');
ok(cards.find(card => card.rid === 'H005').design.identity.v8_game_name_zh === '厚壳', 'old Core2 name is kept only as v8');
ok(cards.find(card => card.rid === 'H041').design.identity.game_name_zh === '厚壳工控', 'StamPLC stays 厚壳工控');
ok(cards.find(card => card.rid === 'H050').product_series === '', 'H050 series stays empty');
ok(cards.find(card => card.rid === 'H015').visual_notes.join('').includes('背面'), 'Tab5 back note remains');
ok(!cards.some(card => card.design.growth.star === 3), 'no three-star card');
ok(cards.find(card => card.rid === 'H007').design.growth.star === 2, 'Core2 v1.3 is two stars, not three');

const forbidden = ['/workspace/', '/Users/', '/home/', 'file://'];
function scan(file) {
  const text = fs.readFileSync(file, 'utf8');
  forbidden.forEach(marker => ok(!text.includes(marker), path.basename(file) + ' leaks ' + marker));
}
['index.html', 'wiki.css', 'wiki.js', 'catalog.js', 'README.md', 'data/cards.json', 'data/design-pack.json', 'data/clash_roster_96.json'].forEach(file => scan(path.join(wikiRoot, file)));

const seen = new Set();
cards.forEach(card => {
  ['char_webp', 'card_webp', 'char_thumb_webp', 'card_thumb_webp'].forEach(key => {
    const rel = card.assets.web[key].path;
    const file = path.join(wikiRoot, rel);
    ok(fs.existsSync(file), rel);
    const digest = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    ok(digest === card.assets.web[key].sha256, 'hash ' + rel);
    seen.add(rel);
  });
});
ok(seen.size === 384, '384 webp files');

ok(wiki.filterCards(cards, {q: '二代壳'}).map(card => card.rid).sort().join() === 'H005,H007', 'Chinese name search');
ok(wiki.filterCards(cards, {q: '厚壳工控'}).map(card => card.rid).join() === 'H041', 'renamed shell does not steal the industrial name');
ok(wiki.filterCards(cards, {q: '厚壳'}).map(card => card.rid).sort().join() === 'H005,H041', 'old name still finds the renamed card');
ok(wiki.filterCards(cards, {star: '1'}).length === 9, 'one star');
ok(wiki.filterCards(cards, {star: '2'}).length === 9, 'two stars');
ok(wiki.filterCards(cards, {star: '3'}).length === 0, 'three stars do not exist');
ok(wiki.filterCards(cards, {star: 'none'}).length === 78, 'unstarred');
ok(wiki.filterCards(cards, {family: 'stamp_pin'}).map(card => card.rid).sort().join() === 'H038b,H038c', 'pin family');
ok(wiki.filterCards(cards, {type: 'typeB'}).length === 29, 'typeB');
ok(wiki.filterCards(cards, {series: '_none'}).map(card => card.rid).join() === 'H050', 'uncategorized');

['H038b', 'H038c', 'H033', 'H050', 'A012a', 'C004e'].forEach(rid => {
  const view = wiki.growthView(cards, cards.find(card => card.rid === rid));
  ok(view.mode !== 'chain', rid + ' is not a promotion');
});
const core2 = wiki.growthView(cards, cards.find(card => card.rid === 'H005'));
ok(core2.mode === 'chain' && core2.next.rid === 'H007' && core2.prev === null && wiki.promoteCost(cards.find(card => card.rid === 'H005'), core2.next) === 1, 'Core2 promotes to v1.3 for the difference, at least 1');
const meter = cards.find(card => card.rid === 'H036');
ok(wiki.promoteCost(meter, wiki.growthView(cards, meter).next) === 1, 'DinMeter pays the 1-point difference');
const motion = wiki.growthView(cards, cards.find(card => card.rid === 'C004c'));
ok(motion.mode === 'chain' && motion.next.design.gameplay.attack == null && motion.next.design.gameplay.attack_bonus === 2, 'motion chain stays an attachment');
ok(motion.next.design.gameplay.cost - cards.find(card => card.rid === 'C004c').design.gameplay.cost === 2, 'motion upgrade costs 2');

let chainCount = 0;
cards.forEach(card => {
  if (card.design.growth.kind !== 'chain' || card.design.growth.prev_rid) return;
  chainCount++;
  const seenRids = new Set();
  let walk = card.rid;
  while (walk) {
    ok(!seenRids.has(walk), 'cycle ' + walk);
    seenRids.add(walk);
    walk = cards.find(item => item.rid === walk).design.growth.next_rid;
  }
  ok(seenRids.size === 2, 'chain length 2');
});
ok(chainCount === 9, 'nine chain starts');

const app = fs.readFileSync(path.join(root, 'src/clash/app.js'), 'utf8');
const dist = fs.readFileSync(path.join(root, 'dist/clash/index.html'), 'utf8');
ok(app.includes('data-nav="wiki"'), 'active game links to the wiki');
ok(dist.includes('data-nav="wiki"') && !dist.includes('wiki.js'), 'clash links out without embedding the wiki');
ok(!app.includes('data-nav="legacy"'), 'no legacy game entry');
ok(!/https?:\/\//.test(fs.readFileSync(path.join(wikiRoot, 'index.html'), 'utf8')), 'wiki html has no absolute http url');
const serviceFile = path.join(wikiRoot, 'data/clash_services.json');
const servicePack = JSON.parse(fs.readFileSync(serviceFile, 'utf8'));
ok(fs.readFileSync(serviceFile, 'utf8') === fs.readFileSync(path.join(root, 'content/clash/clash_services.json'), 'utf8'), 'wiki services match the clash service file');
ok(servicePack.cards.length === 4 && servicePack.design_hosts.length === 1, 'four services and one design host');
const hardwareIds = new Set(roster.cards.map(card => card.template_id));
servicePack.cards.concat(servicePack.design_hosts).forEach(card => {
  ok(!hardwareIds.has(card.template_id), card.template_id + ' stays out of the 96');
  ok(card.trusted_sku == null && card.artwork == null, card.template_id + ' has no invented sku or art');
});
ok(fs.readFileSync(path.join(wikiRoot, 'index.html'), 'utf8').includes('id="services"'), 'wiki keeps a software section');

console.log('PASS wiki catalog ' + checks + ' checks');
