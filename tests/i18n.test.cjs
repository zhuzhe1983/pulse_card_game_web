'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const I = require('../shared/i18n.js');
const data = require('../shared/locales/en.json');
const cjk = /[\u3400-\u9fff]/;
assert.equal(I.normalize('en-GB'), 'en');
assert.equal(I.normalize('zh-Hans'), 'zh-CN');
assert.equal(I.normalize('de-DE'), null);
I.setLocale('en');
assert.equal(I.text('对方手牌 5'), 'Enemy hand: 5');
assert.equal(I.text('你打出电磁风暴，费用 4。'), 'You played Arc Wave for 4 power.');
assert.equal(I.text('基础 +3攻 +5耐，受伤 -1'), 'Base +3 ATK +5 HP, Damage -1');
assert.equal(I.text(' · 待核验（无充分官方证据，不编造）'), ' · Unverified: insufficient official evidence; no details invented');
assert.equal(I.text('主控 · 攻3 耐5 · 护卫'), 'Unit · ATK 3 HP 5 · Guard');
assert.equal(I.text('State <&> remains data'), 'State <&> remains data');
assert.equal(I.text('未翻译的新文案'), '未翻译的新文案', 'unknown messages fall back to the source');
I.setLocale('zh-CN');
assert.equal(I.text('对方手牌 5'), '对方手牌 5');
I.setLocale('unsupported');
assert.equal(I.locale, 'zh-CN');
for (const file of ['clash_roster_96','clash_tactics','clash_playtest','clash_services']) {
  const pack = require(`../content/clash/${file}.json`);
  const cards = [...pack.cards, ...(pack.design_hosts || []), ...(pack.second_player_token ? [pack.second_player_token] : [])];
  for (const card of cards) for (const field of ['name','role_note','game_description','hardware_note']) {
    if (card[field]) assert.equal(cjk.test(I.text(card[field], 'en')), false, `${card.template_id}.${field} has untranslated text`);
  }
}
for (const [key, value] of Object.entries(data)) {
  const available = new Set(key.match(/\{\d+\}/g) || []);
  for (const placeholder of value.match(/\{\d+\}/g) || []) assert.ok(available.has(placeholder), `unknown placeholder ${placeholder} in ${key}`);
}
const compiled = fs.readFileSync(path.join(__dirname, '../shared/locales/en.js'), 'utf8');
const parsed = JSON.parse(compiled.slice(compiled.indexOf('globalThis.PULSE_EN=') + 'globalThis.PULSE_EN='.length).trim().replace(/;$/, ''));
assert.deepEqual(parsed, data, 'build must regenerate the browser catalog');
console.log('PASS i18n: locale normalization, source fallback, dynamic messages, all card names/descriptions, placeholder integrity and browser catalog.');
