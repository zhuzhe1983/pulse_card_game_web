#!/usr/bin/env node
const assert = require('assert');
const path = require('path');
const api = require(path.join(__dirname, '..', '..', '..', 'src', 'readers.js'));

assert.strictEqual(api.lampOn('disconnected'), false);
assert.strictEqual(api.lampOn('connecting'), false);
assert.strictEqual(api.lampOn('error'), false);
assert.strictEqual(api.lampOn('connected'), true);
assert.strictEqual(api.lampOn('reading'), true);
assert.strictEqual(api.connectionLabel('connecting'), '握手中');
assert.strictEqual(api.connectionLabel('connected'), '已连接');
assert.strictEqual(api.connectionLabel('error'), '未连上');
assert.strictEqual(api.connectionLabel('disconnected'), '未连接');
assert.strictEqual(api.serialOpenPlan(1200).ok, false);
assert.strictEqual(api.serialOpenPlan(115200).dtrToggle, false);
assert.strictEqual(api.serialOpenPlan(115200).baudRate, 115200);

const src = require('fs').readFileSync(path.join(__dirname, '..', '..', '..', 'src', 'readers.js'), 'utf8');
assert.ok(src.includes('usbVendorId: 0x303A'), 'M5Dial filter uses VID 303A');
assert.ok(src.includes('usbProductId: 0x4001'), 'M5Dial filter uses CDC PID 4001');
assert.ok(src.includes('classCode: 0xff'), 'WebUSB entry still filters vendor class');
assert.ok(src.includes('usbProductId === 0x1001'), 'JTAG PID is rejected');
assert.ok(!src.includes('baudRate: 1200') && !src.includes('baudRate = 1200'), 'open path does not use 1200 baud');
console.log('reader lamp and serial plan ok');
