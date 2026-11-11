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
    eq(await attr('main.table', 'data-source-commit'), '704411fcb6138a05f9fdf8c168a366b7a2bb8237', '来源提交');
    eq(await text('[data-seat="0"][data-stat="base"]'), '20', '先手基地');
    eq(await text('[data-seat="1"][data-stat="base"]'), '20', '后手基地');
    eq(await text('[data-seat="0"][data-stat="supply"]'), '1', '先手供电');
    eq(await text('[data-seat="0"][data-stat="max-supply"]'), '1', '先手上限');
    eq(await attr('[data-hand-seat="1"]', 'data-hidden'), '1', '后手手牌默认遮住');
    const hidden = await text('[data-hand-seat="1"]');
    if (hidden.includes('护罩') || hidden.includes('借一格电') || hidden.includes('点阵哨')) throw new Error('遮住的手牌仍露出了牌名');
    if ((await text('#app')).includes('点阵哨')) throw new Error('开局页面露出了还在牌库里的点阵哨');
    await shot('01-opening');

    await click('[data-action="select-hand"][data-card="xi_tiao"]');
    await click('[data-action="play"]');
    eq(await attr('[data-board-seat="0"][data-slot="0"]', 'data-card'), 'xi_tiao', '细条入场');
    eq(await attr('[data-board-seat="0"][data-slot="0"]', 'data-sick'), 'true', '细条新入场');
    eq(await text('[data-seat="0"][data-stat="supply"]'), '0', '打出后供电');
    await click('[data-action="end-turn"]');
    eq(await attr('#turn-label', 'data-seat'), '1', '结束回合后立刻换人');
    eq(await text('[data-seat="1"][data-stat="supply"]'), '1', '后手起手供电');
    eq(await cardsIn('[data-hand-seat="1"]'), 'xi_tiao,hu_zhao,xiao_yin,gan_rao,jie_yi_ge_dian,dian_zhen', '后手抽到点阵哨');
    await click('[data-action="select-hand"][data-card="jie_yi_ge_dian"]');
    await click('[data-action="play"]');
    eq(await text('[data-seat="1"][data-stat="supply"]'), '2', '借电后当前供电');
    eq(await text('[data-seat="1"][data-stat="max-supply"]'), '1', '借电不改上限');
    await shot('02-coin');
    await click('[data-action="select-hand"][data-card="xiao_yin"]');
    await click('[data-action="play"]');
    await click('[data-board-seat="1"][data-card="xiao_yin"]');
    await click('[data-action="attack-base"]');
    eq(await attr('#last-error', 'data-code'), 'summoning_sickness', '新入场不能攻击');
    eq(await text('[data-seat="0"][data-stat="base"]'), '20', '非法攻击不掉血');
    eq(await attr('[data-board-seat="1"][data-card="xiao_yin"]', 'data-sick'), 'true', '拒绝后仍是新入场');
    await click('[data-action="end-turn"]');

    eq(await attr('#turn-label', 'data-seat'), '0', '回到先手');
    eq(await cardsIn('[data-hand-seat="0"]'), 'xiao_yin,bu_ji,dian_zhen', '先手第二回合抽牌');
    await click('[data-action="select-hand"][data-card="xiao_yin"]');
    await click('[data-action="play"]');
    await click('[data-board-seat="0"][data-card="xi_tiao"]');
    await click('[data-action="attack-base"]');
    eq(await text('[data-seat="1"][data-stat="base"]'), '19', '打基地不反击');
    await click('[data-board-seat="0"][data-card="xi_tiao"]');
    await click('[data-action="attack-base"]');
    eq(await attr('#last-error', 'data-code'), 'already_attacked', '不能连打');
    eq(await text('[data-seat="1"][data-stat="base"]'), '19', '连打不重复扣血');
    await click('[data-action="end-turn"]');

    await click('[data-action="select-hand"][data-card="xi_tiao"]');
    await click('[data-action="play"]');
    await click('[data-board-seat="1"][data-card="xiao_yin"]');
    await click('[data-board-seat="0"][data-card="xi_tiao"]');
    eq(await cardsIn('[data-grave="0"]'), 'xi_tiao', '先手细条进墓地');
    eq(await attr('[data-board-seat="1"][data-card="xiao_yin"]', 'data-durability'), '1', '后手小印剩 1');
    await click('[data-action="end-turn"]');

    await click('[data-action="select-hand"][data-card="dian_zhen"]');
    await click('[data-action="play"]');
    await click('[data-board-seat="0"][data-card="xiao_yin"]');
    await click('[data-board-seat="1"][data-card="xiao_yin"]');
    eq(await text('[data-seat="0"][data-stat="base"]'), '20', '对砍后先手基地');
    eq(await text('[data-seat="1"][data-stat="base"]'), '19', '对砍后后手基地');
    eq(await attr('[data-board-seat="0"][data-slot="0"]', 'data-card'), 'dian_zhen', '先手只剩点阵哨');
    eq(await attr('[data-board-seat="0"][data-slot="0"]', 'data-sick'), 'true', '点阵哨新入场');
    eq(await attr('[data-board-seat="0"][data-slot="0"]', 'data-guard'), 'true', '点阵哨护卫');
    eq(await attr('[data-board-seat="1"][data-slot="1"]', 'data-card'), 'xi_tiao', '后手细条留在原位');
    eq(await cardsIn('[data-grave="0"]'), 'xi_tiao,xiao_yin', '先手墓地顺序');
    eq(await cardsIn('[data-grave="1"]'), 'jie_yi_ge_dian,xiao_yin', '后手墓地顺序');
    await shot('03-turn-three');
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
    await click('[data-action="support"]');
    eq(await text('[data-seat="0"][data-stat="supply"]'), '4', '支援扣 2');
    eq(await attr('[data-board-seat="0"][data-slot="0"]', 'data-card'), 'xiao_yin', '小印留在原位');
    eq(await attr('[data-board-seat="0"][data-slot="1"]', 'data-card'), 'hou_ke', '厚壳进最左空位');
    eq(await attr('[data-board-seat="0"][data-slot="1"]', 'data-durability'), '6', '厚壳满耐久');
    eq(await attr('[data-board-seat="0"][data-slot="1"]', 'data-guard'), 'true', '厚壳护卫');
    eq(await attr('[data-board-seat="0"][data-slot="1"]', 'data-sick'), 'true', '厚壳新入场');
    eq(await cardsIn('[data-grave="0"]'), '', '厚壳离开墓地');
    await click('[data-action="support"]');
    eq(await attr('#last-error', 'data-code'), 'already_used_ability', '再支援');
    eq(await text('[data-seat="0"][data-stat="supply"]'), '4', '再支援不扣电');
    await click('[data-board-seat="0"][data-card="hou_ke"]');
    await click('[data-board-seat="1"][data-card="dian_zhen"]');
    eq(await attr('#last-error', 'data-code'), 'summoning_sickness', '复活单位不能立刻攻击');
    eq(await attr('[data-board-seat="1"][data-card="dian_zhen"]', 'data-durability'), '4', '非法攻击不掉耐久');
    await click('[data-board-seat="0"][data-card="xiao_yin"]');
    await click('[data-action="attack-base"]');
    eq(await attr('#last-error', 'data-code'), 'guard_blocks', '护卫挡基地');
    eq(await text('[data-seat="1"][data-stat="base"]'), '18', '护卫拦截不掉血');
    await click('[data-action="select-hand"][data-card="bu_ji"]');
    await click('[data-board-seat="0"][data-card="hou_ke"]');
    await click('[data-action="mend-heal"]');
    eq(await attr('[data-board-seat="0"][data-card="hou_ke"]', 'data-durability'), '6', '治疗不超过卡面');
    eq(await text('[data-seat="0"][data-stat="supply"]'), '3', '补给扣费');
    await click('[data-action="select-hand"][data-card="gan_rao"]');
    await click('[data-board-seat="1"][data-card="dian_zhen"]');
    eq(await attr('[data-board-seat="1"][data-card="dian_zhen"]', 'data-durability'), '2', '干扰无视护卫');
    eq(await text('[data-seat="0"][data-stat="supply"]'), '1', '干扰扣费');
    await shot('05-support-present');

    await click('[data-action="scenario"][data-scenario="support-deploy"]');
    await click('[data-action="support"]');
    eq(await attr('#last-error', 'data-code'), 'no_stamp_on_board', '没有小印');
    eq(await text('[data-seat="0"][data-stat="supply"]'), '6', '失败不扣电');
    eq(await cardsIn('[data-grave="0"]'), 'hou_ke', '厚壳还在墓地');
    await click('[data-action="select-hand"][data-card="xiao_yin"]');
    await click('[data-action="play"]');
    eq(await text('[data-seat="0"][data-stat="supply"]'), '4', '先支付登场费用');
    await click('[data-action="support"]');
    eq(await text('[data-seat="0"][data-stat="supply"]'), '2', '新入场的小印可以支援');
    eq(await attr('[data-board-seat="0"][data-slot="0"]', 'data-card'), 'xiao_yin', '小印不离场');
    eq(await attr('[data-board-seat="0"][data-slot="1"]', 'data-card'), 'hou_ke', '随后叫回厚壳');
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
    eq(await attr('[data-board-seat="0"][data-slot="1"]', 'data-card'), 'xiao_yin', '小印留在位置 1');
    await click('[data-action="end-turn"]');
    eq(await attr('#turn-label', 'data-seat'), '0', '结束后先手回合');
    eq(await text('[data-seat="0"][data-stat="supply"]'), '4', '先手回满');
    await click('[data-action="support"]');
    eq(await attr('[data-board-seat="0"][data-slot="0"]', 'data-card'), 'hou_ke', '厚壳回到最左空位');
    eq(await attr('[data-board-seat="0"][data-slot="0"]', 'data-durability'), '6', '再次满耐久');
    eq(await attr('[data-board-seat="0"][data-slot="1"]', 'data-card'), 'xiao_yin', '小印仍在位置 1');
    eq(await text('[data-seat="0"][data-stat="supply"]'), '2', '再次支援扣 2');
    await shot('07-support-again');
    await click('[data-action="scenario"][data-scenario="promote-stamp"]');
    await click('[data-action="promote"][data-current="xiao_yin"]');
    eq(await text('[data-seat="0"][data-stat="supply"]'), '4', '升星只付差价');
    eq(await attr('[data-board-seat="0"][data-slot="2"]', 'data-card'), 'art_h038a', '小印升成小印改');
    eq(await attr('[data-board-seat="0"][data-slot="2"]', 'data-durability'), '3', '升星满耐久');
    eq(await attr('[data-board-seat="0"][data-slot="2"]', 'data-sick'), 'true', '升星当回合不能攻击');
    eq(await cardsIn('[data-grave="0"]'), 'hou_ke,lian_jie,xiao_yin', '旧配件先于旧主控，原来的墓地牌仍在前面');
    await shot('08-promote');
    await click('[data-action="scenario"][data-scenario="builder"]');
    if (!(await text('[data-deck="0"]')).includes('小印改')) throw new Error('扩展牌组没有带上二星');
    if (!(await text('[data-deck="0"]')).includes('链节')) throw new Error('没有图的基线牌被丢掉了');
    await shot('09-deck-builder');
    await click('[data-action="start-free"]');
    await click('[data-action="select-hand"][data-card="art_h039a"]');
    await click('[data-action="play"]');
    eq(await attr('[data-board-seat="0"][data-card="art_h039a"]', 'data-sick'), 'false', '冲锋打出后可以攻击');
    await click('[data-board-seat="0"][data-card="art_h039a"]');
    await click('[data-action="attack-base"]');
    eq(await text('[data-seat="1"][data-stat="base"]'), '18', '扩展对局里的牌能造成伤害');
    await shot('10-roster-play');
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await shot('11-narrow-table');
    const narrowOverflow = await value(`(() => {
      const nodes = [...document.querySelectorAll('.end-turn, .playcard, .minion, .base-btn, .slot, .back')];
      return nodes.some(node => { const r = node.getBoundingClientRect(); return r.width > 8 && (r.right > window.innerWidth + 4 || r.left < -4); });
    })()`);
    if (narrowOverflow) throw new Error('窄屏牌桌有控件伸出屏幕');
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/` });
    await waitFor(async () => { if (!(await value('document.body && document.body.innerText')).includes('同一套牌')) throw new Error('lobby'); }, 'lobby');
    await shot('12-lobby');
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/wiki/` });
    await waitFor(async () => { if ((await value('document.querySelector("#result-count") && document.querySelector("#result-count").textContent')) !== '96') throw new Error('wiki count'); }, 'wiki');
    await shot('13-wiki-desktop');
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
