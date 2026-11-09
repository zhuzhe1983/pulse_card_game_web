'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const source = fs.readFileSync(path.join(__dirname, '../src/rtc.js'), 'utf8');
class FakeChannel {
  constructor(label = 'pcg-v1') { this.label = label; this.readyState = 'connecting'; this.ordered = true; this.maxRetransmits = null; this.maxPacketLifeTime = null; this.bufferedAmount = 0; this.sent = []; }
  open() { this.readyState = 'open'; if (this.onopen) this.onopen(); }
  send(text) { if (this.readyState !== 'open') throw Error('not open'); this.sent.push(text); }
  receive(data) { if (this.onmessage) this.onmessage({ data }); }
  close() { this.readyState = 'closed'; if (this.onclose) this.onclose(); }
}
function context({ gathering = 'complete', candidates = true } = {}) {
  const pcs = [];
  class FakePC {
    constructor(config) { this.config = config; this.signalingState = 'stable'; this.connectionState = 'new'; this.iceConnectionState = 'new'; this.iceGatheringState = gathering; this.listeners = new Set(); this.sctp = { maxMessageSize: 65536 }; pcs.push(this); }
    createDataChannel(label, options) { assert.equal(options.ordered, true); this.channel = new FakeChannel(label); return this.channel; }
    async createOffer() { return { type: 'offer', sdp: 'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n' + (candidates ? 'a=candidate:1 1 UDP 2122260223 192.0.2.1 50000 typ host\r\n' : '') }; }
    async createAnswer() { const sdp = (await this.createOffer()).sdp; return { type: 'answer', sdp }; }
    async setLocalDescription(desc) { this.localDescription = desc; this.signalingState = desc.type === 'offer' ? 'have-local-offer' : 'stable'; }
    async setRemoteDescription(desc) { this.remoteDescription = desc; this.signalingState = desc.type === 'offer' ? 'have-remote-offer' : 'stable'; }
    addEventListener(type, fn) { if (type === 'icegatheringstatechange') this.listeners.add(fn); }
    removeEventListener(type, fn) { if (type === 'icegatheringstatechange') this.listeners.delete(fn); }
    gathered() { this.iceGatheringState = 'complete'; for (const fn of Array.from(this.listeners)) fn(); }
    close() { this.signalingState = 'closed'; this.connectionState = 'closed'; }
  }
  const ctx = vm.createContext({ TextEncoder, TextDecoder, Uint8Array, setTimeout, clearTimeout, btoa, atob, crypto: require('node:crypto').webcrypto, RTCPeerConnection: FakePC });
  vm.runInContext(source, ctx);
  return { api: ctx.PCGRtc, pcs };
}
const hasCode = code => error => error.code === code;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

test('manual offer/answer preserves session and ordered channel exchange', async () => {
  const { api, pcs } = context();
  const hostStates = [], guestStates = [], incoming = [];
  let opened = 0;
  const host = new api.PeerSession({ iceServers: [], onState: s => hostStates.push(s.state), onMessage: p => incoming.push(p), onOpen: () => opened++ });
  const guest = new api.PeerSession({ iceServers: [], onState: s => guestStates.push(s.state) });
  const offer = await host.createOffer();
  assert.match(offer, /^PCGRTC1\./);
  const decoded = api.decodeSignal(offer, 'offer');
  assert.equal(decoded.session, host.sessionId);
  const answer = await guest.acceptOffer(offer);
  assert.equal(guest.sessionId, host.sessionId);
  await host.acceptAnswer(answer);
  assert.equal(host.role, 'host'); assert.equal(guest.role, 'guest');
  assert.equal(host.isOpen, false);
  pcs[0].channel.open(); pcs[0].channel.onopen();
  assert.equal(opened, 1); assert.equal(host.isOpen, true);
  const packet = api.makeEnvelope('PING', { sequence: 1 });
  assert.equal(host.send(packet), true);
  assert.deepEqual(JSON.parse(pcs[0].channel.sent[0]), { protocol: 'pcg.web.v1', type: 'PING', sequence: 1 });
  pcs[0].channel.receive(JSON.stringify(api.makeEnvelope('PONG', { sequence: 1 })));
  assert.equal(incoming[0].type, 'PONG');
  assert.ok(hostStates.includes('offer-ready')); assert.ok(hostStates.includes('connected')); assert.ok(guestStates.includes('answer-ready'));
  const gc = new FakeChannel(); pcs[1].ondatachannel({ channel: gc }); gc.open(); assert.equal(guest.isOpen, true);
  host.close(); guest.close(); host.close();
  assert.equal(host.isOpen, false); assert.equal(hostStates.at(-1), 'closed');
});

