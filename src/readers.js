/* PULSE reader adapters. No framework, no server, no implicit tag writes. */
(function (root) {
  'use strict';
  const PROTOCOL = 'pcg.reader.v1';
  const MIME = 'application/vnd.pcg.identity+json';
  const MAX_LINE = 4096;
  const MAX_PAYLOAD = 384;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const encoder = new TextEncoder();
  const writeErrors = {
    'card removed or changed': '卡片已移开或更换，请移开再刷。',
    'NTAG215 required': '需要 NTAG215 卡，请换卡后重试。',
    'standard NTAG215 CC required': '需要 NTAG215 卡，请换卡后重试。',
    'card locked or protected': '卡片已锁定或受保护，请换空白卡。',
    'card is not blank': '卡上已有内容，请换一张空白卡。',
    'readback failed': '写卡未通过读回校验，请移开再刷检查。',
    'page write failed': '写入失败，请保持卡片贴近读卡器，移开再刷检查。',
    'incomplete memory': '写入失败，请保持卡片贴近读卡器，移开再刷检查。'
  };

  class ReaderError extends Error {
    constructor(code, message) { super(message || code); this.name = 'ReaderError'; this.code = code; }
  }
  const fail = (code, message) => { throw new ReaderError(code, message); };
  const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);

  function normalizeUID(value) {
    if (value instanceof Uint8Array || Array.isArray(value)) {
      if (![4, 7, 10].includes(value.length) || Array.from(value).some(x => !Number.isInteger(x) || x < 0 || x > 255)) {
        fail('UID_FORMAT', 'UID 必须是 NFC-A 的 4、7 或 10 字节编号。');
      }
      return Array.from(value, x => x.toString(16).padStart(2, '0')).join('').toUpperCase();
    }
    if (typeof value !== 'string' || value.length > 80) fail('UID_FORMAT', '读卡器没有返回有效 UID。');
    const uid = value.trim().replace(/^0x/i, '').replace(/[\s:-]/g, '').toUpperCase();
    if (!/^(?:[0-9A-F]{8}|[0-9A-F]{14}|[0-9A-F]{20})$/.test(uid)) {
      fail('UID_FORMAT', '请输入十六进制 UID（4、7 或 10 字节）。十进制读卡器需要先设置为十六进制输出。');
    }
    return uid;
  }

  function parseDescriptor(value) {
    if (value instanceof Uint8Array || value instanceof DataView || value instanceof ArrayBuffer) {
      try { value = new TextDecoder('utf-8', { fatal: true }).decode(value); }
      catch (_) { fail('DESCRIPTOR_ENCODING', '卡片描述不是有效 UTF-8。'); }
    }
    if (typeof value === 'string') {
      if (encoder.encode(value).length > MAX_PAYLOAD) fail('DESCRIPTOR_SIZE', '身份数据超出 384 字节上限。');
      try { value = JSON.parse(value); }
      catch (_) { fail('DESCRIPTOR_JSON', '卡片身份 JSON 无法读取。'); }
    }
    if (!object(value) || value.game !== 'pcg' || value.v !== 1 || typeof value.id !== 'string' || !UUID.test(value.id)) {
      fail('DESCRIPTOR_FORMAT', '卡片身份格式或版本不兼容。');
    }
    let result;
    if (value.type === 'player') {
      if (typeof value.skin !== 'string' || !/^0[1-9]$/.test(value.skin)) fail('DESCRIPTOR_SKIN', '玩家卡面编号应为 01–09。');
      if (Object.keys(value).some(k => !['game', 'v', 'type', 'id', 'skin', 'name'].includes(k))) fail('DESCRIPTOR_FIELDS', '身份卡包含不支持的字段。');
      result = { game: 'pcg', v: 1, type: 'player', id: value.id.toLowerCase(), skin: value.skin };
      if (value.name !== undefined) {
        if (typeof value.name !== 'string' || Array.from(value.name).length > 24 || /[\u0000-\u001F\u007F]/.test(value.name)) fail('DESCRIPTOR_NAME', '玩家名称最多 24 字且不能包含控制字符。');
        result.name = value.name;
      }
    } else if (value.type === 'hero') {
      if (Object.keys(value).some(k => !['game', 'v', 'type', 'id', 'mode', 'template_id'].includes(k))) fail('DESCRIPTOR_FIELDS', '英雄卡包含不支持的字段。');
      if (!['blind', 'fixed'].includes(value.mode)) fail('DESCRIPTOR_MODE', '英雄卡模式应为 blind 或 fixed。');
      result = { game: 'pcg', v: 1, type: 'hero', id: value.id.toLowerCase(), mode: value.mode };
      if (value.mode === 'fixed') {
        if (typeof value.template_id !== 'string' || !/^[a-z0-9][a-z0-9_.-]{0,63}$/.test(value.template_id)) fail('DESCRIPTOR_HERO', '指定英雄编号无效。');
        result.template_id = value.template_id;
      } else if (value.template_id !== undefined) fail('DESCRIPTOR_HERO', '盲盒卡不能同时指定英雄。');
    } else fail('DESCRIPTOR_TYPE', '不是 PULSE 玩家卡或英雄卡。');
    if (encoder.encode(JSON.stringify(result)).length > MAX_PAYLOAD) fail('DESCRIPTOR_SIZE', '身份数据超出 384 字节上限。');
    return result;
  }

  function encodeDescriptor(value) { return encoder.encode(JSON.stringify(parseDescriptor(value))); }

  // Byte-based framing preserves split UTF-8 characters and bounds memory before decoding.
  class JsonLineDecoder {
    constructor(maxLine = MAX_LINE) {
      if (!Number.isInteger(maxLine) || maxLine < 16 || maxLine > 65536) fail('FRAME_LIMIT', 'Invalid frame limit');
      this.limit = maxLine; this.buffer = new Uint8Array(maxLine); this.length = 0;
    }
    reset() { this.length = 0; }
    push(value) {
      let bytes;
      if (value instanceof DataView) bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      else if (value instanceof Uint8Array) bytes = value;
      else if (value instanceof ArrayBuffer) bytes = new Uint8Array(value);
      else fail('FRAME_TYPE', 'Reader must return bytes');
      if (bytes.length > 65536) { this.reset(); fail('FRAME_SIZE', '单次读卡数据过大。'); }
      const messages = [];
      for (const b of bytes) {
        if (b === 10) {
          let n = this.length;
          if (n && this.buffer[n - 1] === 13) n--;
          this.length = 0;
          if (!n) continue;
          let value;
          try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(this.buffer.subarray(0, n))); }
          catch (_) { fail('FRAME_JSON', '读卡器返回了无效 UTF-8 或 JSON。'); }
          if (!object(value)) fail('FRAME_OBJECT', '读卡器消息必须是 JSON 对象。');
          messages.push(value);
          if (messages.length > 128) fail('FRAME_RATE', '读卡器返回消息过多。');
        } else {
          if (this.length >= this.limit) { this.reset(); fail('FRAME_SIZE', '读卡器单条消息超出 4096 字节。'); }
          this.buffer[this.length++] = b;
        }
      }
      return messages;
    }
  }

  function capabilities() {
    const nav = root.navigator || {};
    return { secure: root.isSecureContext !== false, webusb: !!nav.usb, serial: !!nav.serial, webnfc: typeof root.NDEFReader === 'function', keyboard: true };
  }

  // The top-bar dot is green only after hello. Chrome's "已配对" is an
  // earlier permission grant and is not one of these states.
  function lampOn(state) { return state === 'connected' || state === 'reading'; }
  function connectionLabel(state) {
    if (lampOn(state)) return '已连接';
    if (state === 'connecting') return '握手中';
    if (state === 'error') return '未连上';
    return '未连接';
  }
  // 1200 baud plus a DTR drop is the ESP ROM reset gesture. Never use it.
  function serialOpenPlan(baudRate) {
    if (baudRate === 1200) return { ok: false, reason: '1200' };
    return { ok: true, baudRate, dtrToggle: false };
  }

  class ReaderManager {
    constructor({ onCard = () => {}, onStatus = () => {}, onRemoved = () => {}, onDeviceStatus = () => {} } = {}) {
      this.onCard = onCard; this.onStatus = onStatus; this.onRemoved = onRemoved; this.onDeviceStatus = onDeviceStatus;
      this.state = { state: 'disconnected', source: null, message: '尚未连接读卡器', canWrite: false };
      this._epoch = 0; this._pending = new Map(); this._source = null;
      this._lastSignature = ''; this._lastAt = 0; this._lastUID = null;
      this._writeBusy = false;
    }
    _status(state, source, message, canWrite = false) {
      this.state = { state, source, message, canWrite: !!canWrite, firmware: this._firmware || null, writeMode: this._writeMode || null, feedback: !!this._feedback, sound: this._sound !== false };
      this.onStatus(this.state);
    }
    _secure() {
      if (root.isSecureContext === false) fail('INSECURE_CONTEXT', '请用 localhost 或 HTTPS 打开网页，再连接读卡器。');
    }
    _emitCard(event, continuous = false) {
      const uid = event.uid ? normalizeUID(event.uid) : null;
      const descriptor = event.descriptor == null ? null : parseDescriptor(event.descriptor);
      if (!uid && !descriptor) fail('CARD_ID_MISSING', '卡片没有可用 UID 或 PULSE 身份记录。');
      const signature = (uid || '') + '|' + (descriptor ? JSON.stringify(descriptor) : '');
      const now = Date.now();
      if (signature === this._lastSignature && (continuous || now - this._lastAt < 900)) return null;
      this._lastSignature = signature; this._lastAt = now; this._lastUID = uid;
      const card = { uid, source: event.source, descriptor, tech: 'nfc-a', ndef: event.ndef || (descriptor ? 'pulse' : 'unknown'), tag: object(event.tag) ? event.tag : null };
      this._lastCard = card;
      if (this._writeBusy) return card;
      try {
        Promise.resolve(this.onCard(card)).catch(error => this._status('error', event.source, error.message || '处理刷卡结果失败。', this.state.canWrite));
      } catch (error) { this._status('error', event.source, error.message || '处理刷卡结果失败。', this.state.canWrite); }
      return card;
    }
    feedKeyboard(text) {
      const uid = normalizeUID(text);
      if (!this._source) this._status('connected', 'keyboard', '已接收键盘读卡器 UID；此模式只读', false);
      return this._emitCard({ uid, source: 'keyboard', descriptor: null });
    }
    _waitHello() {
      let timer;
      const promise = new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new ReaderError('BRIDGE_TIMEOUT', '设备没有回答 PCG bridge 握手。普通 USB NFC/CCID 读卡器不能直接用于此连接。')), 5000);
        this._hello = { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } };
      });
      // A transport may fail before connect() reaches its await.
      promise.catch(() => {});
      return promise;
    }
    _bridgeMessage(message) {
      if (message.type === 'hello') {
        if (message.protocol !== PROTOCOL || !Array.isArray(message.capabilities) || !message.capabilities.includes('uid') || message.capabilities.some(x => !['uid', 'ndef_read', 'ndef_write'].includes(x))) fail('BRIDGE_VERSION', '读卡桥协议不兼容。');
        this._firmware = typeof message.firmware === 'string' ? message.firmware : null;
        this._writeMode = message.write_mode === 'blank-player-v1' ? message.write_mode : null;
        this._feedback = message.feedback === true;
        this._bridgeReady = true;
        this._canWrite = message.capabilities.includes('ndef_read') && message.capabilities.includes('ndef_write');
        if (this._hello) { this._hello.resolve(message); this._hello = null; }
        return;
      }
      if (!this._bridgeReady) fail('BRIDGE_HANDSHAKE', '读卡桥必须先完成 hello 握手。');
      if (message.type === 'status') {
        const phases = ['idle','reading','blank','pulse','game','foreign','unformatted','unsupported','error','writing','verifying','write_ok','write_error'];
        if (!phases.includes(message.phase)) return;
        this.onDeviceStatus({ phase: message.phase, uid: message.uid || '', progress: Number.isInteger(message.progress) ? Math.max(-1,Math.min(100,message.progress)) : -1 });
        return;
      }
      if (message.type === 'diag') { if (typeof message.sound === 'boolean') {this._sound=message.sound;this.state.sound=message.sound;} this.onDeviceStatus({ diagnostic: message }); return; }
      if (message.type === 'feedback') { this._sound = message.sound !== false; this.state.sound = this._sound; this.onDeviceStatus({ sound: this._sound }); return; }
      if (message.type === 'removed') { this._lastSignature = ''; this._lastUID = null; this._lastCard = null; this.onRemoved(); return; }
      if (message.type === 'card') {
        if (message.tech !== undefined && message.tech !== 'nfc-a') fail('CARD_TECH', '当前版本只接收 NFC-A 卡。');
        this._emitCard({ uid: message.uid, source: this._source, descriptor: message.descriptor == null ? null : message.descriptor, ndef: typeof message.ndef === 'string' ? message.ndef : '', tag: message.tag }, true);
      } else if (message.type === 'write_result') {
        const pending = this._pending.get(message.request_id);
        if (!pending) return;
        this._pending.delete(message.request_id); clearTimeout(pending.timer);
        if (message.ok !== true) pending.reject(new ReaderError('WRITE_FAILED', writeErrors[message.error] || (typeof message.error === 'string' ? message.error.slice(0,160) : '读卡桥写入失败。')));
        else {
          try {
            if (pending.requireVerified && message.verified !== true) fail('WRITE_VERIFY', '固件未返回读回校验结果。');
            const uid = normalizeUID(message.uid);
            const descriptor = parseDescriptor(message.descriptor);
            if (uid !== pending.uid || JSON.stringify(descriptor) !== JSON.stringify(pending.descriptor)) fail('WRITE_VERIFY', '读回身份与待写内容不一致，未确认写入。');
            this._lastCard = Object.assign({}, this._lastCard, { uid, descriptor, ndef: 'pulse' });
            pending.resolve({ verified: true, uid, descriptor });
          } catch (error) { pending.reject(error); }
        }
      } else if (message.type === 'error') {
        fail('BRIDGE_ERROR', typeof message.message === 'string' ? message.message.slice(0, 160) : '读卡桥报告错误。');
      } else fail('BRIDGE_MESSAGE', '未知读卡桥消息。');
    }
    async connectUSB({ vendorId, productId } = {}) {
      this._secure();
      if (!root.navigator || !root.navigator.usb) fail('WEBUSB_UNAVAILABLE', '此浏览器不支持 WebUSB。可使用 Chrome/Edge 或键盘 UID 模式。');
      const filter = { classCode: 0xff };
      if (vendorId !== undefined) {
        if (!Number.isInteger(vendorId) || vendorId < 0 || vendorId > 65535) fail('USB_FILTER', 'vendorId 无效。');
        filter.vendorId = vendorId;
      }
      if (productId !== undefined) {
        if (vendorId === undefined || !Number.isInteger(productId) || productId < 0 || productId > 65535) fail('USB_FILTER', 'productId 需要有效 vendorId。');
        filter.productId = productId;
      }
      // Call from a button: requestDevice requires transient user activation.
      const device = await root.navigator.usb.requestDevice({ filters: [filter] });
      await this.disconnect();
      const epoch = ++this._epoch;
      this._source = 'webusb'; this._usb = device;
      this._status('connecting', 'webusb', '正在连接 PCG USB 读卡桥…');
      try {
        await device.open();
        if (!device.configuration) await device.selectConfiguration(device.configurations[0].configurationValue);
        let chosen;
        for (const iface of device.configuration.interfaces) {
          for (const alt of iface.alternates) {
            const input = alt.endpoints.find(e => e.type === 'bulk' && e.direction === 'in');
            const output = alt.endpoints.find(e => e.type === 'bulk' && e.direction === 'out');
            if (alt.interfaceClass === 0xff && input && output) { chosen = { iface, alt, input, output }; break; }
          }
          if (chosen) break;
        }
        if (!chosen) fail('USB_PROFILE', '请选择带 vendor-specific bulk IN/OUT 接口的 PCG 读卡桥。通用 CCID/ACR122U 不属于此驱动。');
        await device.claimInterface(chosen.iface.interfaceNumber);
        if (chosen.iface.alternate.alternateSetting !== chosen.alt.alternateSetting) await device.selectAlternateInterface(chosen.iface.interfaceNumber, chosen.alt.alternateSetting);
        const decoder = new JsonLineDecoder();
        this._send = async value => {
          const bytes = encoder.encode(JSON.stringify(value) + '\n');
          if (bytes.length > MAX_LINE) fail('FRAME_SIZE', '发送数据过大。');
          const result = await device.transferOut(chosen.output.endpointNumber, bytes);
          if (result.status !== 'ok' || result.bytesWritten !== bytes.length) fail('USB_WRITE', 'USB 数据传输不完整。');
        };
        const hello = this._waitHello();
        this._readTask = (async () => {
          while (epoch === this._epoch) {
            const result = await device.transferIn(chosen.input.endpointNumber, Math.max(64, chosen.input.packetSize || 64));
            if (epoch !== this._epoch) break;
            if (result.status !== 'ok' || !result.data) fail('USB_READ', 'USB 数据读取失败。');
            for (const message of decoder.push(result.data)) this._bridgeMessage(message);
          }
        })().catch(error => { if (epoch === this._epoch) this._transportError(error); });
        await this._send({ type: 'hello', protocol: PROTOCOL, status_events: true });
        await hello;
        if (epoch !== this._epoch) fail('DISCONNECTED', '连接已取消。');
        this._status('connected', 'webusb', 'PCG USB 读卡桥已连接', this._canWrite);
        return this.state;
      } catch (error) {
        await this.disconnect(); this._status('error', 'webusb', error.message || 'USB 连接失败。'); throw error;
      }
    }
    async connectM5Dial(opts = {}) {
      // CDC ACM is class 0x02. The WebUSB button filters class 0xFF and will
      // not list this device. 0x1001 is the other board's USB-Serial-JTAG.
      return this.connectSerial(Object.assign({}, opts, {
        filters: [{ usbVendorId: 0x303A, usbProductId: 0x4001 }],
      }));
    }
    async connectSerial({ baudRate = 115200, filters } = {}) {
      this._secure();
      if (!root.navigator || !root.navigator.serial) fail('SERIAL_UNAVAILABLE', '此浏览器不支持 Web Serial。');
      const plan = serialOpenPlan(baudRate);
      if (!plan.ok || ![9600, 19200, 38400, 57600, 115200, 230400].includes(baudRate)) fail('SERIAL_BAUD', '不支持这个串口速率。不会使用 1200bps。');
      const requestEpoch = this._epoch;
      const port = filters
        ? await root.navigator.serial.requestPort({ filters })
        : await root.navigator.serial.requestPort();
      if (requestEpoch !== this._epoch) fail('DISCONNECTED', '连接已取消。');
      const info = port.getInfo ? port.getInfo() : {};
      if (info.usbProductId === 0x1001) fail('SERIAL_WRONG_PORT', '这是另一台 USB JTAG（303A:1001，cu.usbmodem101），不是 M5Dial CDC。');
      await this.disconnect();
      const epoch = ++this._epoch;
      this._source = 'serial'; this._port = port;
      this._status('connecting', 'serial', '已选出串口。浏览器里的「已配对」只是授权记录，灯要等握手成功才变绿。');
      try {
        await port.open({ baudRate: plan.baudRate });
        this._status('connecting', 'serial', '串口已打开（115200）。正在等 pcg.reader.v1 握手…');
        const decoder = new JsonLineDecoder();
        const reader = port.readable.getReader(); this._serialReader = reader;
        this._send = async value => {
          const bytes = encoder.encode(JSON.stringify(value) + '\n');
          if (bytes.length > MAX_LINE) fail('FRAME_SIZE', '发送数据过大。');
          const writer = port.writable.getWriter();
          try { await writer.write(bytes); } finally { writer.releaseLock(); }
        };
        const hello = this._waitHello();
        this._readTask = (async () => {
          try {
            while (epoch === this._epoch) {
              const result = await reader.read();
              if (result.done) { if (epoch === this._epoch) fail('SERIAL_CLOSED', '串口连接已关闭。'); break; }
              if (epoch !== this._epoch) break;
              for (const message of decoder.push(result.value)) this._bridgeMessage(message);
            }
          } finally { reader.releaseLock(); }
        })().catch(error => { if (epoch === this._epoch) this._transportError(error); });
        await this._send({ type: 'hello', protocol: PROTOCOL, status_events: true });
        await hello;
        if (epoch !== this._epoch) fail('DISCONNECTED', '连接已取消。');
        this._status('connected', 'serial', '握手完成，M5Dial 已连接。灯现在应为绿色。', this._canWrite);
        return this.state;
      } catch (error) {
        await this.disconnect(); this._status('error', 'serial', error.message || '串口连接失败。'); throw error;
      }
    }
    _transportError(error) {
      const source = this._source;
      if (this._hello) { this._hello.reject(error); this._hello = null; }
      // Schedule cleanup outside the read task to avoid waiting on the task itself.
      Promise.resolve().then(() => this.disconnect()).then(() => this._status('error', source, error.message || '读卡连接中断。'));
    }
    async startWebNFC() {
      this._secure();
      if (typeof root.NDEFReader !== 'function') fail('WEBNFC_UNAVAILABLE', '此浏览器没有 Web NFC。请使用支持 NFC 的 Android Chrome，或连接外部读卡器。');
      await this.disconnect();
      const epoch = ++this._epoch;
      this._source = 'webnfc'; this._nfc = new root.NDEFReader(); this._nfcAbort = new AbortController();
      this._status('connecting', 'webnfc', '正在请求 NFC 扫描权限…');
      this._nfc.onreading = event => {
        if (epoch !== this._epoch || this._writeBusy) return;
        try {
          let descriptor = null;
          for (const record of event.message.records) {
            if (record.recordType === 'mime' && record.mediaType === MIME) {
              if (descriptor) fail('DESCRIPTOR_MULTIPLE', '卡片含有多个身份记录。');
              descriptor = parseDescriptor(record.data);
            }
          }
          this._emitCard({ uid: event.serialNumber || null, source: 'webnfc', descriptor });
        } catch (error) { this._status('error', 'webnfc', error.message, true); }
      };
      this._nfc.onreadingerror = () => this._status('error', 'webnfc', '未能读取卡片。请移开后重试；Web NFC 只支持 NDEF 标签。', true);
      try {
        await this._nfc.scan({ signal: this._nfcAbort.signal });
        if (epoch !== this._epoch) fail('DISCONNECTED', 'NFC 扫描已取消。');
        this._status('connected', 'webnfc', 'NFC 扫描已开启，请贴近卡片', true);
        return this.state;
      } catch (error) {
        await this.disconnect(); this._status('error', 'webnfc', error.message || 'NFC 扫描失败。'); throw error;
      }
    }
    async setSound(enabled) {
      if (!this._bridgeReady || !this._feedback) fail('FEEDBACK_UNAVAILABLE', '请升级 M5Dial 声音与屏幕固件。');
      await this._send({ type: 'feedback', sound: !!enabled });
    }
    async diagnose() {
      if (!this._bridgeReady) fail('BRIDGE_HANDSHAKE', '请先连接 M5Dial。');
      await this._send({ type: 'diag' });
    }
    async writePlayer(value, { overwrite = false, blankOnly = false } = {}) {
      const descriptor = parseDescriptor(value);
      if (descriptor.type !== 'player') fail('WRITE_PLAYER_ONLY', '此操作只写入玩家身份卡。');
      if (!this.state.canWrite || !this._source) fail('WRITE_UNAVAILABLE', '当前读卡方式不支持写入。可使用 Android Web NFC 或支持写入的 PCG 读卡桥。');
      if (blankOnly && this._source !== 'webnfc') {
        if (this._writeMode !== 'blank-player-v1') fail('WRITE_UPDATE_REQUIRED', '请先升级 M5Dial 写卡固件。');
        const card = this._lastCard, tag = card && card.tag;
        if (overwrite || !card || card.ndef !== 'blank' || !tag || tag.type !== 'NTAG215' || tag.cc !== 'E1103E00' || tag.capacity !== 496 || tag.writable !== true || tag.lock !== 'open') fail('WRITE_NEEDS_BLANK', '请先刷一张空白、可写的 NTAG215 卡。');
      }
      if (this._writeBusy) fail('WRITE_BUSY', '已有一次写卡操作正在进行。');
      this._writeBusy = true;
      try {
        if (this._source === 'webnfc') {
          const controller = new AbortController(); this._writeAbort = controller;
          const timer = setTimeout(() => controller.abort(), 20000);
          try {
            await this._nfc.write({ records: [{ recordType: 'mime', mediaType: MIME, data: encodeDescriptor(descriptor) }] }, { overwrite: !!overwrite, signal: controller.signal });
            this._lastSignature = '';
            // Browser reports physical write completion; a separate rescan confirms it.
            return { verified: false, uid: null, descriptor };
          } finally { clearTimeout(timer); this._writeAbort = null; }
        }
        const uid = this._lastUID;
        if (!uid) fail('WRITE_NEEDS_CARD', '请先扫描并保持目标玩家卡在读卡器上。');
        const requestId = root.crypto && root.crypto.randomUUID ? root.crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
        let pending;
        const promise = new Promise((resolve, reject) => {
          const timer = setTimeout(() => { this._pending.delete(requestId); reject(new ReaderError('WRITE_TIMEOUT', '写卡没有收到读回确认，请重新刷卡检查。')); }, 20000);
          pending = { resolve, reject, timer, uid, descriptor, requireVerified: blankOnly };
          this._pending.set(requestId, pending);
        });
        promise.catch(() => {});
        try {
          await this._send({ type: 'write', request_id: requestId, expected_uid: uid, mime: MIME, descriptor, overwrite: !!overwrite, ...(blankOnly ? { confirm: true } : {}) });
          const result = await promise;
          this._lastSignature = '';
          return result;
        } catch (error) { clearTimeout(pending.timer); this._pending.delete(requestId); throw error; }
      } finally { this._writeBusy = false; }
    }
    async disconnect() {
      this._epoch++;
      const usb = this._usb, port = this._port, reader = this._serialReader, readTask = this._readTask;
      this._usb = null; this._port = null; this._serialReader = null; this._readTask = null;
      if (this._nfcAbort) this._nfcAbort.abort();
      if (this._writeAbort) this._writeAbort.abort();
      this._nfcAbort = null; this._nfc = null; this._writeAbort = null;
      const error = new ReaderError('DISCONNECTED', '读卡连接已断开。');
      if (this._hello) { this._hello.reject(error); this._hello = null; }
      for (const pending of this._pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
      this._pending.clear();
      this._source = null; this._send = null; this._bridgeReady = false; this._canWrite = false;
      this._lastUID = null; this._lastSignature = ''; this._lastCard = null; this._writeMode = null; this._feedback = false; this._sound = true; this._firmware = null;
      this.onRemoved();
      if (usb && usb.opened) { try { await usb.close(); } catch (_) {} }
      if (reader) { try { await reader.cancel(); } catch (_) {} }
      if (readTask) { try { await readTask; } catch (_) {} }
      if (port) { try { await port.close(); } catch (_) {} }
      this._status('disconnected', null, '读卡器已断开', false);
    }
  }

  const api = { ReaderManager, ReaderError, normalizeUID, parseDescriptor, encodeDescriptor, JsonLineDecoder, capabilities, lampOn, connectionLabel, serialOpenPlan, MIME, PROTOCOL };
  root.PCGReaders = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
