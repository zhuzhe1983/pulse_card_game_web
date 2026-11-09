/* PULSE CARD GAME · manual WebRTC signaling and bounded JSON transport.
 * No signaling server, build tool, package or CDN is needed. See docs/NETWORK.md.
 */
(function (root) {
  'use strict';
  const PROTOCOL = 'pcg.web.v1';
  const CHANNEL = 'pcg-v1';
  const SIGNAL_PREFIX = 'PCGRTC1.';
  const MAX_PACKET_BYTES = 65536;
  const MAX_SDP_LENGTH = 65536;
  const MAX_SIGNAL_LENGTH = 100000;
  const MAX_BUFFERED_BYTES = 262144;
  const TYPES = new Set(['HELLO', 'READY', 'START', 'VIEW', 'ACTION', 'RESULT', 'RESYNC', 'ERROR', 'PING', 'PONG']);
  const encoder = new TextEncoder();
  const decoder = new TextDecoder('utf-8', { fatal: true });

  class RTCError extends Error {
    constructor(code, message) { super(message || code); this.name = 'RTCError'; this.code = code; }
  }
  function fail(code, message) { throw new RTCError(code, message); }
  function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
  function validateTree(value, depth) {
    if (depth > 24) fail('MESSAGE_DEPTH', '消息嵌套过深。');
    if (value === null || typeof value === 'boolean') return;
    if (typeof value === 'number') {
      if (!Number.isSafeInteger(value)) fail('MESSAGE_NUMBER', '游戏消息只能使用安全整数。');
      return;
    }
    if (typeof value === 'string') {
      if (value.length > MAX_PACKET_BYTES) fail('MESSAGE_SIZE', '消息文字过长。');
      return;
    }
    if (Array.isArray(value)) {
      if (value.length > 1024) fail('MESSAGE_ARRAY', '消息数组过长。');
      value.forEach(item => validateTree(item, depth + 1)); return;
    }
    if (!object(value)) fail('MESSAGE_VALUE', '消息含有不支持的值。');
    const keys = Object.keys(value);
    if (keys.length > 128) fail('MESSAGE_KEYS', '消息字段过多。');
    for (const key of keys) {
      if (key === '__proto__' || key === 'prototype' || key === 'constructor') fail('MESSAGE_KEY', '消息字段无效。');
      validateTree(value[key], depth + 1);
    }
  }
  function validateEnvelope(packet) {
    if (!object(packet) || packet.protocol !== PROTOCOL) fail('PROTOCOL_MISMATCH', '对方使用了不同的通讯协议，请双方使用同一版本。');
    if (!TYPES.has(packet.type)) fail('MESSAGE_TYPE', '不支持的通讯消息。');
    validateTree(packet, 0);
    return packet;
  }
  function makeEnvelope(type, payload) {
    if (payload !== undefined && !object(payload)) fail('MESSAGE_PAYLOAD', '消息内容必须是对象。');
    return validateEnvelope(Object.assign({}, payload || {}, { protocol: PROTOCOL, type }));
  }
  function encodeBase64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function decodeBase64(value) {
    if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) fail('SIGNAL_FORMAT', '连接码格式不正确。');
    let binary;
    try { binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)); }
    catch (_) { fail('SIGNAL_FORMAT', '连接码损坏，请完整复制。'); }
    return Uint8Array.from(binary, c => c.charCodeAt(0));
  }
  function validateSignal(signal, expectedType) {
    if (!object(signal) || signal.v !== 1 || !['offer', 'answer'].includes(signal.type)) fail('SIGNAL_VERSION', '连接码版本或类型不支持。');
    if (Object.keys(signal).sort().join(',') !== 'sdp,session,type,v') fail('SIGNAL_FIELDS', '连接码字段无效。');
    if (expectedType && signal.type !== expectedType) fail('SIGNAL_TYPE', expectedType === 'offer' ? '这里需要房主的邀请连接码。' : '这里需要对方的回复连接码。');
    if (typeof signal.session !== 'string' || !/^[a-f0-9]{32}$/.test(signal.session)) fail('SIGNAL_SESSION', '连接码的房间标识无效。');
    if (typeof signal.sdp !== 'string' || signal.sdp.length < 32 || signal.sdp.length > MAX_SDP_LENGTH || !/^v=0\r?\n/.test(signal.sdp) || !/(?:\r?\n)m=application /.test(signal.sdp) || /(?:\r?\n)m=(?:audio|video) /.test(signal.sdp)) fail('SIGNAL_SDP', '这不是游戏数据连接码。');
    return signal;
  }
  function encodeSignal(signal) {
    validateSignal(signal);
    return SIGNAL_PREFIX + encodeBase64(encoder.encode(JSON.stringify(signal)));
  }
  function decodeSignal(code, expectedType) {
    if (typeof code !== 'string' || code.length > MAX_SIGNAL_LENGTH) fail('SIGNAL_SIZE', '连接码为空或过长。');
    const compact = code.replace(/\s/g, '');
    if (!compact.startsWith(SIGNAL_PREFIX)) fail('SIGNAL_FORMAT', '请粘贴以 PCGRTC1. 开头的完整连接码。');
    let signal;
    try { signal = JSON.parse(decoder.decode(decodeBase64(compact.slice(SIGNAL_PREFIX.length)))); }
    catch (error) { if (error instanceof RTCError) throw error; fail('SIGNAL_FORMAT', '连接码损坏，请重新复制。'); }
    return validateSignal(signal, expectedType);
  }
  function sessionID() {
    const bytes = new Uint8Array(16);
    if (!root.crypto || !root.crypto.getRandomValues) fail('CRYPTO_UNAVAILABLE', '浏览器缺少随机数接口，请使用现代浏览器和 localhost 或 HTTPS。');
    root.crypto.getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  }

  class PeerSession {
    constructor(options) {
      options = options || {};
      this.onMessage = options.onMessage || function () {};
      this.onState = options.onState || function () {};
      this.onError = options.onError || function () {};
      this.onOpen = options.onOpen || function () {};
      this.iceServers = options.iceServers === undefined ? [{ urls: 'stun:stun.l.google.com:19302' }] : options.iceServers;
      if (!Array.isArray(this.iceServers) || this.iceServers.length > 8) fail('ICE_CONFIG', 'ICE 服务器配置无效。');
      this.gatherTimeoutMs = options.gatherTimeoutMs || 20000;
      this.connectTimeoutMs = options.connectTimeoutMs || 60000;
      this._role = null;
      this._pc = null;
      this._channel = null;
      this._closed = false;
      this._busy = false;
      this._session = null;
      this._connectTimer = null;
      this._gatherCancel = null;
      this._opened = false;
    }
    get isOpen() { return !this._closed && !!this._channel && this._channel.readyState === 'open'; }
    get role() { return this._role; }
    get sessionId() { return this._session; }
    _emit(state, message) { this.onState({ state, message: message || state, role: this._role }); }
    _report(error) {
      if (!(error instanceof Error)) error = new RTCError('RTC_FAILURE', String(error));
      this.onError(error); return error;
    }
    _start(role) {
      if (this._closed) fail('SESSION_CLOSED', '连接已关闭，请重新创建连接。');
      if (this._pc || this._busy) fail('SIGNAL_STATE', '当前连接已经开始，请先断开再重试。');
      if (typeof root.RTCPeerConnection !== 'function') fail('RTC_UNAVAILABLE', '此浏览器不支持 WebRTC 数据连接。');
      this._role = role;
      this._pc = new root.RTCPeerConnection({ iceServers: this.iceServers });
      this._pc.onconnectionstatechange = () => this._connectionChanged();
      this._pc.oniceconnectionstatechange = () => this._connectionChanged();
      this._pc.ondatachannel = event => {
        if (this._role !== 'guest' || this._channel || event.channel.label !== CHANNEL || event.channel.ordered === false || event.channel.maxRetransmits != null || event.channel.maxPacketLifeTime != null) {
          event.channel.close(); this._report(new RTCError('CHANNEL_UNEXPECTED', '对方打开了不支持的数据通道。')); return;
        }
        this._attachChannel(event.channel);
      };
      this._emit('creating', role === 'host' ? '正在创建邀请连接码…' : '正在处理邀请连接码…');
    }
    _connectionChanged() {
      if (this._closed || !this._pc) return;
      const connection = this._pc.connectionState;
      const ice = this._pc.iceConnectionState;
      if (connection === 'connected' || ice === 'connected' || ice === 'completed') {
        this._clearConnectTimer();
        if (!this.isOpen) this._emit('connecting', '网络已连接，正在打开游戏通道…');
      } else if (connection === 'failed' || ice === 'failed') {
        this._clearConnectTimer();
        this._emit('failed', '无法建立直连。可尝试同一网络，或配置 TURN 后重新连接。');
      } else if (connection === 'disconnected' || ice === 'disconnected') {
        this._emit('disconnected', '连接暂时中断，等待网络恢复…');
        this._armConnectTimer();
      } else if (connection === 'connecting' || ice === 'checking') {
        this._emit('connecting', '正在建立双方直连…');
        this._armConnectTimer();
      } else if (connection === 'closed') {
        this.close();
      }
    }
    _armConnectTimer() {
      if (this._connectTimer || this.isOpen || this._closed) return;
      this._connectTimer = setTimeout(() => {
        this._connectTimer = null;
        if (!this.isOpen && !this._closed) {
          this._emit('timeout', '连接仍未成功。请检查回复连接码；跨网络可能需要 TURN。');
          this._report(new RTCError('CONNECTION_TIMEOUT', '连接等待超时，可继续等待或重新建立连接。'));
        }
      }, this.connectTimeoutMs);
    }
    _clearConnectTimer() { if (this._connectTimer) clearTimeout(this._connectTimer); this._connectTimer = null; }
    _attachChannel(channel) {
      this._channel = channel;
      channel.binaryType = 'arraybuffer';
      channel.bufferedAmountLowThreshold = 32768;
      channel.onopen = () => {
        if (this._closed || this._opened) return;
        this._opened = true;
        this._clearConnectTimer();
        this._emit('connected', '游戏通道已连接。');
        this.onOpen();
      };
      channel.onclose = () => {
        this._clearConnectTimer();
        if (!this._closed) this._emit('disconnected', '对方的数据通道已关闭，请重新建立连接。');
      };
      channel.onerror = event => this._report(new RTCError('CHANNEL_ERROR', event.error && event.error.message || '游戏数据通道发生错误。'));
      channel.onmessage = event => {
        if (this._closed) return;
        let packet;
        try {
          if (typeof event.data !== 'string') fail('MESSAGE_ENCODING', '只接受 UTF-8 JSON 文本消息。');
          if (event.data.length > MAX_PACKET_BYTES || encoder.encode(event.data).byteLength > MAX_PACKET_BYTES) fail('MESSAGE_SIZE', '收到的消息超过 64 KiB 限制。');
          packet = root.PCGEngine && root.PCGEngine.parseJSON ? root.PCGEngine.parseJSON(event.data, MAX_PACKET_BYTES) : JSON.parse(event.data);
          validateEnvelope(packet);
        } catch (error) {
          this._report(error instanceof RTCError ? error : new RTCError('MESSAGE_JSON', '收到的消息不是有效 JSON。'));
          this.close(); return;
        }
        try { this.onMessage(packet); }
        catch (error) { this._report(error); }
      };
      if (channel.readyState === 'open') channel.onopen();
    }
    _gather() {
      const pc = this._pc;
      if (pc.iceGatheringState === 'complete') return Promise.resolve();
      this._emit('gathering', '正在收集网络地址，请稍候…');
      return new Promise((resolve, reject) => {
        let done = false;
        const finish = error => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          pc.removeEventListener('icegatheringstatechange', changed);
          this._gatherCancel = null;
          error ? reject(error) : resolve();
        };
        const changed = () => { if (pc.iceGatheringState === 'complete') finish(); };
        const timer = setTimeout(() => finish(new RTCError('ICE_GATHER_TIMEOUT', '网络地址收集超时。可关闭公共 STUN 后尝试局域网连接，或检查 ICE 配置。')), this.gatherTimeoutMs);
        this._gatherCancel = () => finish(new RTCError('SESSION_CLOSED', '连接已取消。'));
        pc.addEventListener('icegatheringstatechange', changed);
        changed();
      });
    }
    _localCode(type) {
      if (this._closed || !this._pc || !this._pc.localDescription) fail('SESSION_CLOSED', '连接已取消。');
      if (!/(?:^|\r?\n)a=candidate:[^\r\n]+/.test(this._pc.localDescription.sdp)) fail('NO_ICE_CANDIDATES', '没有获得可用网络地址，当前浏览器或网络可能限制 WebRTC；可尝试普通浏览器、同一网络或配置 TURN，但不保证连接成功。');
      return encodeSignal({ v: 1, session: this._session, type, sdp: this._pc.localDescription.sdp });
    }
    async createOffer() {
      try {
        this._start('host'); this._busy = true; this._session = sessionID();
        this._attachChannel(this._pc.createDataChannel(CHANNEL, { ordered: true }));
        await this._pc.setLocalDescription(await this._pc.createOffer());
        await this._gather();
        const code = this._localCode('offer');
        this._emit('offer-ready', '邀请连接码已生成，请发送给对方，再粘贴对方的回复连接码。');
        return code;
      } catch (error) { throw this._report(error); }
      finally { this._busy = false; }
    }
    async acceptOffer(code) {
      try {
        const offer = decodeSignal(code, 'offer');
        this._start('guest'); this._busy = true; this._session = offer.session;
        await this._pc.setRemoteDescription({ type: offer.type, sdp: offer.sdp });
        await this._pc.setLocalDescription(await this._pc.createAnswer());
        await this._gather();
        const answer = this._localCode('answer');
        this._emit('answer-ready', '回复连接码已生成，请发送给房主。双方都保持此页面打开。');
        return answer;
      } catch (error) { throw this._report(error); }
      finally { this._busy = false; }
    }
    async acceptAnswer(code) {
      try {
        if (this._closed || this._role !== 'host' || !this._pc || this._busy || this._pc.signalingState !== 'have-local-offer') fail('SIGNAL_STATE', '请先创建邀请连接码，然后等待对方回复。');
        const answer = decodeSignal(code, 'answer');
        if (answer.session !== this._session) fail('SIGNAL_SESSION_MISMATCH', '这份回复不属于当前邀请，请双方重新复制对应的连接码。');
        this._busy = true;
        await this._pc.setRemoteDescription({ type: answer.type, sdp: answer.sdp });
        this._emit('connecting', '已接收回复，正在连接对方…');
        this._armConnectTimer();
      } catch (error) { throw this._report(error); }
      finally { this._busy = false; }
    }
    send(packet) {
      try {
        if (!this.isOpen) fail('CHANNEL_NOT_OPEN', '游戏通道尚未连接。');
        validateEnvelope(packet);
        const text = JSON.stringify(packet);
        const bytes = encoder.encode(text).byteLength;
        const negotiated = this._pc && this._pc.sctp && this._pc.sctp.maxMessageSize;
        const limit = negotiated > 0 ? Math.min(MAX_PACKET_BYTES, negotiated) : MAX_PACKET_BYTES;
        if (bytes > limit) fail('MESSAGE_SIZE', '消息超过数据通道的大小限制。');
        if (this._channel.bufferedAmount + bytes > MAX_BUFFERED_BYTES) fail('CHANNEL_BUSY', '网络发送队列已满，请稍后重试同一操作。');
        this._channel.send(text);
        return true;
      } catch (error) { throw this._report(error); }
    }
    close() {
      if (this._closed) return;
      this._closed = true;
      this._clearConnectTimer();
      if (this._gatherCancel) this._gatherCancel();
      if (this._channel && this._channel.readyState !== 'closed') this._channel.close();
      if (this._pc && this._pc.signalingState !== 'closed') this._pc.close();
      this._emit('closed', '连接已断开。');
    }
  }
  root.PCGRtc = Object.freeze({ PeerSession, RTCError, makeEnvelope, validateEnvelope, encodeSignal, decodeSignal, PROTOCOL, CHANNEL, MAX_PACKET_BYTES });
})(typeof globalThis !== 'undefined' ? globalThis : window);