test('wrong-room answer and wrong-type code reject without consuming valid invitation', async () => {
  const { api } = context();
  const h1 = new api.PeerSession(), h2 = new api.PeerSession(), guest = new api.PeerSession();
  const o1 = await h1.createOffer(), o2 = await h2.createOffer();
  const answer = await guest.acceptOffer(o1);
  await assert.rejects(h2.acceptAnswer(answer), hasCode('SIGNAL_SESSION_MISMATCH'));
  await assert.rejects(h1.acceptAnswer(o1), hasCode('SIGNAL_TYPE'));
  await h1.acceptAnswer(answer);
  await assert.rejects(h1.acceptAnswer(answer), hasCode('SIGNAL_STATE'));
  await assert.rejects(h2.createOffer(), hasCode('SIGNAL_STATE'));
  assert.equal(api.decodeSignal(o2).type, 'offer');
  h1.close(); h2.close(); guest.close();
});

test('signaling parser bounds length and rejects broken/non-data signals', async () => {
  const { api } = context();
  assert.throws(() => api.decodeSignal('bad'), hasCode('SIGNAL_FORMAT'));
  assert.throws(() => api.decodeSignal('PCGRTC1.==='), hasCode('SIGNAL_FORMAT'));
  assert.throws(() => api.decodeSignal('x'.repeat(100001)), hasCode('SIGNAL_SIZE'));
  const host = new api.PeerSession(); const offer = await host.createOffer();
  assert.equal(api.decodeSignal('  ' + offer.slice(0, 50) + '\n' + offer.slice(50) + ' ').type, 'offer');
  const signal = api.decodeSignal(offer); signal.sdp += 'm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n';
  assert.throws(() => api.encodeSignal(signal), hasCode('SIGNAL_SDP')); host.close();
});

test('ICE gathering waits for completion, removes listener and rejects timeout/cancel', async () => {
  const { api, pcs } = context({ gathering: 'gathering' });
  const host = new api.PeerSession({ gatherTimeoutMs: 1000 });
  let ready = false; const promise = host.createOffer().then(code => { ready = true; return code; });
  await sleep(5); assert.equal(ready, false); assert.equal(pcs[0].listeners.size, 1);
  pcs[0].gathered(); await promise; assert.equal(pcs[0].listeners.size, 0); host.close();
  const timeout = new api.PeerSession({ gatherTimeoutMs: 5 });
  await assert.rejects(timeout.createOffer(), hasCode('ICE_GATHER_TIMEOUT')); timeout.close();
  const cancel = new api.PeerSession({ gatherTimeoutMs: 1000 });
  const pending = cancel.createOffer(); await sleep(5); cancel.close();
  await assert.rejects(pending, hasCode('SESSION_CLOSED')); assert.equal(pcs[2].listeners.size, 0);
});

