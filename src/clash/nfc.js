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
    if (!records.length) return { kind: 'blank' };
    const mime = records.find(record => record && record.recordType === 'mime' && String(record.mediaType || '').toLowerCase() === MIME);
    if (!mime) return { kind: 'unknown' };
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
    const now = opts.now || function () { return Date.now(); };
    const support = scanSupport(opts.env || {});
    const seen = new Map();
    let reader = null;
    let selected = null;
    let lastKind = '';
    let expectJson = '';
    let status = support.enabled ? '' : support.text;
    const log = [];

    function emit(text, extra) {
      status = text;
      log.push(Object.assign({ text, at: now() }, extra || {}));
      if (opts.onStatus) opts.onStatus(status, extra || {});
    }

    function remember(key, at) {
      const prev = seen.get(key);
      if (prev != null && at - prev < DEBOUNCE_MS) return true;
      seen.set(key, at);
      return false;
    }

    function handleReading(event) {
      const serial = event && typeof event.serialNumber === 'string' ? event.serialNumber : '';
      const found = classifyMessage(event && event.message, lookup);
      const key = debounceKey(serial, found.cardId);
      if (expectJson) {
        const note = serial ? [] : [TEXT.noUid, TEXT.noUidMore];
        if (found.kind === 'ready' && found.json === expectJson) {
          expectJson = '';
          lastKind = 'ready';
          seen.set(key, now());
          emit(['读到 ' + found.name].concat(note).join('。'), { kind: 'ready', card: found });
          return { kind: 'verified', card: found };
        }
        expectJson = '';
        lastKind = 'verify-failed';
        emit(TEXT.verify, { kind: 'verify-failed' });
        return { kind: 'verify-failed' };
      }
      if (remember(key, now())) return { ignored: true, kind: found.kind };
      const note = [];
      if (!serial) note.push(TEXT.noUid, TEXT.noUidMore);
      lastKind = found.kind;
      if (found.kind === 'ready') emit(['读到 ' + found.name].concat(note).join('。'), { kind: 'ready', card: found });
      else if (found.kind === 'blank') emit([TEXT.blank].concat(note).join('。'), { kind: 'blank' });
      else emit([TEXT.unknown, TEXT.occupied].concat(note).join('。'), { kind: 'unknown' });
      if (found.kind === 'ready' && opts.onReady) opts.onReady(found, { serial });
      return found;
    }

    async function start() {
      if (!support.enabled) {
        emit(support.text, { kind: support.reason });
        return support;
      }
      reader = opts.readerFactory();
      reader.addEventListener('reading', event => { handleReading(event); });
      reader.addEventListener('readingerror', () => {
        lastKind = 'failure';
        emit(TEXT.readFail, { kind: 'failure' });
      });
      try {
        await reader.scan();
      } catch (error) {
        lastKind = 'permission';
        emit(TEXT.permission, { kind: 'permission' });
        return { enabled: false, reason: 'permission', text: TEXT.permission };
      }
      emit(TEXT.start, { kind: 'scanning' });
      return { enabled: true, reason: 'scanning', text: TEXT.start };
    }

    async function writeSelected(force) {
      if (!selected) return { wrote: false, reason: 'no-selection' };
      if (!reader) return { wrote: false, reason: 'not-started' };
      if (lastKind === 'unknown' && !force) return { wrote: false, reason: 'needs-overwrite' };
      if (lastKind !== 'blank' && !(lastKind === 'unknown' && force)) return { wrote: false, reason: 'not-writable' };
      const message = messageFor(selected, opts.wikiBase || '');
      try {
        await reader.write({ records: message.records });
      } catch (error) {
        expectJson = '';
        emit(TEXT.readFail, { kind: 'write-failed' });
        return { wrote: false, reason: 'write-failed' };
      }
      expectJson = message.json;
      return { wrote: true, json: message.json };
    }

    return {
      TEXT,
      MIME,
      support,
      start,
      handleReading,
      select(card) { selected = card || null; },
      selected() { return selected; },
      lastKind() { return lastKind; },
      status() { return status; },
      log() { return log.slice(); },
      writeCard() { return writeSelected(false); },
      overwrite() { return writeSelected(true); },
      reader() { return reader; }
    };
  }

  const api = Object.freeze({
    MIME, DEBOUNCE_MS, TEXT, scanSupport, classifyMessage, messageFor, canonical, debounceKey, decideTap, createTapSession
  });
  root.PCGClashNfc = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
