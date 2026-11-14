'use strict';
const assert = require('node:assert/strict');
const R = require('../src/readers.js');
const enc = new TextEncoder();
const player = { game: 'pcg', v: 1, type: 'player', id: '12345678-1234-4123-8123-123456789abc', skin: '01', name: '小明' };
const hero = { game: 'pcg', v: 1, type: 'hero', id: '98765432-1234-4123-8123-123456789abc', mode: 'fixed', template_id: 'core2_guard' };
const error = (fn, code) => assert.throws(fn, e => e.code === code);

async function run() {
  assert.equal(R.normalizeUID('04:AA:1b:2c:3d:4e:5f'), '04AA1B2C3D4E5F');
  assert.equal(R.normalizeUID(new Uint8Array([4,170,27,44,61,78,95])), '04AA1B2C3D4E5F');
  assert.equal(R.normalizeUID('0xdeadbeef'), 'DEADBEEF');
  error(() => R.normalizeUID('1234567890'), 'UID_FORMAT');
  error(() => R.normalizeUID('0401020304050Z'), 'UID_FORMAT');
  error(() => R.normalizeUID([4, 0, 0, 256]), 'UID_FORMAT');
  assert.deepEqual(R.parseDescriptor(R.encodeDescriptor(player)), player);
  assert.deepEqual(R.parseDescriptor(JSON.stringify(hero)), hero);
  assert.ok(R.encodeDescriptor(player).length < 384);
  error(() => R.parseDescriptor({ ...player, skin: ['01'] }), 'DESCRIPTOR_SKIN');
  error(() => R.parseDescriptor({ ...player, id: [player.id] }), 'DESCRIPTOR_FORMAT');
  error(() => R.parseDescriptor({ ...player, v: 2 }), 'DESCRIPTOR_FORMAT');
  error(() => R.parseDescriptor({ ...player, secret: 'oops' }), 'DESCRIPTOR_FIELDS');
  error(() => R.parseDescriptor({ ...player, name: 'x'.repeat(25) }), 'DESCRIPTOR_NAME');
  error(() => R.parseDescriptor({ ...hero, mode: 'blind' }), 'DESCRIPTOR_HERO');

  // All UTF-8 split boundaries, including a newline and two messages in one packet.
  const wire = enc.encode(JSON.stringify({ type: 'hello', name: '小明' }) + '\r\n' + JSON.stringify({ type: 'removed' }) + '\n');
  for (let boundary = 0; boundary <= wire.length; boundary++) {
    const decoder = new R.JsonLineDecoder();
    const output = [...decoder.push(wire.slice(0,boundary)), ...decoder.push(wire.slice(boundary))];
    assert.deepEqual(output, [{ type: 'hello', name: '小明' }, { type: 'removed' }]);
  }
  const decoder = new R.JsonLineDecoder(32);
  error(() => decoder.push(enc.encode('x'.repeat(33))), 'FRAME_SIZE');
  assert.deepEqual(decoder.push(enc.encode('{"ok":true}\n')), [{ok:true}]);
  error(() => decoder.push(enc.encode('nope\n')), 'FRAME_JSON');
  error(() => decoder.push(new Uint8Array([255,10])), 'FRAME_JSON');
  error(() => decoder.push(enc.encode('null\n')), 'FRAME_OBJECT');
  const wrapped = enc.encode('junk{"ok":1}\nend');
  assert.deepEqual(new R.JsonLineDecoder().push(new DataView(wrapped.buffer,4,9)), [{ok:1}]);

  const cards = [], statuses = [];
  const manager = new R.ReaderManager({ onCard: value => cards.push(value), onStatus: value => statuses.push(value) });
  manager.feedKeyboard('04AA1B2C3D4E5F');
  manager.feedKeyboard('04AA1B2C3D4E5F');
  assert.equal(cards.length, 1, 'repeat scan is debounced');
  assert.equal(cards[0].source, 'keyboard');
  assert.equal(manager.state.canWrite, false);
  await assert.rejects(manager.writePlayer(player), e => e.code === 'WRITE_UNAVAILABLE');
  await manager.disconnect();

  // A fake USB transport exercises real adapter framing, handshake, write readback,
  // repeated-card removal, endpoint discovery, and cancellation. Not a hardware test.
  class FakeDevice {
    constructor() {
      this.opened = false; this.queue = []; this.waiters = []; this.sent = [];
      this.configurations = [{ configurationValue: 1 }];
      const alternate = { interfaceClass: 255, alternateSetting: 0, endpoints: [{direction:'in',type:'bulk',endpointNumber:1,packetSize:64},{direction:'out',type:'bulk',endpointNumber:2,packetSize:64}] };
      this.configuration = { interfaces: [{interfaceNumber:0,alternate,alternates:[alternate]}] };
    }
    async open() { this.opened = true; }
    async claimInterface(n) { assert.equal(n,0); }
    inject(value) {
      const bytes = enc.encode(JSON.stringify(value) + '\n');
      for (let i=0;i<bytes.length;i+=17) {
        const chunk = bytes.slice(i,i+17);
        const result = {status:'ok',data:new DataView(chunk.buffer)};
        const waiter = this.waiters.shift();
        if (waiter) waiter.resolve(result); else this.queue.push(result);
      }
    }
    async transferOut(endpoint, bytes) {
      assert.equal(endpoint,2);
      const message = JSON.parse(new TextDecoder().decode(bytes)); this.sent.push(message);
      if (message.type === 'hello') this.inject({type:'hello',protocol:R.PROTOCOL,capabilities:['uid','ndef_read','ndef_write']});
      if (message.type === 'write') this.inject({type:'write_result',request_id:message.request_id,ok:true,uid:message.expected_uid,descriptor:message.descriptor});
      return {status:'ok',bytesWritten:bytes.length};
    }
    transferIn(endpoint) {
      assert.equal(endpoint,1);
      if (this.queue.length) return Promise.resolve(this.queue.shift());
      return new Promise((resolve,reject) => this.waiters.push({resolve,reject}));
    }
    async close() { this.opened=false; this.waiters.splice(0).forEach(w=>w.reject(new Error('closed'))); }
  }
  const fake = new FakeDevice();
  const oldNavigator = Object.getOwnPropertyDescriptor(globalThis,'navigator');
  Object.defineProperty(globalThis,'navigator',{ configurable:true,value:{usb:{requestDevice:async options=>{assert.deepEqual(options.filters,[{classCode:255}]);return fake;}}} });
  const waitTick = () => new Promise(resolve => setImmediate(resolve));
  try {
    await manager.connectUSB();
    assert.equal(manager.state.source,'webusb'); assert.equal(manager.state.canWrite,true);
    fake.inject({type:'card',uid:'04AA1B2C3D4E5F',descriptor:player,tag:{ndef_hex:'D00000',ndef_hex_truncated:false}}); await waitTick();
    assert.equal(cards.at(-1).tag.ndef_hex,'D00000');
    assert.deepEqual(cards.at(-1).descriptor,player);
    const count = cards.length;
    fake.inject({type:'card',uid:'04AA1B2C3D4E5F',descriptor:player}); await waitTick();
    assert.equal(cards.length,count);
    const result = await manager.writePlayer(player,{overwrite:true});
    assert.equal(result.verified,true); assert.deepEqual(result.descriptor,player);
    assert.equal(fake.sent.at(-1).expected_uid,'04AA1B2C3D4E5F');
    fake.inject({type:'removed'}); fake.inject({type:'card',uid:'04AA1B2C3D4E5F'}); await waitTick();
    assert.equal(cards.length,count+1);
    await manager.disconnect();
    assert.equal(fake.opened,false); assert.equal(manager.state.canWrite,false);
  } finally {
    await manager.disconnect();
    if (oldNavigator) Object.defineProperty(globalThis,'navigator',oldNavigator); else delete globalThis.navigator;
  }
  console.log('Reader tests passed: UID, identities, fragmented UTF-8 framing, invalid input, keyboard, USB handshake/write/cancel. No physical reader was used.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