test('packet validation and transport bound malformed input and queued bytes', async () => {
  const { api, pcs } = context(); const errors = [];
  const host = new api.PeerSession({ onError: error => errors.push(error.code) }); await host.createOffer();
  assert.throws(() => host.send(api.makeEnvelope('PING')), hasCode('CHANNEL_NOT_OPEN'));
  pcs[0].channel.open();
  assert.throws(() => host.send({ protocol: 'other', type: 'PING' }), hasCode('PROTOCOL_MISMATCH'));
  assert.throws(() => api.makeEnvelope('EXEC'), hasCode('MESSAGE_TYPE'));
  assert.throws(() => api.makeEnvelope('PING', { n: 1.5 }), hasCode('MESSAGE_NUMBER'));
  assert.throws(() => api.validateEnvelope(JSON.parse('{"protocol":"pcg.web.v1","type":"PING","__proto__":{}}')), hasCode('MESSAGE_KEY'));
  assert.throws(() => host.send(api.makeEnvelope('VIEW', { text: '中'.repeat(30000) })), hasCode('MESSAGE_SIZE'));
  pcs[0].sctp.maxMessageSize = 80;
  assert.throws(() => host.send(api.makeEnvelope('VIEW', { text: 'a'.repeat(100) })), hasCode('MESSAGE_SIZE'));
  pcs[0].sctp.maxMessageSize = 65536; pcs[0].channel.bufferedAmount = 262144;
  assert.throws(() => host.send(api.makeEnvelope('PING')), hasCode('CHANNEL_BUSY'));
  pcs[0].channel.receive('{ broken');
  assert.ok(errors.includes('MESSAGE_JSON')); assert.equal(host.isOpen, false); assert.equal(pcs[0].channel.readyState, 'closed');
});

test('unreliable, duplicate and wrong-label channels are rejected', async () => {
  const { api, pcs } = context(); const errors = [];
  const host = new api.PeerSession(), guest = new api.PeerSession({ onError: error => errors.push(error.code) });
  await guest.acceptOffer(await host.createOffer());
  const wrong = new FakeChannel('other'); pcs[1].ondatachannel({ channel: wrong }); assert.equal(wrong.readyState, 'closed');
  const unordered = new FakeChannel(); unordered.ordered = false; pcs[1].ondatachannel({ channel: unordered }); assert.equal(unordered.readyState, 'closed');
  const valid = new FakeChannel(); pcs[1].ondatachannel({ channel: valid }); valid.open();
  const duplicate = new FakeChannel(); pcs[1].ondatachannel({ channel: duplicate }); assert.equal(duplicate.readyState, 'closed');
  assert.equal(errors.length, 3); host.close(); guest.close();
});

test('connection timeout is observable and late connection can still complete', async () => {
  const { api, pcs } = context(); const states = [], errors = [];
  const host = new api.PeerSession({ connectTimeoutMs: 5, onState: s => states.push(s.state), onError: e => errors.push(e.code) });
  const guest = new api.PeerSession(); await host.acceptAnswer(await guest.acceptOffer(await host.createOffer()));
  await sleep(15); assert.ok(states.includes('timeout')); assert.ok(errors.includes('CONNECTION_TIMEOUT'));
  pcs[0].channel.open(); assert.equal(host.isOpen, true); host.close(); guest.close();
});

test('completed ICE gathering with no candidates fails instead of producing unusable codes', async () => {
  const valid = context(); const realCandidateHost = new valid.api.PeerSession();
  const offer = await realCandidateHost.createOffer();
  const { api } = context({ candidates: false }); const states = [], errors = [];
  const host = new api.PeerSession({ onState: s => states.push(s.state), onError: e => errors.push(e.code) });
  await assert.rejects(host.createOffer(), hasCode('NO_ICE_CANDIDATES'));
  assert.equal(states.includes('offer-ready'), false); assert.ok(errors.includes('NO_ICE_CANDIDATES'));
  const guestStates = [];
  const guest = new api.PeerSession({ onState: s => guestStates.push(s.state) });
  await assert.rejects(guest.acceptOffer(offer), hasCode('NO_ICE_CANDIDATES'));
  assert.equal(guestStates.includes('answer-ready'), false);
  host.close(); guest.close(); realCandidateHost.close();
});
