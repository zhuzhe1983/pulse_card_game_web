'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const N = require('../src/clash/nfc.js');
const C = require('../src/clash/engine.js');

const root = path.resolve(__dirname, '..');
const roster = JSON.parse(fs.readFileSync(path.join(root, 'content/clash/clash_roster_96.json'), 'utf8'));
const playtest = JSON.parse(fs.readFileSync(path.join(root, 'content/clash/clash_playtest.json'), 'utf8'));
const caps = JSON.parse(fs.readFileSync(path.join(root, 'content/clash/capabilities.json'), 'utf8'));
const byRid = Object.create(null);
roster.cards.forEach(card => { byRid[card.rid] = card; });
const h024 = byRid.H024;
const MIME = N.MIME;

function mime(body) {
  return { recordType: 'mime', mediaType: MIME, data: JSON.stringify(body) };
}
function reading(serial, records) {
  return { serialNumber: serial, message: { records } };
}

class FakeReader {
  constructor() {
    this.handlers = { reading: [], readingerror: [] };
    this.writes = [];
    this.failScan = null;
    this.failWrite = null;
  }
  addEventListener(type, fn) { this.handlers[type].push(fn); }
  async scan() { if (this.failScan) throw this.failScan; this.scanning = true; }
  async write(message) {
    if (this.failWrite) throw this.failWrite;
    this.writes.push(JSON.parse(JSON.stringify(message, (key, value) => value instanceof Uint8Array ? Buffer.from(value).toString('utf8') : value)));
  }
  emit(event) { this.handlers.reading.forEach(fn => fn(event)); }
  fail() { this.handlers.readingerror.forEach(fn => fn(new Error('hardware'))); }
}

