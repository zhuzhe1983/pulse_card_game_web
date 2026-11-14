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
  async scan(options) { this.scanOptions = options; if (this.failScan) throw this.failScan; this.scanning = true; }
  async write(message, options) {
    this.writeOptions = options;
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
    assert.equal(tap.status(), '写入并读回校验成功');
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

  await check('default browser reader factory, stop and repeated start have one live scan', async () => {
    const previous = globalThis.NDEFReader;
    globalThis.NDEFReader = FakeReader;
    try {
      const { tap } = session({ readerFactory: null });
      await tap.start();
      const reader = tap.reader();
      assert.ok(reader instanceof FakeReader);
      await tap.start();
      assert.equal(tap.reader(), reader);
      tap.stop();
      assert.equal(reader.scanOptions.signal.aborted, true);
      reader.emit(reading('ignored', [mime({ v: 1, cardId: 'H024' })]));
      assert.equal(tap.lastKind(), '');
      assert.equal(tap.active(), false);
      await tap.start();
      assert.notEqual(tap.reader(), reader);
      tap.stop();
    } finally { globalThis.NDEFReader = previous; }
  });

  await check('blank write refuses implicit overwrite, suppresses concurrent writes and verifies the same UID', async () => {
    const { tap, fake, ready } = session();
    await tap.start(); tap.select(h024);
    tap.handleReading(reading('first', [{ recordType: 'empty' }]));
    assert.equal((await tap.writeCard()).verified, false);
    assert.equal(fake.writeOptions.overwrite, false);
    assert.equal(tap.lastKind(), 'verifying');
    assert.equal((await tap.writeCard()).reason, 'busy');
    const payload = [mime(N.messageFor(h024).json ? JSON.parse(N.messageFor(h024).json) : {})];
    assert.equal(tap.handleReading(reading('second', payload)).kind, 'wrong-card');
    assert.equal(tap.lastKind(), 'verifying');
    assert.equal(tap.handleReading(reading('first', payload)).kind, 'verified');
    assert.equal(ready.length, 0, 'verification must not play a card');
    assert.equal((await tap.writeCard()).reason, 'needs-overwrite');
    assert.equal((await tap.overwrite()).wrote, true);
    assert.equal(fake.writeOptions.overwrite, true);
    tap.stop();
  });

  await check('write failure and verification timeout never report success', async () => {
    const { tap, fake } = session({ timeoutMs: 10 });
    await tap.start(); tap.select(h024);
    tap.handleReading(reading('first', []));
    fake.failWrite = new Error('locked');
    assert.equal((await tap.writeCard()).reason, 'write-failed');
    assert.equal(tap.lastKind(), 'write-failed');
    fake.failWrite = null;
    tap.handleReading(reading('second', []));
    await tap.writeCard();
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(tap.lastKind(), 'verify-failed');
    assert.equal(tap.busy(), false);
    tap.stop();
    const missingHardware = session();
    missingHardware.fake.failScan = Object.assign(new Error('missing'), { name: 'NotSupportedError' });
    assert.equal((await missingHardware.tap.start()).reason, 'failure');
    assert.equal(missingHardware.tap.active(), false);
  });

  await check('M5Dial raw NDEF reads game cards and refuses partial, malformed and identity records', () => {
    const type = Buffer.from(MIME), data = Buffer.from(N.messageFor(h024).json);
    const raw = Buffer.concat([Buffer.from([0xd2, type.length, data.length]), type, data]);
    const event = { ndef: 'foreign', tag: { ndef_hex: raw.toString('hex'), ndef_hex_truncated: false } };
    assert.equal(N.classifyBridge(event, lookup).templateId, h024.template_id);
    assert.equal(N.classifyBridge({ ...event, tag: { ...event.tag, ndef_hex_truncated: true } }, lookup).kind, 'unknown');
    assert.equal(N.classifyBridge({ ...event, tag: { ndef_hex: raw.subarray(0, -1).toString('hex') } }, lookup).kind, 'unknown');
    assert.equal(N.classifyBridge({ ...event, tag: { ndef_hex: '00' + event.tag.ndef_hex } }, lookup).kind, 'unknown');
    assert.equal(N.classifyBridge({ descriptor: N.createPlayer('小明', '01') }, lookup).kind, 'identity');
    assert.equal(N.classifyBridge({ ndef: 'error' }, lookup).kind, 'failure');
    assert.equal(N.classifyBridge({ ndef: 'blank' }, lookup).kind, 'blank');
    assert.equal(N.classifyBridge({ ndef: 'unformatted' }, lookup).kind, 'unknown');
    assert.equal(N.classifyMessage({ records: [mime({ v: 1, cardId: 'H024' }), mime({ v: 1, cardId: 'H024' })] }, lookup).kind, 'unknown');
    function lookup(rid) { return byRid[rid]; }
  });

  await check('player identity creation uses distinct UUIDs and verifies before recognizing the player', async () => {
    const R = require('../src/readers.js');
    const first = N.createPlayer('小明', '01'), second = N.createPlayer('小明', '01');
    assert.notEqual(first.id, second.id);
    assert.equal(first.name, '小明');
    assert.throws(() => N.createPlayer('', '01'));
    assert.throws(() => N.createPlayer('字'.repeat(25), '01'));
    assert.throws(() => N.createPlayer('名字', '10'));
    const identities = [];
    const {tap, fake, ready} = session({ onIdentity: (found, info) => identities.push({found, info}) });
    const identityRecord = value => ({recordType:'mime',mediaType:R.MIME,data:R.encodeDescriptor(value)});
    await tap.start(); tap.selectIdentity(first);
    tap.handleReading(reading('blank-player', []));
    assert.equal((await tap.writeCard()).wrote, true);
    assert.equal(fake.writeOptions.overwrite, false);
    assert.equal(fake.writes[0].records[0].mediaType, R.MIME);
    assert.equal(identities.length, 0, 'write promise alone does not activate identity');
    tap.handleReading(reading('different-tag', [identityRecord(first)]));
    assert.equal(identities.length, 0);
    tap.handleReading(reading('blank-player', [identityRecord(first)]));
    assert.equal(tap.status(), '玩家身份卡写入并校验成功');
    assert.equal(identities[0].info.verified, true);
    assert.deepEqual(identities[0].found.descriptor, first);
    assert.equal(ready.length, 0, 'identity cards never enter the game play callback');
    assert.equal((await tap.overwrite()).wrote, false, 'player setup never overwrites another identity');
    tap.handleReading(reading('another-tag', [identityRecord(second)]));
    assert.equal(identities[1].found.descriptor.id, second.id);
    assert.equal(identities[1].info.verified, false);
    assert.equal(N.classifyMessage({records:[identityRecord(first),mime({v:1,cardId:'H024'})]}, ()=>h024).kind, 'unknown');
    tap.stop();
  });

  console.log('PASS', passed, 'nfc');
})().catch(error => { console.error(error); process.exit(1); });
