'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const shotDir = process.env.CLASH_SHOTS || '/tmp/clash-shots';
fs.mkdirSync(shotDir, { recursive: true });
const port = 8002;
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
async function waitFor(fn, label) {
  let last;
  for (let i = 0; i < 50; i++) {
    try { return await fn(); } catch (error) { last = error; }
    await sleep(200);
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
  return { ws, send, value };
}

async function main() {
  const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe']
  });
  const chrome = spawn(chromeBin, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--remote-debugging-port=9333', '--window-size=1440,1100',
    `--user-data-dir=/tmp/chrome-clash-${process.pid}`, 'about:blank'
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await waitFor(async () => {
      const res = await get(`http://127.0.0.1:${port}/dist/clash/`);
      if (res.status !== 200 || !res.body.includes('pcg.clash.v0')) throw new Error('page not ready');
    }, 'static server');
    const pages = await waitFor(async () => {
      const list = JSON.parse((await get('http://127.0.0.1:9333/json')).body);
      const page = list.find(item => item.type === 'page' && item.webSocketDebuggerUrl);
      if (!page) throw new Error('no page');
      return page;
    }, 'chrome');
    const { send, value } = await connect(pages.webSocketDebuggerUrl);
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: 'window.__errors=[];addEventListener("error",event=>window.__errors.push(String(event.message)));'
    });
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/dist/clash/` });
    await waitFor(async () => {
      if (await value('document.body && document.body.dataset.ready') !== '1') throw new Error('not ready');
    }, 'app render');

    const q = selector => JSON.stringify(selector);
    async function click(selector) {
      const found = await value(`(() => { const el = document.querySelector(${q(selector)}); if (!el) return ''; el.click(); return 'ok'; })()`);
      if (found !== 'ok') throw new Error('找不到 ' + selector);
      if (String(selector).includes('end-turn')) {
        await sleep(60);
        await value(`(() => { const el = document.querySelector('[data-action="handoff-confirm"]'); if (el) el.click(); return 'ok'; })()`);
        await sleep(40);
      }
    }
    async function dblclick(selector) {
      const box = await value(`(() => { const el = document.querySelector(${q(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + Math.min(r.height / 2, 24) }; })()`);
      if (!box) throw new Error('找不到 ' + selector);
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
      await sleep(50);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 2 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 2 });
      await sleep(80);
    }
    const text = selector => value(`(() => { const el = document.querySelector(${q(selector)}); return el ? el.textContent.trim() : null; })()`);
    const attr = (selector, name) => value(`(() => { const el = document.querySelector(${q(selector)}); return el ? el.getAttribute(${q(name)}) : null; })()`);
    const cardsIn = selector => value(`Array.from(document.querySelectorAll(${q(selector + ' [data-card]')})).map(el => el.getAttribute('data-card')).join(',')`);
    async function shot(name) {
      const image = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(shotDir, name + '.png'), Buffer.from(image.data, 'base64'));
    }
    function eq(actual, expected, label) {
      if (actual !== expected) throw new Error(label + ' 实际 ' + JSON.stringify(actual) + ' 期望 ' + JSON.stringify(expected));
    }
    async function errors() {
      const list = await value('window.__errors.join(" | ")');
      if (list) throw new Error('页面脚本错误 ' + list);
    }

    eq(await attr('main.table', 'data-ruleset'), 'pcg.clash.v0', '规则编号');
    eq(await attr('main.table', 'data-source-commit'), '7ba58fb399956409ebc60323e2cca595c46112a0', '来源提交');
    eq(await attr('main.table', 'data-mode'), 'ai', '默认人机');
    eq(await attr('main.table', 'data-opening'), 'lesson', '默认是固定教学');
    await click('[data-action="mode"][data-mode="hotseat"]');
    eq(await attr('main.table', 'data-mode'), 'hotseat', '教学局改走本地双人');
    eq(await text('[data-seat="0"][data-stat="base"]'), '20', '先手基地');
    eq(await text('[data-seat="1"][data-stat="base"]'), '20', '后手基地');
    eq(await text('[data-seat="0"][data-stat="supply"]'), '1', '先手供电');
    eq(await text('[data-seat="0"][data-stat="max-supply"]'), '1', '先手上限');
    eq(await attr('[data-hand-seat="1"]', 'data-hidden'), '1', '后手手牌默认遮住');
    const hidden = await text('[data-hand-seat="1"]');
    if (hidden.includes('护罩') || hidden.includes('借一格电') || hidden.includes('点阵哨')) throw new Error('遮住的手牌仍露出了牌名');
    if ((await text('#app')).includes('点阵哨')) throw new Error('开局页面露出了还在牌库里的点阵哨');
    await shot('01-opening');

    await dblclick('[data-action="select-hand"][data-card="xiao_yin"]');
    eq(await value(`document.querySelectorAll('[data-board-seat="0"][data-card="xiao_yin"]').length`), 1, '双击只部署一次');
    eq(await attr('[data-board-seat="0"][data-slot="0"]', 'data-card'), 'xiao_yin', '小印入场');
    eq(await attr('[data-board-seat="0"][data-slot="0"]', 'data-sick'), 'true', '小印新入场');
    eq(await text('[data-seat="0"][data-stat="supply"]'), '0', '打出后供电');
    await sleep(250);
    const handAfter = await cardsIn('[data-hand-seat="0"]');
    await click('[data-action="select-hand"][data-card="art_h024"]');
    await click('[data-action="play"]');
    eq(await text('[data-seat="0"][data-stat="supply"]'), '0', '3 费新细条不扣电');
    eq(await cardsIn('[data-hand-seat="0"]'), handAfter, '第 1 回合打不出新细条');
    eq(await attr('#last-error', 'data-code'), 'not_enough_supply', '电不足有提示');
    await click('[data-action="end-turn"]');
    eq(await attr('#turn-label', 'data-seat'), '1', '结束回合后立刻换人');
    eq(await text('[data-seat="1"][data-stat="supply"]'), '1', '后手起手供电');
    eq(await cardsIn('[data-hand-seat="1"]'), 'art_h024,hu_zhao,xiao_yin,gan_rao,jie_yi_ge_dian,dian_zhen', '后手抽到点阵哨');
    await dblclick('[data-action="select-hand"][data-card="hu_zhao"]');
    eq(await cardsIn('[data-hand-seat="1"]'), 'art_h024,hu_zhao,xiao_yin,gan_rao,jie_yi_ge_dian,dian_zhen', '配件双击不瞎装');
    eq(await text('[data-seat="1"][data-stat="supply"]'), '1', '配件双击不扣电');
    if (!(await text('#coach')).includes('目标')) throw new Error('配件双击没有进入选目标');
    await click('[data-action="select-hand"][data-card="jie_yi_ge_dian"]');
    await click('[data-action="play"]');
    eq(await text('[data-seat="1"][data-stat="supply"]'), '2', '借电后当前供电');
    eq(await text('[data-seat="1"][data-stat="max-supply"]'), '1', '借电不改上限');
    await shot('02-coin');
    await click('[data-action="select-hand"][data-card="dian_zhen"]');
    await click('[data-action="play"]');
    await click('[data-board-seat="1"][data-card="dian_zhen"]');
    await click('[data-action="attack-base"]');
    eq(await attr('#last-error', 'data-code'), 'summoning_sickness', '新入场不能攻击');
    eq(await text('[data-seat="0"][data-stat="base"]'), '20', '非法攻击不掉血');
    eq(await attr('[data-board-seat="1"][data-card="dian_zhen"]', 'data-sick'), 'true', '拒绝后仍是新入场');
    await click('[data-action="end-turn"]');

    eq(await attr('#turn-label', 'data-seat'), '0', '回到先手');
    eq(await cardsIn('[data-hand-seat="0"]'), 'art_h024,bu_ji,dian_zhen', '先手第二回合抽牌');
    await click('[data-board-seat="0"][data-card="xiao_yin"]');
    await click('[data-board-seat="1"][data-card="dian_zhen"]');
    eq(await cardsIn('[data-grave="0"]'), 'xiao_yin', '领队小印被反击打死');
    eq(await attr('[data-board-seat="1"][data-card="dian_zhen"]', 'data-durability'), '1', '点阵哨被打到 1');
    eq(await text('[data-seat="1"][data-stat="base"]'), '20', '这一击没有打基地');
    await click('[data-action="end-turn"]');

    await click('[data-board-seat="1"][data-card="dian_zhen"]');
    await click('[data-action="attack-base"]');
    eq(await text('[data-seat="0"][data-stat="base"]'), '18', '点阵哨领队打先手基地');
    await click('[data-action="select-hand"][data-card="xiao_yin"]');
    await click('[data-action="play"]');
    eq(await attr('[data-board-seat="1"][data-card="xiao_yin"]', 'data-sick'), 'true', '后手小印新入场');
    await click('[data-action="end-turn"]');

    await click('[data-action="select-hand"][data-card="art_h024"]');
    await click('[data-action="play"]');
    eq(await text('[data-seat="0"][data-stat="base"]'), '18', '教学局先手基地');
    eq(await text('[data-seat="1"][data-stat="base"]'), '20', '教学局后手基地');
    eq(await attr('[data-board-seat="0"][data-slot="0"]', 'data-card'), 'art_h024', '先手打出新细条');
    eq(await attr('[data-board-seat="0"][data-slot="0"]', 'data-sick'), 'true', '新细条新入场');
    eq(await attr('[data-board-seat="1"][data-slot="0"]', 'data-card'), 'dian_zhen', '后手点阵哨还在');
    eq(await attr('[data-board-seat="1"][data-card="xiao_yin"]', 'data-card'), 'xiao_yin', '后手小印还在');
    eq(await cardsIn('[data-grave="0"]'), 'xiao_yin', '先手墓地只有小印');
    eq(await cardsIn('[data-grave="1"]'), 'jie_yi_ge_dian', '后手墓地只有借电');
    await shot('03-turn-three');
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
    await shot('03b-turn-three-1280');
    await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
    await shot('03c-turn-three-1920');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
    await click('[data-action="end-turn"]');
    eq(await attr('#turn-label', 'data-seat'), '1', '第三回合结束后立刻后手');
    eq(await text('[data-seat="1"][data-stat="supply"]'), '3', '后手新回合供电');
    eq(await text('[data-seat="1"][data-stat="max-supply"]'), '3', '后手上限加一');
    if (!(await cardsIn('[data-hand-seat="1"]')).split(',').includes('hou_ke')) throw new Error('后手没有抽到下一张');
    eq(await attr('[data-hand-seat="0"]', 'data-hidden'), '1', '换人后先手手牌重新遮住');
    await click('[data-action="toggle-reveal"]');
    if (await attr('#reveal-banner', 'hidden') != null) throw new Error('教学明牌标识没有出现');
    if (!(await text('#reveal-banner')).includes('教学明牌')) throw new Error('缺少教学明牌文字');
    if (!(await cardsIn('[data-hand-seat="0"]')).split(',').includes('lian_jie')) throw new Error('明牌后仍看不见先手手牌');
    await shot('04-reveal');
    await errors();

    await click('[data-action="scenario"][data-scenario="support-present"]');
    await click('[data-board-seat="0"][data-card="xiao_yin"]');
    const abilityMenu = await text('.skill-bar');
    if (!abilityMenu.includes('复活厚壳 · 1电') || !abilityMenu.includes('打基地')) throw new Error('技能按钮 ' + abilityMenu);
    if (abilityMenu.includes('2电')) throw new Error('支援写成了 2 电');
    await shot('20-action-menu');
    await click('[data-action="support"]');
    eq(await text('[data-seat="0"][data-stat="supply"]'), '5', '支援扣 1');
    eq(await attr('[data-board-seat="0"][data-slot="0"]', 'data-card'), 'hou_ke', '厚壳插到最左');
    eq(await attr('[data-board-seat="0"][data-slot="1"]', 'data-card'), 'xiao_yin', '小印被挤到右边');
    eq(await attr('[data-board-seat="0"][data-slot="0"]', 'data-durability'), '7', '厚壳满耐久');
    eq(await attr('[data-board-seat="0"][data-slot="0"]', 'data-guard'), 'true', '厚壳护卫');
    eq(await attr('[data-board-seat="0"][data-slot="0"]', 'data-sick'), 'true', '厚壳新入场');
    eq(await cardsIn('[data-grave="0"]'), '', '厚壳离开墓地');
    await click('[data-board-seat="0"][data-card="xiao_yin"]');
    const usedMenu = await text('.skill-bar');
    if (!usedMenu.includes('本回合这个技能已经用过')) throw new Error('用过的支援没有灰掉 ' + usedMenu);
    await shot('21-action-disabled');
    await click('[data-action="support"]');
    eq(await attr('#last-error', 'data-code'), 'already_used_ability', '再支援');
    eq(await text('[data-seat="0"][data-stat="supply"]'), '5', '再支援不扣电');
    await click('[data-board-seat="0"][data-card="hou_ke"]');
    await click('[data-board-seat="1"][data-card="dian_zhen"]');
    eq(await attr('#last-error', 'data-code'), 'summoning_sickness', '复活单位不能立刻攻击');
    eq(await attr('[data-board-seat="1"][data-card="dian_zhen"]', 'data-durability'), '3', '非法攻击不掉耐久');
    await click('[data-board-seat="0"][data-card="xiao_yin"]');
    await click('[data-action="attack-base"]');
    eq(await attr('#last-error', 'data-code'), 'guard_blocks', '护卫挡基地');
    eq(await text('[data-seat="1"][data-stat="base"]'), '18', '护卫拦截不掉血');
    await click('[data-action="select-hand"][data-card="bu_ji"]');
    await click('[data-board-seat="0"][data-card="hou_ke"]');
    await click('[data-action="mend-heal"]');
    eq(await attr('[data-board-seat="0"][data-card="hou_ke"]', 'data-durability'), '7', '治疗不超过卡面');
    eq(await text('[data-seat="0"][data-stat="supply"]'), '4', '补给扣费');
    await click('[data-action="select-hand"][data-card="gan_rao"]');
    await click('[data-board-seat="1"][data-card="dian_zhen"]');
    eq(await attr('[data-board-seat="1"][data-card="dian_zhen"]', 'data-durability'), '1', '干扰无视护卫');
    eq(await text('[data-seat="0"][data-stat="supply"]'), '2', '干扰扣费');
    await shot('05-support-present');

    await click('[data-action="scenario"][data-scenario="support-deploy"]');
    if (await value(`document.querySelector('[data-action="support"]')`) != null) throw new Error('没有小印仍出现复活');
    eq(await text('[data-seat="0"][data-stat="supply"]'), '6', '失败不扣电');
    eq(await cardsIn('[data-grave="0"]'), 'hou_ke', '厚壳还在墓地');
    await click('[data-action="select-hand"][data-card="xiao_yin"]');
    await click('[data-action="play"]');
    eq(await text('[data-seat="0"][data-stat="supply"]'), '5', '先支付登场费用');
    await click('[data-board-seat="0"][data-card="xiao_yin"]');
    await click('[data-action="support"]');
    eq(await text('[data-seat="0"][data-stat="supply"]'), '4', '新入场的小印可以支援');
    eq(await attr('[data-board-seat="0"][data-slot="0"]', 'data-card'), 'hou_ke', '厚壳插到最左');
    eq(await attr('[data-board-seat="0"][data-slot="1"]', 'data-card'), 'xiao_yin', '小印仍在场上');
    await click('[data-board-seat="0"][data-card="hou_ke"]');
    await click('[data-action="attack-base"]');
    eq(await attr('#last-error', 'data-code'), 'summoning_sickness', '厚壳不能攻击');
    await click('[data-board-seat="0"][data-card="xiao_yin"]');
    await click('[data-action="attack-base"]');
    eq(await attr('#last-error', 'data-code'), 'summoning_sickness', '小印也不能攻击');
    await shot('06-support-deploy');

    await click('[data-action="scenario"][data-scenario="support-again"]');
    eq(await attr('#turn-label', 'data-seat'), '1', '再死战例先由后手行动');
    eq(await attr('[data-board-seat="0"][data-slot="0"]', 'data-durability'), '2', '厚壳残血');
    await click('[data-action="select-hand"][data-card="gan_rao"]');
    await click('[data-board-seat="0"][data-card="hou_ke"]');
    eq(await cardsIn('[data-grave="0"]'), 'hou_ke', '厚壳进自己墓地');
    eq(await attr('[data-board-seat="0"][data-slot="0"]', 'data-card'), 'xiao_yin', '死亡后队列收紧，小印到最左');
    await click('[data-action="end-turn"]');
    eq(await attr('#turn-label', 'data-seat'), '0', '结束后先手回合');
    eq(await text('[data-seat="0"][data-stat="supply"]'), '4', '先手回满');
    await click('[data-board-seat="0"][data-card="xiao_yin"]');
    await click('[data-action="support"]');
    eq(await attr('[data-board-seat="0"][data-slot="0"]', 'data-card'), 'hou_ke', '厚壳回到最左空位');
    eq(await attr('[data-board-seat="0"][data-slot="0"]', 'data-durability'), '7', '再次满耐久');
    eq(await attr('[data-board-seat="0"][data-slot="1"]', 'data-card'), 'xiao_yin', '小印仍在位置 1');
    eq(await text('[data-seat="0"][data-stat="supply"]'), '3', '再次支援扣 1');
    await shot('07-support-again');
    await click('[data-action="scenario"][data-scenario="promote-stamp"]');
    await click('[data-action="promote"][data-current="xiao_yin"]');
    eq(await text('[data-seat="0"][data-stat="supply"]'), '4', '升星只付差价');
    eq(await attr('[data-board-seat="0"][data-slot="2"]', 'data-card'), 'art_h038a', '小印升成小印改');
    eq(await attr('[data-board-seat="0"][data-slot="2"]', 'data-durability'), '2', '升星满耐久');
    eq(await attr('[data-board-seat="0"][data-slot="2"]', 'data-sick'), 'true', '升星当回合不能攻击');
    eq(await cardsIn('[data-grave="0"]'), 'hou_ke,lian_jie,xiao_yin', '旧配件先于旧主控，原来的墓地牌仍在前面');
    await shot('08-promote');
    await click('[data-action="scenario"][data-scenario="builder"]');
    if (!(await text('[data-deck="0"]')).includes('小印改')) throw new Error('扩展牌组没有带上二星');
    if (!(await text('[data-deck="0"]')).includes('链节')) throw new Error('没有图的基线牌被丢掉了');
    await click('[data-action="pool-filter"][data-value="all"]');
    const midPool = await text('.pool');
    for (const line of ['轨上表 · 2费', '气表 · 2费', '轨上表改 · 3费', '气表改 · 3费', '灯墙 · 3费', '电枢纽 · 5费', '千里眼 · 4费']) {
      if (!midPool.includes(line)) throw new Error('组牌没有按新费用显示 ' + line);
    }
    await shot('09-deck-builder');
    await click('[data-action="start-free"]');
    await click('[data-action="select-hand"][data-card="art_h039a"]');
    await click('[data-action="play"]');
    eq(await attr('[data-board-seat="0"][data-card="art_h039a"]', 'data-sick'), 'false', '冲锋打出后可以攻击');
    await click('[data-board-seat="0"][data-card="art_h039a"]');
    await click('[data-action="attack-base"]');
    eq(await text('[data-seat="1"][data-stat="base"]'), '18', '扩展对局里的牌能造成伤害');
    await shot('10-roster-play');
    await click('[data-action="scenario"][data-scenario="grow"]');
    const kept = await attr('[data-board-seat="0"][data-slot="0"]', 'data-iid');
    await click('[data-action="select-hand"][data-card="art_h024"]');
    await click('[data-action="play"]');
    eq(await value(`document.querySelectorAll('[data-board-seat="0"][data-card]').length`), 6, '第 6 台排到最右');
    eq(await attr('[data-board-seat="0"][data-slot="0"]', 'data-iid'), kept, '追加不挪动原来的最左');
    eq(await attr('[data-board-seat="0"][data-slot="5"]', 'data-card'), 'art_h024', '新单位在最右');
    await click('[data-board-seat="0"][data-card="xiao_yin"]');
    await click('[data-action="support"]');
    eq(await value(`document.querySelectorAll('[data-board-seat="0"][data-card]').length`), 7, '支援后是 7 台');
    eq(await attr('[data-board-seat="0"][data-slot="0"]', 'data-card'), 'hou_ke', '第 7 台是插到最左的厚壳');
    eq(await attr('[data-board-seat="0"][data-slot="1"]', 'data-iid'), kept, '原来的最左只是右移');
    await click(`[data-iid="${kept}"]`);
    await click('[data-board-seat="1"][data-card="hou_ke"]');
    eq(await attr('[data-board-seat="1"][data-card="hou_ke"]', 'data-durability'), '2', '打中指定的厚壳');
    eq(await attr('[data-board-seat="1"][data-card="art_h024"]', 'data-durability'), '4', '旁边的细条没有被误伤');
    if (await value(`document.querySelectorAll('.socket').length`) !== 0) throw new Error('还在画固定空槽');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    const desk = await value(`(() => {
      const unit = document.querySelector('.slots.mine .minion').getBoundingClientRect();
      const card = document.querySelector('.hands .playcard').getBoundingClientRect();
      return { unitW: unit.width, unitH: unit.height, cardW: card.width, cardH: card.height };
    })()`);
    if (desk.unitW < 120 || desk.cardH < 140) throw new Error('桌面牌没有用上工作面 ' + JSON.stringify(desk));
    await shot('10b-seven-units');
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await shot('11-narrow-table');
    const narrow = await value(`(() => {
      const clipped = node => {
        let parent = node.parentElement;
        while (parent) {
          const style = getComputedStyle(parent);
          if (/(auto|scroll|hidden)/.test(style.overflowX) && parent.scrollWidth > parent.clientWidth + 1) return true;
          parent = parent.parentElement;
        }
        return false;
      };
      const nodes = [...document.querySelectorAll('.end-turn, .playcard, .minion, .base-btn, .slot, .back, .supply-read')];
      const spilled = nodes.some(node => {
        const box = node.getBoundingClientRect();
        if (box.width <= 8 || clipped(node)) return false;
        return box.right > window.innerWidth + 4 || box.left < -4;
      });
      const hand = document.querySelector('.hand-dock');
      const end = document.querySelector('.end-turn');
      const handBox = hand.getBoundingClientRect();
      const endBox = end.getBoundingClientRect();
      const overlap = !(endBox.bottom <= handBox.top || endBox.top >= handBox.bottom);
      const card = [...document.querySelectorAll('.hands .playcard')].find(node => node.querySelector('img'));
      const art = card && card.querySelector('img');
      const supply = document.querySelector('.supply-read');
      return {
        spilled,
        pageWider: document.documentElement.scrollWidth > window.innerWidth + 4,
        overlap,
        handTop: handBox.top,
        handBottom: handBox.bottom,
        view: window.innerHeight,
        attack: card ? card.querySelector('.patk').textContent : '',
        artWidth: art ? art.naturalWidth : 0,
        artSrc: art ? art.getAttribute('src') : '',
        supply: supply.textContent.replace(/\\s+/g, ' '),
        supplyTall: supply.getBoundingClientRect().height
      };
    })()`);
    if (narrow.spilled || narrow.pageWider) throw new Error('窄屏牌桌有控件伸出屏幕');
    if (narrow.overlap) throw new Error('结束回合盖住了手牌');
    if (narrow.handBottom > narrow.view + 8) throw new Error('一屏内看不到自己的手牌');
    if (!narrow.attack) throw new Error('手牌没有游戏攻防');
    if (narrow.artSrc.includes('/card/')) throw new Error('手牌用了整张印刷卡');
    if (narrow.artWidth < 8) throw new Error('手牌主体图没有画出来');
    if (narrow.supplyTall > 36) throw new Error('供电数字被拆行');
    const phoneFit = await value(`(() => {
      const arena = document.querySelector('.arena').getBoundingClientRect();
      const card = document.querySelector('.hands .playcard').getBoundingClientRect();
      const unit = document.querySelector('.minion').getBoundingClientRect();
      const end = document.querySelector('.end-turn');
      const black = window.innerHeight - arena.height;
      return { arenaH: arena.height, view: window.innerHeight, black, cardW: card.width, unitW: unit.width, endLines: end.scrollHeight > end.clientHeight + 2 };
    })()`);
    if (phoneFit.black > phoneFit.view * 0.5) throw new Error('手机空白超过半屏');
    if (phoneFit.cardW < 90 || phoneFit.unitW < 72) throw new Error('手机牌太小');
    if (phoneFit.endLines) throw new Error('结束回合被拆行');
    await value(`document.querySelector('[data-card="art_h039a"]').scrollIntoView({inline:'center', block:'nearest'})`);
    const phonePlay = await value(`(() => {
      const card = document.querySelector('[data-action="select-hand"][data-card="art_h039a"]');
      card.click();
      return 'selected';
    })()`);
    if (phonePlay !== 'selected') throw new Error('手机点选手牌失败');
    await click('[data-action="play"]');
    await value(`document.querySelector('[data-board-seat="0"][data-card="art_h039a"]').scrollIntoView({inline:'center', block:'nearest'})`);
    await click('[data-board-seat="0"][data-card="art_h039a"]');
    await click('[data-board-seat="1"][data-card="hou_ke"]');
    eq(await cardsIn('[data-grave="1"]'), 'hou_ke', '手机点选后打中指定的厚壳');
    eq(await attr('[data-board-seat="1"][data-card="art_h024"]', 'data-durability'), '4', '手机攻击没有打到旁边的牌');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await click('[data-action="scenario"][data-scenario="synergy"]');
    eq(await attr('.formation', 'data-formation'), '10', '零键在最左，领队 10%');
    await click('[data-board-seat="0"][data-card="art_h050"]');
    await click('[data-action="upper-link"]');
    await click('[data-board-seat="0"][data-card="qiao_jian"]');
    eq(await text('[data-seat="0"][data-stat="supply"]'), '9', '第一次上位连接把当前电补回有效上限');
    if (!(await text('.formation')).includes('上位')) throw new Error('上位连接没有显示');
    await click('[data-action="select-hand"][data-card="lian_jie"]');
    await click('[data-action="insert"][data-index="1"]');
    await click('[data-board-seat="0"][data-card="qiao_jian"]');
    eq(await attr('.formation', 'data-formation'), '15', '链节紧挨领队是 15%');
    eq(await value(`document.querySelectorAll('.link-mark').length`), 1, '链节标记在队列里');
    await click('[data-board-seat="0"][data-card="qiao_jian"]');
    eq(await attr('.strike', 'data-strike'), '9', '链节和上位加在 15% 之前');
    await shot('16-synergy-desktop');
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await shot('17-synergy-phone');
    const synergyPhone = await value(`(() => {
      const clipped = node => {
        let parent = node.parentElement;
        while (parent) {
          const style = getComputedStyle(parent);
          if (/(auto|scroll|hidden)/.test(style.overflowX) && parent.scrollWidth > parent.clientWidth + 1) return true;
          parent = parent.parentElement;
        }
        return false;
      };
      const end = document.querySelector('.end-turn');
      const formation = document.querySelector('.formation');
      const spilled = [...document.querySelectorAll('.end-turn, .playcard, .minion, .link-mark, .base-btn')].some(node => {
        const box = node.getBoundingClientRect();
        if (box.width <= 8 || clipped(node)) return false;
        return box.right > window.innerWidth + 4 || box.left < -4;
      });
      return { spilled, pageWider: document.documentElement.scrollWidth > window.innerWidth + 4, endLines: end.scrollHeight > end.clientHeight + 2, formation: formation.textContent };
    })()`);
    if (synergyPhone.spilled || synergyPhone.pageWider) throw new Error('协同牌桌在手机上伸出屏幕');
    if (synergyPhone.endLines) throw new Error('结束回合被拆行');
    if (!synergyPhone.formation.includes('15%')) throw new Error('手机上看不到阵型');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await click('[data-action="scenario"][data-scenario="synergy"]');
    await click('[data-action="select-hand"][data-card="uiflow_blocks"]');
    await click('[data-action="play"]');
    eq(await attr('[data-hand-seat="0"] [data-card="hou_ke"]', 'data-card'), 'hou_ke', '积木开工抽到厚壳');
    await click('[data-action="select-hand"][data-card="ezdata_note"]');
    await click('[data-action="play"]');
    eq(await attr('[data-hand-seat="0"] [data-card="uiflow_blocks"]', 'data-card'), 'uiflow_blocks', '记一笔取回积木开工');
    await click('[data-action="select-hand"][data-card="aiflow_say"]');
    await click('[data-action="play"]');
    if (!(await text('.formation')).includes('说人话')) throw new Error('说人话没有武装');
    await click('[data-board-seat="0"][data-card="qiao_jian"]');
    eq(await attr('.strike', 'data-strike'), '8', '说人话在 10% 之前加 2');
    await click('[data-action="scenario"][data-scenario="synergy"]');
    await click('[data-action="select-hand"][data-card="burner_seize"]');
    await click('[data-board-seat="1"][data-card="hou_ke"]');
    eq(await text('[data-seat="0"][data-stat="supply"]'), '3', '夺舍花 7');
    eq(await attr('[data-board-seat="0"][data-card="hou_ke"]', 'data-durability'), '4', '夺舍保留当前耐久');
    eq(await attr('[data-board-seat="0"][data-card="hou_ke"]', 'data-sick'), 'true', '夺来的单位本回合不能攻击');
    eq(await value(`document.querySelector('[data-board-seat="1"][data-card="hou_ke"]')`), null, '厚壳离开对方队列');
    await click('[data-board-seat="0"][data-card="hou_ke"]');
    await click('[data-action="attack-base"]');
    eq(await attr('#last-error', 'data-code'), 'summoning_sickness', '刚夺来的单位攻击被拒绝');
    await shot('18-seize');
    await click('[data-action="scenario"][data-scenario="builder"]');
    await click('[data-action="pool-filter"][data-value="service"]');
    const servicePool = await text('.pool');
    if (!servicePool.includes('积木开工') || !servicePool.includes('树莓台')) throw new Error('组牌软件分区缺牌');
    if (servicePool.includes('小印')) throw new Error('软件分区混进了硬件牌');
    await shot('19-service-builder');
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/` });
    await waitFor(async () => { if (!(await value('document.body && document.body.innerText')).includes('同一套牌')) throw new Error('lobby'); }, 'lobby');
    await shot('12-lobby');
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/wiki/` });
    await waitFor(async () => { if ((await value('document.querySelector("#result-count") && document.querySelector("#result-count").textContent')) !== '96') throw new Error('wiki count'); }, 'wiki');
    await waitFor(async () => {
      const names = await value('document.querySelector("#service-grid") ? document.querySelector("#service-grid").innerText : ""');
      if (!names.includes('积木开工') || !names.includes('树莓台')) throw new Error('wiki services');
      if ((await value('document.querySelectorAll("#service-grid [data-sku=\\"none\\"]").length')) !== 5) throw new Error('service sku');
    }, 'wiki services');
    await shot('13-wiki-desktop');
    await value(`document.querySelector('#cost-chips button[data-kind="cost"][data-value="2"]').click()`);
    await waitFor(async () => { if ((await value('document.querySelector("#result-count").textContent')) !== '21') throw new Error('cost 2'); }, 'wiki cost 2');
    const din = await text('#tile-H036');
    if (!din.includes('2费') || !din.includes('系列整机') || !din.includes('轨上表')) throw new Error('轨上表档位 ' + din);
    const air = await text('#tile-H037');
    if (!air.includes('2费') || !air.includes('气表')) throw new Error('气表档位 ' + air);
    await shot('13b-wiki-cost2');
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/wiki/?card=H017` });
    await waitFor(async () => {
      const detail = await text('#detail');
      if (!detail.includes('系列档') || !detail.includes('系列整机') || !detail.includes('护卫')) throw new Error('电枢纽 ' + detail);
    }, 'wiki powerhub');
    await shot('13c-wiki-powerhub');
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/wiki/` });
    await waitFor(async () => { if ((await value('document.querySelector("#result-count").textContent')) !== '96') throw new Error('wiki reset'); }, 'wiki reset');
    await value(`document.querySelector('#q').value = '二代壳'; document.querySelector('#q').dispatchEvent(new Event('input', {bubbles:true}));`);
    await waitFor(async () => { if ((await value('document.querySelector("#result-count").textContent')) !== '2') throw new Error('search'); }, 'wiki search');
    await shot('14-wiki-search');
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/wiki/` });
    await waitFor(async () => { if ((await value('document.querySelector("#result-count") && document.querySelector("#result-count").textContent')) !== '96') throw new Error('wiki narrow'); }, 'wiki narrow');
    await shot('15-wiki-narrow');
    await errors();
    console.log('PASS browser lesson, support, promote and roster play');
  } finally {
    server.kill('SIGTERM');
    chrome.kill('SIGTERM');
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
