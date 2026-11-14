/* Web NFC tap-to-play for pcg.clash.v0.
 * Bound to prompt commit 7e4c56675a93dfe759b81daa8582003ddf579aec.
 * Scanning does not change costs, combat or Chain. */
(function (root) {
  'use strict';
  const MIME = 'application/vnd.pulse.card+json';
  const DEBOUNCE_MS = 1500;
  const TEXT = Object.freeze({
    unsupported: '这台浏览器不能刷卡，仍可用拖拽或点选出牌',
    permission: '没有刷卡权限。可以改用拖拽或点选',
    blank: '这是空白卡，可以初始化',
    unknown: '这张卡不是脉冲对决的出牌记录',
    occupied: '卡上已有其他内容',
    overwrite: '仍然覆写',
    write: '写入这张卡',
    verify: '写入后校验失败',
    readFail: '没读到卡，请再贴一次',
    noUid: '这张卡没有可读序号',
    noUidMore: '两张相同的卡这时无法区分',
    notInHand: '手里没有这张牌',
    notNow: '现在不能替这一方操作',
    start: '开始刷卡'
  });

  function scanSupport(env) {
    const ua = String(env && env.ua || '');
    const android = /Android/i.test(ua);
    const chrome = /Chrome\/\d/i.test(ua) && !/Edg\/|OPR\/|SamsungBrowser|CriOS/i.test(ua);
    const hasApi = !!(env && env.NDEFReader);
    if (!(android && chrome && hasApi)) return { enabled: false, reason: 'unsupported', text: TEXT.unsupported };
    if (!env.secure) return { enabled: false, reason: 'insecure', text: TEXT.permission };
    return { enabled: true, reason: '', text: TEXT.start };
  }

  function bytesToText(data) {
    if (data == null) return '';
    if (typeof data === 'string') return data;
    const bytes = data.buffer ? new Uint8Array(data.buffer, data.byteOffset || 0, data.byteLength) : new Uint8Array(data);
    if (typeof TextDecoder === 'function') return new TextDecoder().decode(bytes);
    return Buffer.from(bytes).toString('utf8');
  }

  function textToBytes(text) {
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(text);
    return Uint8Array.from(Buffer.from(text, 'utf8'));
  }

  function canonical(body) {
    const out = { v: body.v, cardId: body.cardId };
    if (body.star != null) out.star = body.star;
    return JSON.stringify(out);
  }

  function classifyMessage(message, lookup) {
    const records = message && Array.isArray(message.records) ? message.records : [];
    if (!records.length || records.every(record => record && record.recordType === 'empty')) return { kind: 'blank' };
    const matches = records.filter(record => record && record.recordType === 'mime' && String(record.mediaType || '').toLowerCase() === MIME);
    if (matches.length !== 1) return { kind: 'unknown' };
    const mime = matches[0];
    let body;
    try { body = JSON.parse(bytesToText(mime.data)); }
    catch (error) { return { kind: 'unknown' }; }
    if (!body || typeof body !== 'object' || Array.isArray(body) || body.v !== 1 || typeof body.cardId !== 'string' || !body.cardId) {
      return { kind: 'unknown' };
    }
    const card = lookup(body.cardId);
    if (!card) return { kind: 'unknown' };
    if (body.star != null && body.star !== card.star) return { kind: 'unknown' };
    return {
      kind: 'ready',
      cardId: body.cardId,
      templateId: card.template_id,
      name: card.name,
      star: card.star == null ? null : card.star,
      json: canonical(body)
    };
  }

  function payloadFor(card) {
    const body = { v: 1, cardId: card.rid };
    if (card.star != null) body.star = card.star;
    return body;
  }

  function messageFor(card, wikiBase) {
    const json = canonical(payloadFor(card));
    const records = [{ recordType: 'mime', mediaType: MIME, data: textToBytes(json) }];
    if (wikiBase) {
      const base = String(wikiBase).replace(/\/$/, '');
      records.push({ recordType: 'url', data: base + '/cards/' + card.rid });
    }
    return { records, json };
  }

  function debounceKey(serial, cardId) {
    if (serial) return 'uid:' + serial;
    return 'card:' + (cardId || 'blank');
  }

  // The existing M5Dial reports raw NDEF as hex, including game-card MIME
  // records that its legacy identity parser classifies as "foreign".
  function classifyBridge(event, lookup) {
    if (!event || event.ndef === 'error') return { kind: 'failure' };
    if (event.descriptor) return { kind: 'identity' };
    if (event.ndef === 'blank') return { kind: 'blank' };
    const tag = event.tag || {};
    const hex = tag.ndef_hex;
    if (tag.ndef_hex_truncated || typeof hex !== 'string' || !/^(?:[0-9a-f]{2})+$/i.test(hex) || hex.length > 8192) return { kind: 'unknown' };
    const bytes = Uint8Array.from(hex.match(/../g), value => parseInt(value, 16));
    const records = [];
    let offset = 0, ended = false;
    try {
      const byte = () => { if (offset >= bytes.length) throw new Error('truncated'); return bytes[offset++]; };
      while (offset < bytes.length && !ended) {
        const flags = byte(), tnf = flags & 7, typeLength = byte();
        if (Boolean(flags & 128) !== (records.length === 0) || flags & 32 || tnf >= 6) throw new Error('unsupported framing');
        const length = flags & 16 ? byte() : byte() * 16777216 + byte() * 65536 + byte() * 256 + byte();
        const idLength = flags & 8 ? byte() : 0;
        if (offset + typeLength + idLength + length > bytes.length) throw new Error('truncated payload');
        const type = bytesToText(bytes.subarray(offset, offset + typeLength));
        offset += typeLength + idLength;
        const data = bytes.slice(offset, offset + length);
        offset += length;
        if (tnf === 0 && (typeLength || idLength || length)) throw new Error('invalid empty record');
        records.push({ recordType: tnf === 2 ? 'mime' : tnf === 0 ? 'empty' : 'unknown', mediaType: type, data });
        ended = !!(flags & 64);
      }
      if (!ended || offset !== bytes.length) return { kind: 'unknown' };
      return classifyMessage({ records }, lookup);
    } catch (_) { return { kind: 'unknown' }; }
  }

  function decideTap(state, found) {
    if (!state || !state.canAct) return { action: 'refuse', text: TEXT.notNow, code: 'not_your_turn' };
    if (!found || found.kind === 'blank') return { action: 'show', text: TEXT.blank };
    if (found.kind === 'unknown') return { action: 'show', text: TEXT.unknown };
    if (found.kind !== 'ready') return { action: 'show', text: TEXT.readFail };
    if (!state.hand || state.hand.indexOf(found.templateId) < 0) return { action: 'refuse', text: TEXT.notInHand, code: 'not_in_hand' };
    if (state.needsTarget) return { action: 'aim', templateId: found.templateId };
    return { action: 'play', templateId: found.templateId };
  }

  function createTapSession(options) {
    const opts = options || {};
    const lookup = opts.lookup || function () { return null; };
    const now = opts.now || (() => Date.now());
    const support = scanSupport(opts.env || {});
    const seen = new Map();
    let reader = null, scanAbort = null, writeAbort = null, verifyTimer = null;
    let selected = null, lastKind = '', lastSerial = '', expected = null;
    let active = false, starting = false, writing = false, epoch = 0;
    let status = support.enabled ? '' : support.text;
    const log = [];

    function emit(text, extra) {
      status = text;
      log.push(Object.assign({ text, at: now() }, extra || {}));
      if (log.length > 100) log.shift();
      if (opts.onStatus) opts.onStatus(status, extra || {});
    }
    function clearVerify() {
      clearTimeout(verifyTimer);
      verifyTimer = null;
      expected = null;
    }
    function verifyFailed() {
      clearVerify();
      lastKind = 'verify-failed';
      emit(TEXT.verify, { kind: lastKind });
    }
    function handleReading(event) {
      if (writing) return { ignored: true, kind: 'writing' };
      const serial = event && typeof event.serialNumber === 'string' ? event.serialNumber : '';
      const found = classifyMessage(event && event.message, lookup);
      const key = debounceKey(serial, found.cardId);
      if (expected) {
        if (expected.serial && serial !== expected.serial) {
          emit('请刷回刚才写入的同一张卡', { kind: 'verifying' });
          return { kind: 'wrong-card' };
        }
        if (found.kind !== 'ready' || found.json !== expected.json) {
          verifyFailed();
          return { kind: 'verify-failed' };
        }
        clearVerify();
        lastKind = 'ready';
        lastSerial = serial;
        seen.set(key, now());
        emit('写入并读回校验成功', { kind: 'verified', card: found });
        return { kind: 'verified', card: found };
      }
      const previous = seen.get(key);
      if (previous != null && now() - previous < DEBOUNCE_MS) return { ignored: true, kind: found.kind };
      seen.set(key, now());
      if (seen.size > 100) seen.delete(seen.keys().next().value);
      lastKind = found.kind;
      lastSerial = serial;
      const note = serial ? [] : [TEXT.noUid, TEXT.noUidMore];
      const text = found.kind === 'ready' ? '读到 ' + found.name : found.kind === 'blank' ? TEXT.blank : TEXT.unknown + '。' + TEXT.occupied;
      emit([text].concat(note).join('。'), { kind: found.kind, card: found });
      if (found.kind === 'ready' && opts.onReady) opts.onReady(found, { serial });
      return found;
    }

    function stop() {
      epoch++;
      if (scanAbort) scanAbort.abort();
      if (writeAbort) writeAbort.abort();
      clearVerify();
      reader = null; scanAbort = null; writeAbort = null;
      active = false; starting = false; writing = false;
      lastKind = ''; lastSerial = ''; seen.clear();
      emit('刷卡已停止', { kind: 'stopped' });
    }

    async function start() {
      if (!support.enabled) { emit(support.text, { kind: support.reason }); return support; }
      if (active || starting) return { enabled: true, reason: active ? 'scanning' : 'starting' };
      const generation = ++epoch;
      starting = true;
      lastKind = ''; lastSerial = ''; seen.clear();
      emit('正在请求 NFC 扫描权限…', { kind: 'starting' });
      try {
        reader = opts.readerFactory ? opts.readerFactory() : new root.NDEFReader();
        scanAbort = new AbortController();
        reader.addEventListener('reading', event => { if (generation === epoch) handleReading(event); });
        reader.addEventListener('readingerror', () => {
          if (generation !== epoch) return;
          if (expected) return verifyFailed();
          lastKind = 'failure'; lastSerial = '';
          emit(TEXT.readFail, { kind: 'failure' });
        });
        await reader.scan({ signal: scanAbort.signal });
        if (generation !== epoch) return { enabled: false, reason: 'cancelled' };
        active = true; starting = false;
        emit('扫描已开启，请贴近卡片', { kind: 'scanning' });
        return { enabled: true, reason: 'scanning' };
      } catch (error) {
        if (generation !== epoch) return { enabled: false, reason: 'cancelled' };
        if (scanAbort) scanAbort.abort();
        epoch++;
        reader = null; scanAbort = null; starting = false; active = false;
        lastKind = ['NotAllowedError', 'SecurityError'].includes(error.name) ? 'permission' : 'failure';
        emit(lastKind === 'permission' ? TEXT.permission : '无法开启 NFC，请检查手机 NFC 开关和设备支持', { kind: lastKind });
        return { enabled: false, reason: lastKind, text: status };
      }
    }

    async function writeSelected(force) {
      if (!selected) return { wrote: false, reason: 'no-selection' };
      if (!active || !reader) return { wrote: false, reason: 'not-started' };
      if (writing || expected) return { wrote: false, reason: 'busy' };
      if (['unknown', 'ready'].includes(lastKind) && !force) return { wrote: false, reason: 'needs-overwrite' };
      if (lastKind !== 'blank' && !(force && ['unknown', 'ready'].includes(lastKind))) return { wrote: false, reason: 'not-writable' };
      const message = messageFor(selected, opts.wikiBase || '');
      const serial = lastSerial, generation = epoch;
      const controller = new AbortController();
      writeAbort = controller; writing = true; lastKind = 'writing';
      emit('正在写入，请保持卡片贴近', { kind: 'writing' });
      const timer = setTimeout(() => controller.abort(), opts.timeoutMs || 20000);
      try {
        // Never let the default overwrite:true replace a different occupied tag.
        await reader.write({ records: message.records }, { overwrite: !!force, signal: controller.signal });
        if (generation !== epoch) return { wrote: false, reason: 'cancelled' };
        writing = false; writeAbort = null;
        expected = { json: message.json, serial };
        lastKind = 'verifying';
        emit('写入完成，请移开再刷同一张卡以校验', { kind: 'verifying' });
        verifyTimer = setTimeout(verifyFailed, opts.timeoutMs || 20000);
        return { wrote: true, verified: false, json: message.json };
      } catch (_) {
        if (generation !== epoch) return { wrote: false, reason: 'cancelled' };
        clearVerify(); writing = false; writeAbort = null; lastKind = 'write-failed';
        emit('写入未确认，请重新刷卡检查', { kind: 'write-failed' });
        return { wrote: false, reason: 'write-failed' };
      } finally { clearTimeout(timer); }
    }

    return {
      TEXT, MIME, support, start, stop, handleReading,
      select(card) { selected = card || null; },
      selected() { return selected; },
      lastKind() { return lastKind; },
      status() { return status; },
      active() { return active || starting; },
      busy() { return writing || !!expected; },
      log() { return log.slice(); },
      writeCard() { return writeSelected(false); },
      overwrite() { return writeSelected(true); },
      reader() { return reader; }
    };
  }

  const api = Object.freeze({
    MIME, DEBOUNCE_MS, TEXT, scanSupport, classifyMessage, messageFor, canonical, debounceKey, decideTap, createTapSession, classifyBridge
  });
  root.PCGClashNfc = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
