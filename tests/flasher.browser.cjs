/* Exercises the real page and real firmware bytes. The serial device/loader are fake. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const base = process.env.PULSE_TEST_URL || 'http://127.0.0.1:8002';
const fakeLoader = `
export class Transport { constructor(port) { this.port = port; } async disconnect() { window.flashClosed++; } }
export class ESPLoader {
  constructor(options) { this.chip = {CHIP_NAME: window.chip || 'ESP32-S3'}; }
  async main() { window.connected++; }
  async writeFlash(options) {
    if (!(options.fileArray[0].data instanceof Uint8Array)) throw new Error('wrong byte type');
    window.writes.push({size:options.fileArray[0].data.length,address:options.fileArray[0].address,eraseAll:options.eraseAll,flashMode:options.flashMode,flashFreq:options.flashFreq,flashSize:options.flashSize});
    if (window.failWrite) throw new Error('test interrupted');
    options.reportProgress(0,100,100);
  }
  async after(mode) { window.resetMode = mode; }
}`;
(async () => {
 const browser = await chromium.launch({headless:true});
 try {
  const context = await browser.newContext({viewport:{width:960,height:1000}});
  await context.addInitScript(() => {
    window.requested = 0; window.connected = 0; window.flashClosed = 0; window.writes = [];
    Object.defineProperty(navigator,'serial',{value:{requestPort:async () => {window.requested++; return {};}}});
  });
  await context.route('https://unpkg.com/esptool-js@0.7.1/bundle.js', r => r.fulfill({contentType:'text/javascript',body:fakeLoader}));
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(base+'/dist/flash.html');
  await page.waitForFunction(() => !document.querySelector('#btn-connect').disabled);
  assert.equal(await page.locator('#firm-version').innerText(),'2026.11.14-feedback.2');
  await page.locator('#btn-connect').click();
  await page.waitForFunction(() => !document.querySelector('#btn-disconnect').disabled);
  await page.locator('#btn-flash').click();
  await page.waitForFunction(() => window.flashClosed===1);
  assert.equal(await page.evaluate(() => requested),1,'reuses the connected port');
  assert.equal(await page.evaluate(() => connected),1);
  assert.equal(await page.evaluate(() => resetMode),'hard_reset');
  const write = await page.evaluate(() => writes[0]);
  assert.ok(write.size>400000); assert.equal(write.address,0); assert.equal(write.eraseAll,false);
  assert.equal(write.flashMode,'dio'); assert.equal(write.flashFreq,'80m'); assert.equal(write.flashSize,'8MB');
  assert.match(await page.locator('#prog').innerText(),/完成/);
  fs.mkdirSync('output/playwright',{recursive:true});
  await page.screenshot({path:'output/playwright/m5dial-flasher.png'});
  await page.evaluate(() => {window.failWrite=true;});
  await page.locator('#btn-flash').click();
  await page.waitForFunction(() => window.flashClosed===2);
  assert.match(await page.locator('#prog').innerText(),/未完成/);
  await page.evaluate(() => {window.chip='ESP32';});
  await page.locator('#btn-flash').click();
  await page.waitForFunction(() => window.flashClosed===3);
  assert.equal(await page.evaluate(() => writes.length),2,'wrong chip never written');
  await context.route('**/firmware/m5dial_nfc_bridge_merged_dio.bin', async r => {
    const response = await r.fetch(), bytes = await response.body(); bytes[100] ^= 1;
    await r.fulfill({response,body:bytes});
  });
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#prog').textContent==='固件未就绪');
  assert.equal(await page.locator('#btn-flash').isDisabled(),true,'bad digest blocks flash');
  assert.match(await page.locator('#log').innerText(),/摘要不匹配/);
  assert.deepEqual(errors,[]);
  console.log('PASS flasher browser: manifest/digest/image headers, single connection, byte array, reset/port cleanup, interrupted write, wrong chip, digest mismatch. Fake serial hardware only.');
 } finally { await browser.close(); }
})().catch(error => {console.error(error);process.exitCode=1;});
