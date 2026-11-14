/* Real browser UI with fake NFC/serial hardware. This is not device acceptance. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const base = process.env.PULSE_TEST_URL || 'http://127.0.0.1:8002';
fs.mkdirSync('output/playwright', { recursive: true });
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: {width:390,height:844}, locale:'zh-CN', reducedMotion:'reduce', userAgent:'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36' });
    await context.addInitScript(() => {
      window.fakeReaders = [];
      window.NDEFReader = class extends EventTarget {
        constructor() { super(); this.writes = []; fakeReaders.push(this); }
        async scan({signal}) { this.active = true; signal.addEventListener('abort', () => {this.active = false;}); }
        async write(message, options) { this.writes.push({records:message.records, overwrite:options.overwrite}); }
        read(records, serialNumber='04AA1B2C3D4E5F') { if(this.active) this.dispatchEvent(Object.assign(new Event('reading'), {message:{records},serialNumber})); }
      };
      window.emitCard = (rid, serial) => {
        const card = PCGClashRoster.cards.find(card => card.rid === rid);
        fakeReaders.at(-1).read(PCGClashNfc.messageFor(card).records, serial);
      };
    });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const ready = () => page.waitForFunction(() => document.body.dataset.ready === '1' && document.body.dataset.animating !== '1');
    const state = () => page.evaluate(() => JSON.parse(render_game_to_text()));
    const click = action => page.locator(`[data-action="${action}"]`).first().click();
    await page.goto(base + '/dist/clash/?scenario=versus&lang=zh-CN'); await ready();
    await click('nfc-menu'); await click('nfc-init');
    await page.waitForFunction(() => fakeReaders.length === 1 && fakeReaders[0].active);
    assert.equal(await page.locator('[data-nfc-pick]').inputValue(), '', 'placeholder matches no selection');
    await page.locator('[data-nfc-pick]').selectOption('H024');
    await page.evaluate(() => fakeReaders.at(-1).read([{recordType:'empty'}]));
    const before = await state();
    await click('nfc-write');
    assert.equal(await page.evaluate(() => fakeReaders[0].writes[0].overwrite), false);
    assert.match(await page.locator('.nfc-status').innerText(), /移开再刷/);
    assert.equal(await page.locator('[data-action="nfc-write"]').isDisabled(), true);
    await page.evaluate(() => emitCard('H024', '04AA1B2C3D4E60'));
    assert.match(await page.locator('.nfc-status').innerText(), /同一张卡/);
    await page.evaluate(() => emitCard('H024'));
    assert.match(await page.locator('.nfc-status').innerText(), /校验成功/);
    assert.deepEqual(await state(), before, 'initialization and verification do not play');
    await page.evaluate(() => fakeReaders.at(-1).read([{recordType:'text',data:'keep'}], '04AA1B2C3D4E61'));
    assert.equal(await page.evaluate(() => fakeReaders[0].writes.length), 1);
    await click('nfc-overwrite');
    assert.equal(await page.evaluate(() => fakeReaders[0].writes[1].overwrite), true);
    await page.evaluate(() => emitCard('H024', '04AA1B2C3D4E61'));
    await page.screenshot({path:'output/playwright/nfc-android-init.png'});
    await click('nfc-stop');
    assert.equal(await page.evaluate(() => fakeReaders[0].active), false);
    await click('nfc-init'); // leave initialization
    await click('nfc-start');
    assert.equal(await page.evaluate(() => fakeReaders.length), 2);
    const playable = await page.evaluate(() => PCGClashRoster.cards.find(c => c.template_id === 'xiao_yin').rid);
    await page.evaluate(rid => emitCard(rid), playable); await ready();
    const played = await state();
    assert.equal(played.boards[0].length, 1);
    assert.equal(played.hand.some(c=>c.id==='xiao_yin'), false);
    assert.equal(played.supply[0], 0);
    await page.evaluate(rid => emitCard(rid), playable);
    assert.deepEqual(await state(), played, 'same tag does not submit twice');
    await page.screenshot({path:'output/playwright/nfc-android-play.png'});
    // Transport controls remain available during the other player's turn/handoff.
    await page.goto(base + '/dist/clash/?scenario=lesson&lang=zh-CN'); await ready();
    await click('nfc-menu'); await click('nfc-start'); await click('nfc-close');
    await click('end-turn'); await ready();
    const locked = await state();
    await page.evaluate(rid => emitCard(rid), playable);
    const refused = await state();
    assert.deepEqual(refused.boards, locked.boards);
    assert.deepEqual(refused.supply, locked.supply);
    assert.equal(refused.error.code, 'not_your_turn');
    await click('nfc-menu'); await click('nfc-stop');
    assert.equal(await page.evaluate(() => fakeReaders[0].active), false);
    // The requested blank-tag player identity flow uses a different MIME.
    await page.goto(base + '/dist/clash/?scenario=versus&lang=zh-CN'); await ready();
    await click('nfc-menu'); await click('nfc-player-init');
    await page.locator('[data-player-name]').fill('小印 <玩家>');
    await page.locator('[data-player-skin]').selectOption('03');
    await page.evaluate(() => fakeReaders[0].read([{recordType:'empty'}]));
    assert.equal(await page.locator('[data-player-name]').inputValue(), '小印 <玩家>', 'scan status does not erase the form');
    assert.equal(await page.locator('[data-player-skin]').inputValue(), '03');
    await click('nfc-player-prepare');
    const identityBefore = await state();
    assert.equal(await page.evaluate(() => localStorage.getItem('pulse.clash.player.v1')), null);
    await click('nfc-player-write');
    assert.equal(await page.evaluate(() => localStorage.getItem('pulse.clash.player.v1')), null, 'identity is not saved before readback');
    const identity = await page.evaluate(() => {
      const write = fakeReaders[0].writes[0];
      if(write.overwrite || write.records[0].mediaType !== PCGReaders.MIME) throw new Error('wrong write options');
      return JSON.parse(new TextDecoder().decode(write.records[0].data));
    });
    assert.equal(identity.name, '小印 <玩家>'); assert.equal(identity.skin, '03');
    assert.match(identity.id, /^[0-9a-f-]{36}$/);
    await page.evaluate(() => fakeReaders[0].read(fakeReaders[0].writes[0].records, '04AA1B2C3D4E60'));
    assert.equal(await page.evaluate(() => localStorage.getItem('pulse.clash.player.v1')), null);
    await page.evaluate(() => fakeReaders[0].read(fakeReaders[0].writes[0].records));
    assert.match(await page.locator('.nfc-status').innerText(), /玩家身份卡写入并校验成功/);
    assert.deepEqual(JSON.parse(await page.evaluate(() => localStorage.getItem('pulse.clash.player.v1'))), identity);
    assert.deepEqual(await state(), identityBefore, 'identity scans must not change the battle');
    await page.locator('.player-current').scrollIntoViewIfNeeded();
    await page.screenshot({path:'output/playwright/nfc-player-verified.png'});
    await click('nfc-player-init');
    await page.locator('[data-player-name]').fill('第二位玩家');
    await click('nfc-player-prepare');
    assert.equal(await page.locator('[data-action="nfc-player-write"]').isDisabled(), true, 'existing identity cannot be overwritten');
    await page.evaluate(() => fakeReaders[0].read([{recordType:'text',data:'other use'}], '04AA1B2C3D4E61'));
    assert.equal(await page.locator('[data-action="nfc-player-write"]').isDisabled(), true, 'foreign NDEF cannot be overwritten by identity setup');
    assert.equal(await page.evaluate(() => fakeReaders[0].writes.length), 1);
    await page.reload(); await ready(); await click('nfc-menu');
    assert.equal(await page.locator('.player-current b').innerText(), identity.name);
    await page.evaluate(() => PULSEI18n.setLocale('en'));
    assert.equal(await page.locator('.player-current b').innerText(), identity.name, 'nicknames are never translated');
    assert.equal(await page.evaluate(() => PULSEI18n.missing.size), 0);
    await click('nfc-player-init');
    await page.locator('[data-player-name]').fill('New player');
    await click('nfc-player-prepare');
    assert.equal(await page.evaluate(() => PULSEI18n.missing.size), 0, 'English player setup is complete');
    await page.screenshot({path:'output/playwright/nfc-player-english.png'});
    await context.close();

    const desktop = await browser.newContext({viewport:{width:1440,height:900}, locale:'en-US', reducedMotion:'reduce'});
    await desktop.addInitScript(() => {
      const enc = new TextEncoder();
      window.serialSent = [];
      window.fakePort = {
        getInfo: () => ({usbVendorId:0x303a,usbProductId:0x4001}),
        async open(options) {
          window.serialOpenOptions = options;
          this.readable = new ReadableStream({ start(controller) {window.serialPush = value => controller.enqueue(enc.encode(JSON.stringify(value)+'\n'));} });
          this.writable = new WritableStream({write(bytes) {
            const msg=JSON.parse(new TextDecoder().decode(bytes)); serialSent.push(msg);
            if(msg.type==='hello') serialPush({type:'hello',protocol:'pcg.reader.v1',capabilities:['uid','ndef_read','ndef_write'],...(window.newFirmware ? {firmware:'2026.11.14-player-write.1',write_mode:'blank-player-v1'} : {})});
            if(msg.type==='write') window.replyWrite = () => serialPush({type:'write_result',request_id:msg.request_id,ok:true,verified:true,uid:msg.expected_uid,descriptor:msg.descriptor});
          }});
        },
        async close() { this.closed = true; }
      };
      Object.defineProperty(navigator,'serial',{value:{requestPort:async options => {window.serialRequestOptions=options;return fakePort;}}});
      window.emitSerialCard = rid => {
        const card = PCGClashRoster.cards.find(c => c.rid === rid);
        const type = enc.encode(PCGClashNfc.MIME), data = enc.encode(PCGClashNfc.messageFor(card).json);
        const bytes = new Uint8Array([0xd2,type.length,data.length,...type,...data]);
        serialPush({type:'card',uid:'04AA1B2C3D4E5F',ndef:'foreign',tag:{ndef_hex:Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join(''),ndef_hex_truncated:false}});
      };
    });
    const desk = await desktop.newPage(); desk.on('pageerror', error => errors.push(error.message));
    await desk.goto(base + '/dist/clash/?scenario=versus&lang=en');
    await desk.locator('[data-action="nfc-menu"]').first().click();
    assert.equal(await desk.locator('[data-action="nfc-start"]').isDisabled(), true);
    await desk.locator('[data-action="nfc-serial"]').click();
    await desk.waitForFunction(() => document.querySelector('.nfc-status').textContent.includes('Handshake complete'));
    assert.equal(await desk.evaluate(() => serialOpenOptions.baudRate), 115200);
    assert.deepEqual(await desk.evaluate(() => serialRequestOptions.filters), [{usbVendorId:0x303a,usbProductId:0x4001}]);
    assert.equal(await desk.evaluate(() => PULSEI18n.missing.size), 0);
    assert.equal(await desk.locator('[data-action="nfc-player-init"]').isDisabled(), true, 'old firmware cannot initialize player cards');
    await desk.screenshot({path:'output/playwright/nfc-m5dial-connected.png'});
    const beforeSerialIdentity = await desk.evaluate(() => render_game_to_text());
    await desk.evaluate(value => serialPush({type:'card',uid:'04AA1B2C3D4E60',descriptor:value,ndef:'pulse'}), identity);
    await desk.waitForFunction(() => document.querySelector('.player-current'));
    assert.equal(await desk.locator('.player-current b').innerText(), identity.name);
    assert.equal(await desk.evaluate(() => render_game_to_text()), beforeSerialIdentity);
    await desk.evaluate(rid => emitSerialCard(rid), playable);
    await desk.waitForFunction(() => JSON.parse(render_game_to_text()).boards[0].length===1 && document.body.dataset.animating !== '1');
    await desk.evaluate(rid => emitSerialCard(rid), playable);
    assert.equal(await desk.evaluate(() => JSON.parse(render_game_to_text()).boards[0].length), 1);
    assert.equal(await desk.evaluate(() => serialSent.some(m => m.type==='write')), false, 'scanning never sends identity writes');
    await desk.locator('[data-action="nfc-menu"]').first().click();
    await desk.locator('[data-action="nfc-stop"]').click();
    await desk.waitForFunction(() => fakePort.closed);
    assert.equal(await desk.locator('[data-action="nfc-player-init"]').isDisabled(), true, 'desktop without NFC needs a connected new firmware');
    await desk.evaluate(() => { window.newFirmware = true; });
    await desk.locator('[data-action="nfc-serial"]').click();
    await desk.waitForFunction(() => document.querySelector('.nfc-status').textContent.includes('Handshake complete'));
    await desk.locator('[data-action="nfc-player-init"]').click();
    await desk.locator('[data-player-name]').fill('M5 玩家 \"}');
    await desk.locator('[data-player-skin]').selectOption('09');
    await desk.locator('[data-action="nfc-player-prepare"]').click();
    const blankSerial = {type:'card',uid:'04AA1B2C3D4E61',ndef:'blank',tag:{type:'NTAG215',cc:'E1103E00',capacity:496,writable:true,lock:'open'}};
    await desk.evaluate(card => serialPush({...card,tag:{...card.tag,writable:false,lock:'locked'}}), blankSerial);
    assert.equal(await desk.locator('[data-action="nfc-player-write"]').isDisabled(), true);
    await desk.evaluate(card => {serialPush({type:'removed'}); serialPush(card);}, blankSerial);
    await desk.waitForFunction(() => !document.querySelector('[data-action="nfc-player-write"]').disabled);
    await desk.evaluate(() => serialPush({type:'removed'}));
    await desk.waitForFunction(() => document.querySelector('[data-action="nfc-player-write"]').disabled);
    await desk.evaluate(card => serialPush(card), blankSerial);
    const oldPlayer = await desk.evaluate(() => localStorage.getItem('pulse.clash.player.v1'));
    const oldBattle = await desk.evaluate(() => render_game_to_text());
    await desk.locator('[data-action="nfc-player-write"]').click();
    await desk.waitForFunction(() => window.replyWrite);
    assert.equal(await desk.evaluate(() => localStorage.getItem('pulse.clash.player.v1')),oldPlayer,'no save until actual response');
    assert.equal(await desk.locator('[data-action="nfc-player-write"]').isDisabled(),true);
    const command = await desk.evaluate(() => serialSent.at(-1));
    assert.equal(command.type,'write'); assert.equal(command.confirm,true); assert.equal(command.overwrite,false);
    assert.equal(command.expected_uid,blankSerial.uid); assert.equal(command.descriptor.skin,'09');
    await desk.evaluate(() => replyWrite());
    await desk.waitForFunction(() => document.querySelector('.nfc-status').textContent.includes('verified'));
    assert.deepEqual(JSON.parse(await desk.evaluate(() => localStorage.getItem('pulse.clash.player.v1'))),command.descriptor);
    assert.equal(await desk.evaluate(() => render_game_to_text()),oldBattle);
    assert.equal(await desk.evaluate(() => PULSEI18n.missing.size),0);
    await desk.screenshot({path:'output/playwright/nfc-m5dial-player-written.png'});
    await desk.locator('[data-action="nfc-stop"]').click();
    await desk.waitForFunction(() => fakePort.closed);
    assert.deepEqual(errors, []);
    console.log('PASS NFC browser: Android initialize/write/overwrite/UID verification/stop/restart/play/debounce/turn lock; desktop M5Dial serial handshake/raw game NDEF/play/disconnect; player identity creation/readback/persistence; M5Dial blank identity write/readback, old firmware/locked/removed card refusal; occupied-tag protection, English catalog. Fake hardware only.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode=1; });
