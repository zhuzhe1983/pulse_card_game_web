'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const shotDir = process.env.CLASH_SHOTS || '/opt/cursor/artifacts/pointer';
fs.mkdirSync(shotDir, { recursive: true });
const port = 8018;
const chromePort = 9348;
const chromeBin = process.env.CHROME || '/usr/local/bin/google-chrome';

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}
async function waitFor(fn, label, tries = 80) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (error) { last = error; }
    await sleep(150);
  }
  throw new Error(label + ': ' + (last && last.message));
}

async function connect(debuggerUrl) {
  const ws = new WebSocket(debuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', reject);
  });
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(JSON.stringify(message.error)));
    else resolve(message.result);
  });
  function send(method, params = {}) {
    const msgId = ++id;
    return new Promise((resolve, reject) => {
      pending.set(msgId, { resolve, reject });
      ws.send(JSON.stringify({ id: msgId, method, params }));
    });
  }
  async function value(expression) {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails.exception || result.exceptionDetails));
    return result.result.value;
  }
  return { send, value };
}

async function main() {
  const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe']
  });
  const chrome = spawn(chromeBin, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    `--remote-debugging-port=${chromePort}`, '--window-size=1280,800',
    `--user-data-dir=/tmp/chrome-pointer-${process.pid}`, 'about:blank'
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  const evidence = [];
  try {
    await waitFor(async () => {
      const res = await get(`http://127.0.0.1:${port}/dist/clash/`);
      if (res.status !== 200 || !res.body.includes('pcg.clash.v0')) throw new Error('page not ready');
    }, 'static server');
    const page = await waitFor(async () => {
      const list = JSON.parse((await get(`http://127.0.0.1:${chromePort}/json`)).body);
      const found = list.find(item => item.type === 'page' && item.webSocketDebuggerUrl);
      if (!found) throw new Error('no page');
      return found;
    }, 'chrome');
    const { send, value } = await connect(page.webSocketDebuggerUrl);
    await send('Page.enable');
    await send('Runtime.enable');
    const q = selector => JSON.stringify(selector);
    async function box(selector, nudge) {
      const found = await value(`(() => { const el = document.querySelector(${q(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + Math.min(r.height / 2, ${nudge || 80}), w: r.width, h: r.height }; })()`);
      if (!found) throw new Error('找不到 ' + selector);
      return found;
    }
    async function mouse(type, x, y, button = 'left', clickCount = 1) {
      await send('Input.dispatchMouseEvent', { type, x, y, button, clickCount });
    }
    async function touch(type, points) {
      await send('Input.dispatchTouchEvent', { type, touchPoints: points });
    }
    async function shot(name) {
      const image = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(shotDir, name + '.png'), Buffer.from(image.data, 'base64'));
    }
    function eq(actual, expected, label) {
      if (actual !== expected) throw new Error(label + ' 实际 ' + JSON.stringify(actual) + ' 期望 ' + JSON.stringify(expected));
    }
    async function state() {
      return value(`(() => ({
        mode: document.querySelector('main.table').dataset.mode,
        opening: document.querySelector('main.table').dataset.opening,
        ai: document.querySelector('main.table').dataset.ai,
        seat: document.querySelector('#turn-label').dataset.seat,
        supply: document.querySelector('[data-seat="0"][data-stat="supply"]').textContent,
        max: document.querySelector('[data-seat="0"][data-stat="max-supply"]').textContent,
        hand: [...document.querySelectorAll('[data-hand-seat="0"] [data-card]')].map(el => el.dataset.card).join(','),
        mine: [...document.querySelectorAll('.slots.mine [data-card]')].map(el => el.getAttribute('data-card')).join(','),
        foe: [...document.querySelectorAll('.slots.foe [data-card]')].map(el => el.getAttribute('data-card')).join(','),
        greens: document.querySelectorAll('[data-mark="legal"], [data-mark="hot"]').length,
        reds: document.querySelectorAll('[data-mark="bad"]').length,
        cross: document.querySelectorAll('.reject-badge .cross').length,
        why: (document.querySelector('.reject-badge .why') || {}).textContent || '',
        error: document.querySelector('#last-error').dataset.code || '',
        banner: (document.querySelector('.ai-banner') || {}).textContent || '',
        handoff: document.querySelector('main.table').dataset.handoff,
        pool: document.querySelector('main.table').dataset.simPool || '',
        seed: document.querySelector('main.table').dataset.seed || '',
        deck0: document.querySelector('main.table').dataset.deck0 || '',
        deck1: document.querySelector('main.table').dataset.deck1 || ''
      }))()`);
    }

    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/dist/clash/` });
    await waitFor(async () => {
      if (await value('document.body && document.body.dataset.ready') !== '1') throw new Error('not ready');
    }, 'app');
    let snap = await state();
    eq(snap.mode, 'ai', '默认人机');
    eq(snap.opening, 'lesson', '默认固定教学');
    eq(await value(`document.querySelector('[data-hand-seat="0"]').closest('.hand-dock') ? 'bottom' : 'no'`), 'bottom', '玩家手牌在下方');
    eq(await value(`document.querySelector('.slots.foe') && document.querySelector('.slots.mine') ? 'lanes' : ''`), 'lanes', '上下两条队伍');

    const card = await box('[data-action="select-hand"][data-card="xiao_yin"]', 30);
    await mouse('mousePressed', card.x, card.y);
    await mouse('mouseReleased', card.x, card.y);
    await sleep(80);
    snap = await state();
    if (snap.greens < 1) throw new Error('点选手牌后没有持续绿标 ' + JSON.stringify(snap));
    await shot('01-green-seams-1280');
    evidence.push('1280 点选小印后插入缝保持绿色，不靠悬停');

    await mouse('mousePressed', card.x, card.y);
    await mouse('mouseMoved', card.x + 30, card.y - 80, 'left', 0);
    await sleep(40);
    const seam = await box('.slots.mine .insert[data-index="0"]');
    for (let step = 1; step <= 6; step += 1) {
      await mouse('mouseMoved', card.x + (seam.x - card.x) * step / 6, card.y + (seam.y - card.y) * step / 6, 'left', 0);
    }
    const collapsed = await value(`document.body.classList.contains('hand-out') && document.querySelector('.slots.foe').getBoundingClientRect().height > 40`);
    if (!collapsed) throw new Error('拖动手牌时没有收起手牌');
    await shot('02-dragging-seam-1280');
    await mouse('mouseReleased', seam.x, seam.y);
    await sleep(80);
    snap = await state();
    eq(snap.supply, '0', '拖到缝上扣一次电');
    eq(snap.mine, 'xiao_yin', '只部署一张');
    eq(await value(`document.querySelectorAll('[data-board-seat="0"][data-card="xiao_yin"]').length`), 1, '同一次手势没有打出第二张');
    evidence.push('鼠标把小印拖到最左缝，只部署一次，供电从 1 变成 0');

    const before = await state();
    const stick = await box('[data-action="select-hand"][data-card="art_h024"]', 30);
    await mouse('mousePressed', stick.x, stick.y);
    await mouse('mouseMoved', stick.x, stick.y - 220, 'left', 0);
    await sleep(40);
    await shot('03-illegal-blank-1280');
    await mouse('mouseReleased', stick.x, stick.y - 220);
    await sleep(40);
    snap = await state();
    eq(snap.supply, before.supply, '空白松手不扣电');
    eq(snap.hand, before.hand, '空白松手不弃牌');
    eq(snap.mine, before.mine, '空白松手不改变场上');

    const again = await box('[data-action="select-hand"][data-card="art_h024"]', 30);
    await mouse('mousePressed', again.x, again.y);
    await mouse('mouseMoved', again.x + 40, again.y - 160, 'left', 0);
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await mouse('mouseReleased', again.x + 40, again.y - 160);
    await sleep(40);
    snap = await state();
    eq(snap.supply, before.supply, 'Esc 不扣电');
    eq(snap.mine, before.mine, 'Esc 不改变场上');

    await mouse('mousePressed', again.x, again.y);
    await mouse('mouseMoved', again.x + 36, again.y - 140, 'left', 0);
    await mouse('mousePressed', again.x + 36, again.y - 140, 'right', 1);
    await mouse('mouseReleased', again.x + 36, again.y - 140, 'right', 1);
    await mouse('mouseReleased', again.x + 36, again.y - 140);
    await sleep(40);
    snap = await state();
    eq(snap.supply, before.supply, '右键不扣电');

    await value(`(() => {
      const el = document.querySelector('[data-action="select-hand"][data-card="art_h024"]');
      const r = el.getBoundingClientRect();
      el.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 7, bubbles: true, clientX: r.left + 20, clientY: r.top + 20 }));
      el.dispatchEvent(new PointerEvent('pointermove', { pointerId: 7, bubbles: true, clientX: r.left + 80, clientY: r.top - 80 }));
      el.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 7, bubbles: true, clientX: r.left + 80, clientY: r.top - 80 }));
    })()`);
    await sleep(40);
    snap = await state();
    eq(snap.supply, before.supply, 'pointercancel 不扣电');
    await value(`(() => {
      const el = document.querySelector('[data-action="select-hand"][data-card="art_h024"]');
      const r = el.getBoundingClientRect();
      document.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 8, bubbles: true, clientX: r.left + 20, clientY: r.top + 20 }));
      document.dispatchEvent(new PointerEvent('pointermove', { pointerId: 8, bubbles: true, clientX: r.left + 70, clientY: r.top - 70 }));
      document.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 9, bubbles: true, clientX: r.left + 90, clientY: r.top - 40 }));
    })()`);
    await sleep(40);
    snap = await state();
    eq(snap.supply, before.supply, '第二根手指不扣电');
    evidence.push('空白、Esc、右键、pointercancel、第二根手指都不扣电');

    await sleep(600);
    const end = await box('.end-turn', 20);
    await mouse('mousePressed', end.x, end.y);
    await mouse('mouseReleased', end.x, end.y);
    await waitFor(async () => {
      const now = await state();
      if (now.ai !== 'run' && now.banner !== '对方正在行动') throw new Error('对方还没开始 ' + JSON.stringify(now));
    }, 'ai start', 20);
    eq(await value(`document.querySelector('[data-hand-seat="1"]').dataset.hidden`), '1', '对方行动时不翻开手牌');
    eq(await value(`document.querySelector('[data-hand-seat="0"]').dataset.hidden`), '0', '自己的手牌仍可看');
    if ((await value(`document.querySelector('[data-hand-seat="1"]').textContent`)).includes('小印')) throw new Error('对方手牌露出了牌名');
    await shot('04-ai-running-1280');
    const locked = await value(`(() => {
      const ai = document.querySelector('main.table').dataset.ai;
      const seat = document.querySelector('#turn-label').dataset.seat;
      if (ai !== 'run') return { ai, seat, clicked: false };
      document.querySelector('[data-action="end-turn"]').click();
      return { ai, seat, after: document.querySelector('#turn-label').dataset.seat, still: document.querySelector('main.table').dataset.ai, clicked: true };
    })()`);
    if (locked.clicked && (locked.after !== locked.seat || locked.still !== 'run')) {
      throw new Error('对方行动时结束回合被接受了 ' + JSON.stringify(locked));
    }
    await waitFor(async () => {
      const now = await state();
      if (now.ai !== 'idle' || now.seat !== '0') throw new Error(JSON.stringify(now));
      return now;
    }, 'ai done', 40);
    snap = await state();
    eq(snap.max, '2', '结束回合没有连跳两回合');
    eq(snap.seat, '0', '对方行动结束后回到玩家');
    if (!snap.mine.includes('xiao_yin')) throw new Error('玩家单位离开了下方 ' + snap.mine);
    if (!snap.foe) throw new Error('对方没有在上方行动');
    const mineSide = await value(`document.querySelector('[data-board-seat="0"][data-card="xiao_yin"]').closest('.slots').classList.contains('mine')`);
    if (!mineSide) throw new Error('回合切换后玩家单位跑到了上方');
    evidence.push('结束回合后对方自动行动，玩家不能替它结束回合，单位仍留在下方');

    await value(`document.querySelector('[data-board-seat="0"][data-card="xiao_yin"]').click()`);
    await sleep(40);
    snap = await state();
    if (snap.greens < 1) throw new Error('可攻击单位没有绿标 ' + JSON.stringify(snap));
    await shot('05-green-attack-1280');
    const foeCard = await value(`(() => { const el = document.querySelector('.slots.foe .minion'); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, card: el.dataset.card, hp: el.dataset.durability }; })()`);
    const own = await box('[data-board-seat="0"][data-card="xiao_yin"]', 40);
    const hpBefore = foeCard.hp;
    await mouse('mousePressed', own.x, own.y);
    await mouse('mouseMoved', own.x, own.y - 40, 'left', 0);
    await mouse('mouseMoved', foeCard.x, foeCard.y, 'left', 0);
    await sleep(40);
    await shot('06-attack-arrow-1280');
    await mouse('mouseReleased', foeCard.x, foeCard.y);
    await sleep(80);
    const hpAfter = await value(`document.querySelector('.slots.foe [data-card=${JSON.stringify(foeCard.card)}]') ? document.querySelector('.slots.foe [data-card=${JSON.stringify(foeCard.card)}]').dataset.durability : 'gone'`);
    const attacked = await value(`document.querySelector('[data-board-seat="0"][data-card="xiao_yin"]') ? document.querySelector('[data-board-seat="0"][data-card="xiao_yin"]').dataset.attacked : ''`);
    if (hpAfter === hpBefore && attacked !== 'true') throw new Error('拖拽攻击没有结算 ' + hpBefore + ' ' + hpAfter + ' ' + attacked);
    const hpOnce = hpAfter;
    await mouse('mousePressed', own.x, own.y);
    await mouse('mouseMoved', foeCard.x, foeCard.y, 'left', 0);
    await mouse('mouseReleased', foeCard.x, foeCard.y);
    await sleep(40);
    const hpTwice = await value(`document.querySelector('.slots.foe [data-card=${JSON.stringify(foeCard.card)}]') ? document.querySelector('.slots.foe [data-card=${JSON.stringify(foeCard.card)}]').dataset.durability : 'gone'`);
    if (hpTwice !== hpOnce && hpOnce !== 'gone') throw new Error('同一次攻击被结算了两次');
    evidence.push('从可攻击单位拖到对方单位只攻击一次，再拖不会再打');

    await value(`document.querySelector('[data-action="restart"]').click()`);
    await sleep(40);
    await value(`document.querySelector('[data-action="select-hand"][data-card="xiao_yin"]').click()`);
    await value(`document.querySelector('[data-action="play"]').click()`);
    await value(`document.querySelector('[data-action="end-turn"]').click()`);
    await waitFor(async () => {
      const now = await state();
      if (now.ai !== 'idle' || now.seat !== '0') throw new Error('wait');
    }, 'second ai', 40);
    await value(`document.querySelector('[data-board-seat="0"][data-card="xiao_yin"]').click()`);
    const foeBefore = await value(`document.querySelector('.slots.foe .minion').dataset.durability`);
    await value(`document.querySelector('.slots.foe .minion').click()`);
    const foeAfter = await value(`document.querySelector('.slots.foe .minion') ? document.querySelector('.slots.foe .minion').dataset.durability : 'gone'`);
    if (foeAfter === foeBefore) throw new Error('点选再点目标没有攻击');
    await value(`document.querySelector('.slots.foe .minion') && document.querySelector('.slots.foe .minion').click()`);
    const foeThird = await value(`document.querySelector('.slots.foe .minion') ? document.querySelector('.slots.foe .minion').dataset.durability : 'gone'`);
    if (foeThird !== foeAfter && foeAfter !== 'gone') throw new Error('点选攻击结算了两次');
    evidence.push('点自己再点目标也只攻击一次');

    await value(`document.querySelector('[data-action="scenario"][data-scenario="grow"]').click()`);
    await sleep(40);
    const order = await value(`[...document.querySelectorAll('.slots.mine [data-iid]')].map(el => el.dataset.iid).join(',')`);
    const mover = await box('.slots.mine .minion', 40);
    await mouse('mousePressed', mover.x, mover.y);
    await mouse('mouseMoved', mover.x + 80, mover.y, 'left', 0);
    await mouse('mouseReleased', mover.x + 80, mover.y);
    await sleep(40);
    eq(await value(`[...document.querySelectorAll('.slots.mine [data-iid]')].map(el => el.dataset.iid).join(',')`), order, '拖自己的单位不换位');
    const grown = await box('[data-action="select-hand"][data-card="art_h024"]', 24);
    await mouse('mousePressed', grown.x, grown.y);
    await mouse('mouseMoved', grown.x, grown.y - 180, 'left', 0);
    await sleep(40);
    const lastSeam = await box('.slots.mine .insert:last-of-type');
    await mouse('mouseMoved', lastSeam.x, lastSeam.y, 'left', 0);
    await mouse('mouseReleased', lastSeam.x, lastSeam.y);
    await sleep(40);
    eq(await value(`document.querySelectorAll('.slots.mine [data-card]').length`), 6, '第 6 台仍能插入');
    await shot('07-six-units-1280');
    evidence.push('场上已有 5 台时拖到缝上变成 6 台，横拖单位不换位');

    await value(`document.querySelector('[data-action="scenario"][data-scenario="support-present"]').click()`);
    await value(`document.querySelector('[data-board-seat="0"][data-card="xiao_yin"]').click()`);
    const menu = await value(`document.querySelector('.skill-bar').textContent`);
    if (!menu.includes('复活厚壳 · 1电')) throw new Error('小印没有复活厚壳 ' + menu);
    if (menu.includes('攻击+1')) throw new Error('小印出现了旋钮 ' + menu);
    const guardTarget = await box('.core-slot.foe .base-btn', 24);
    const attacker = await box('[data-board-seat="0"][data-card="xiao_yin"]', 30);
    await mouse('mousePressed', attacker.x, attacker.y);
    await mouse('mouseMoved', attacker.x, attacker.y - 30, 'left', 0);
    await mouse('mouseMoved', guardTarget.x, guardTarget.y, 'left', 0);
    await sleep(50);
    snap = await state();
    if (snap.cross < 1 || !snap.why.includes('护卫')) throw new Error('非法目标没有红圈和原因 ' + JSON.stringify(snap));
    await shot('08-red-guard-1280');
    const hpGuard = await value(`document.querySelector('[data-board-seat="1"][data-card="dian_zhen"]').dataset.durability`);
    const attackedFlag = await value(`document.querySelector('[data-board-seat="0"][data-card="xiao_yin"]').dataset.attacked`);
    await mouse('mouseReleased', guardTarget.x, guardTarget.y);
    await sleep(30);
    eq(await value(`document.querySelector('[data-board-seat="1"][data-card="dian_zhen"]').dataset.durability`), hpGuard, '红叉上松手不掉耐久');
    eq(await value(`document.querySelector('[data-board-seat="0"][data-card="xiao_yin"]').dataset.attacked`), attackedFlag, '红叉上松手不消耗攻击');
    eq(await value(`document.querySelectorAll('[data-mark="bad"]').length`), 0, '离开后红叉消失');
    evidence.push('拖到被护卫挡住的目标出现红圈、×和护卫原因，松手不扣血不消耗攻击');

    await sleep(120);
    await value(`document.querySelector('[data-action="mode"][data-mode="hotseat"]').click()`);
    await value(`document.querySelector('[data-action="select-hand"][data-card="xiao_yin"]').click()`);
    await value(`document.querySelector('[data-action="play"]').click()`);
    const bottomBefore = await value(`document.querySelector('[data-board-seat="0"]').closest('.slots').className`);
    await value(`document.querySelector('[data-action="end-turn"]').click()`);
    const mask = await value(`document.querySelector('.handoff-mask') ? document.querySelector('.handoff-mask').textContent : ''`);
    if (!mask.includes('请交给对方') || !mask.includes('座位 1')) throw new Error('热座没有交接遮罩 ' + mask);
    const blocked = await value(`document.querySelectorAll('.slots.mine [data-card="xiao_yin"]').length`);
    await value(`document.querySelector('[data-action="handoff-confirm"]').click()`);
    const bottomAfter = await value(`document.querySelector('[data-board-seat="0"]').closest('.slots').className`);
    if (bottomBefore !== bottomAfter || blocked !== 1) throw new Error('热座换人把单位搬了边');
    await shot('09-hotseat-fixed-1280');
    evidence.push('热座换人有请交给对方，座位 0 的单位留在下方');

    await value(`document.querySelector('[data-action="mode"][data-mode="sim"]').click()`);
    await sleep(40);
    snap = await state();
    eq(snap.opening, 'sim', '模拟战入口');
    eq(snap.pool, '96', '可入池张数');
    if (!snap.seed) throw new Error('没有显示种子');
    eq(snap.deck0.split(',').length, 30, '玩家 30 张');
    eq(snap.deck1.split(',').length, 30, '对方 30 张');
    const firstSeed = snap.seed;
    const firstDecks = snap.deck0 + '|' + snap.deck1;
    await value(`document.querySelector('[data-action="replay-seed"]').click()`);
    snap = await state();
    eq(snap.seed, firstSeed, '同一种子');
    eq(snap.deck0 + '|' + snap.deck1, firstDecks, '同一种子重放两副牌');
    await value(`document.querySelector('[data-action="mode"][data-mode="sim"]').click()`);
    snap = await state();
    if (snap.seed === firstSeed) throw new Error('重开模拟战没有换种子');
    await shot('10-sim-1280');
    evidence.push('模拟战可入池 96 张，每边 30 张，同一种子重放，重开换种子');

    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await value(`document.querySelector('[data-action="mode"][data-mode="versus"]').click()`);
    await sleep(80);
    const phoneCard = await box('[data-action="select-hand"][data-card="xiao_yin"]', 24);
    await touch('touchStart', [{ x: phoneCard.x, y: phoneCard.y, id: 1 }]);
    await touch('touchMove', [{ x: phoneCard.x, y: phoneCard.y - 40, id: 1 }]);
    await sleep(50);
    const phoneSeam = await box('.slots.mine .insert', 20);
    await touch('touchMove', [{ x: phoneSeam.x, y: phoneSeam.y, id: 1 }]);
    const phoneDrag = await value(`({ collapsed: document.body.classList.contains('hand-out'), greens: document.querySelectorAll('[data-mark="legal"], [data-mark="hot"]').length, foe: document.querySelector('.slots.foe').getBoundingClientRect().height })`);
    if (!phoneDrag.collapsed || phoneDrag.greens < 1 || phoneDrag.foe < 40) throw new Error('手机拖出没有露目标 ' + JSON.stringify(phoneDrag));
    await shot('11-phone-drag-390');
    await touch('touchEnd', []);
    await sleep(80);
    snap = await state();
    eq(snap.supply, '0', '触屏拖放扣一次电');
    eq(snap.mine, 'xiao_yin', '触屏只部署一张');
    await value(`document.querySelector('[data-board-seat="0"][data-card="xiao_yin"]').click()`);
    const phoneMenu = await value(`(document.querySelector('.skill-bar') || {}).textContent || ''`);
    if (!phoneMenu.includes('复活厚壳 · 1电') || phoneMenu.includes('攻击+1')) throw new Error('手机技能归属不对 ' + phoneMenu);
    const bar = await value(`(() => { const bar = document.querySelector('.skill-bar').getBoundingClientRect(); const foe = document.querySelector('.slots.foe').getBoundingClientRect(); const core = document.querySelector('.core-slot.foe').getBoundingClientRect(); const hit = !(bar.bottom < foe.top || bar.top > foe.bottom || bar.right < foe.left || bar.left > foe.right); const coreHit = !(bar.bottom < core.top || bar.top > core.bottom || bar.right < core.left || bar.left > core.right); return { hit, coreHit }; })()`);
    if (bar.hit || bar.coreHit) throw new Error('手机技能条挡住了对方');
    const hold = await box('[data-action="select-hand"][data-card="art_h024"]', 20);
    await touch('touchStart', [{ x: hold.x, y: hold.y, id: 1 }]);
    await sleep(460);
    const peek = await value(`(document.querySelector('.peek') || {}).textContent || ''`);
    await touch('touchEnd', []);
    await sleep(40);
    snap = await state();
    if (!peek.includes('只查看')) throw new Error('长按没有打开查看 ' + peek);
    eq(snap.supply, '0', '长按不出牌不扣电');
    if (!snap.hand.includes('art_h024')) throw new Error('长按把牌打出去了');
    await shot('12-phone-played-390');
    evidence.push('390×844 触屏拖出小印只部署一次，长按只查看，技能条没有挡住对方');

    fs.writeFileSync(path.join(shotDir, 'evidence.json'), JSON.stringify({ evidence, pool: 96 }, null, 2));
    console.log('PASS pointer');
    evidence.forEach(line => console.log(' -', line));
  } finally {
    chrome.kill('SIGKILL');
    server.kill('SIGKILL');
  }
}

main().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