function session(extra) {
  const fake = new FakeReader();
  let clock = 10000;
  const ready = [];
  const tap = N.createTapSession(Object.assign({
    env: { ua: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile', secure: true, NDEFReader: function NDEFReader() {} },
    lookup: rid => byRid[rid] || null,
    now: () => clock,
    readerFactory: () => fake,
    onReady: card => ready.push(card)
  }, extra || {}));
  return { tap, fake, ready, advance: ms => { clock += ms; } };
}

let passed = 0;
function check(name, fn) {
  return Promise.resolve(fn()).then(() => { passed += 1; console.log('ok', name); });
}

(async () => {
  await check('desktop and ios browsers stay disabled', () => {
    const desk = N.scanSupport({ ua: 'Mozilla/5.0 Chrome/120.0.0.0', secure: true, NDEFReader: function NDEFReader() {} });
    assert.equal(desk.enabled, false);
    assert.equal(desk.text, '这台浏览器不能刷卡，仍可用拖拽或点选出牌');
    const ios = N.scanSupport({ ua: 'Mozilla/5.0 (iPhone) CriOS/120.0.0.0', secure: true, NDEFReader: function NDEFReader() {} });
    assert.equal(ios.enabled, false);
    const http = N.scanSupport({ ua: 'Mozilla/5.0 (Linux; Android 14) Chrome/120.0.0.0', secure: false, NDEFReader: function NDEFReader() {} });
    assert.equal(http.enabled, false);
    assert.equal(http.text, '没有刷卡权限。可以改用拖拽或点选');
  });

  await check('classify blank, ready, unknown and keep them distinct from failures', () => {
    assert.equal(N.classifyMessage({ records: [] }, rid => byRid[rid]).kind, 'blank');
    assert.equal(N.classifyMessage(null, rid => byRid[rid]).kind, 'blank');
    const ready = N.classifyMessage({ records: [mime({ v: 1, cardId: 'H024' })] }, rid => byRid[rid]);
    assert.equal(ready.kind, 'ready');
    assert.equal(ready.templateId, 'art_h024');
    assert.equal(ready.name, '新细条');
    assert.equal(N.classifyMessage({ records: [mime({ v: 1, cardId: 'H024', star: 1 })] }, rid => byRid[rid]).kind, 'unknown');
    assert.equal(N.classifyMessage({ records: [mime({ v: 2, cardId: 'H024' })] }, rid => byRid[rid]).kind, 'unknown');
    assert.equal(N.classifyMessage({ records: [{ recordType: 'mime', mediaType: MIME, data: '{' }] }, rid => byRid[rid]).kind, 'unknown');
    assert.equal(N.classifyMessage({ records: [{ recordType: 'text', data: 'hello' }] }, rid => byRid[rid]).kind, 'unknown');
    assert.equal(N.classifyMessage({ records: [mime({ v: 1, cardId: 'NO-SUCH' })] }, rid => byRid[rid]).kind, 'unknown');
  });

  await check('blank write waits for confirm and verify, unknown bytes stay until overwrite', async () => {
    const { tap, fake } = session();
    await tap.start();
    tap.select(h024);
    assert.equal((await tap.writeCard()).wrote, false);
    tap.handleReading(reading('uid-blank', []));
    assert.equal(tap.status().includes('这是空白卡，可以初始化'), true);
    const wrote = await tap.writeCard();
    assert.equal(wrote.wrote, true);
    assert.equal(fake.writes.length, 1);
    assert.equal(fake.writes[0].records.length, 1);
    tap.handleReading(reading('uid-blank', [mime({ v: 1, cardId: 'NOPE' })]));
    assert.equal(tap.lastKind(), 'verify-failed');
    assert.equal(tap.status(), '写入后校验失败');
    tap.handleReading(reading('uid-strange', [{ recordType: 'text', data: 'keep-me' }]));
    const before = fake.writes.length;
    assert.equal((await tap.writeCard()).reason, 'needs-overwrite');
    assert.equal(fake.writes.length, before);
    assert.equal((await tap.overwrite()).wrote, true);
    assert.equal(fake.writes.length, before + 1);
    tap.handleReading(reading('uid-strange', [mime({ v: 1, cardId: 'H024' })]));
    assert.equal(tap.lastKind(), 'ready');
    assert.equal(tap.status().includes('读到 新细条'), true);
  });

  await check('read errors and permission are not blank or unknown', async () => {
    const denied = session();
    denied.fake.failScan = Object.assign(new Error('no'), { name: 'NotAllowedError' });
    await denied.tap.start();
    assert.equal(denied.tap.lastKind(), 'permission');
    assert.equal(denied.tap.status(), '没有刷卡权限。可以改用拖拽或点选');
    const broken = session();
    await broken.tap.start();
    broken.fake.fail();
    assert.equal(broken.tap.lastKind(), 'failure');
    assert.equal(broken.tap.status(), '没读到卡，请再贴一次');
    assert.notEqual(broken.tap.lastKind(), 'blank');
  });

  await check('same uid is ignored for 1.5s and an empty serial debounces by card id', () => {
    const { tap, ready, advance } = session();
    const card = reading('uid-1', [mime({ v: 1, cardId: 'H024' })]);
    tap.handleReading(card);
    tap.handleReading(card);
    assert.equal(ready.length, 1);
    advance(1499);
    tap.handleReading(card);
    assert.equal(ready.length, 1);
    advance(2);
    tap.handleReading(card);
    assert.equal(ready.length, 2);
    const quiet = session();
    quiet.tap.handleReading(reading('', [mime({ v: 1, cardId: 'H024' })]));
    assert.equal(quiet.tap.status().includes('这张卡没有可读序号'), true);
    assert.equal(quiet.tap.status().includes('两张相同的卡这时无法区分'), true);
    quiet.tap.handleReading(reading('', [mime({ v: 1, cardId: 'H024' })]));
    assert.equal(quiet.ready.length, 1);
  });

  await check('a tap plays one affordable card, refuses missing cards and other turns, and aims when a target is required', () => {
    const loaded = C.loadPack(playtest, caps);
    roster.cards.forEach(card => { loaded.cards[card.template_id] = card; });
    const game = C.Game.empty(loaded.cards, loaded.rules, loaded.capabilities);
    game.hands = [['art_h024', 'gan_rao', 'xiao_yin'], []];
    game.supply = [10, 10];
    game.max_supply = [10, 10];
    game.phase = 'main';
    const stick = N.decideTap({ canAct: true, hand: game.hands[0], needsTarget: false }, { kind: 'ready', templateId: 'art_h024', name: '新细条' });
    assert.equal(stick.action, 'play');
    game.play(0, 'art_h024', null, null, null);
    assert.equal(game.boards[0].at(-1).card_id, 'art_h024');
    assert.equal(game.supply[0], 7);
    const before = game.supply[0];
    const missing = N.decideTap({ canAct: true, hand: game.hands[0], needsTarget: false }, { kind: 'ready', templateId: 'hou_ke', name: '厚壳工控' });
    assert.equal(missing.text, '手里没有这张牌');
    assert.equal(game.supply[0], before);
    const aimed = N.decideTap({ canAct: true, hand: game.hands[0], needsTarget: true }, { kind: 'ready', templateId: 'gan_rao', name: '干扰' });
    assert.equal(aimed.action, 'aim');
    assert.equal(game.supply[0], before);
    const locked = N.decideTap({ canAct: false, hand: game.hands[0], needsTarget: false }, { kind: 'ready', templateId: 'xiao_yin', name: '小印' });
    assert.equal(locked.text, '现在不能替这一方操作');
    assert.equal(game.hands[0].includes('xiao_yin'), true);
  });

  console.log('PASS', passed, 'nfc');
})().catch(error => { console.error(error); process.exit(1); });
