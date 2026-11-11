const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');

const base = process.env.WIKI_BASE || 'http://127.0.0.1:8003';
const out = process.env.WIKI_SHOTS || '/opt/cursor/artifacts';
fs.mkdirSync(out, {recursive: true});

(async () => {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME || '/usr/local/bin/google-chrome',
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu']
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.setViewport({width: 1440, height: 900});
  await page.goto(base + '/wiki/', {waitUntil: 'networkidle0', timeout: 60000});
  await page.waitForFunction(() => document.querySelector('#result-count')?.textContent === '96');
  await page.screenshot({path: path.join(out, 'wiki_desktop_grid.png')});

  await page.type('#q', '二代壳');
  await page.waitForFunction(() => document.querySelector('#result-count')?.textContent === '2');
  const names = await page.$$eval('.tile .zh', nodes => nodes.map(node => node.textContent));
  if (names.join() !== '二代壳,二代壳改') throw new Error('search names ' + names.join());
  await page.screenshot({path: path.join(out, 'wiki_desktop_search_erdaike.png')});

  await page.$eval('#q', input => {
    input.value = '';
    input.dispatchEvent(new Event('input', {bubbles: true}));
  });
  await page.evaluate(() => document.querySelector('button[data-kind="star"][data-value="2"]').click());
  await page.waitForFunction(() => document.querySelector('#result-count')?.textContent === '9');
  const hasThree = await page.$('button[data-kind="star"][data-value="3"]');
  if (hasThree) throw new Error('three-star filter should not exist');
  await page.screenshot({path: path.join(out, 'wiki_desktop_star2.png')});

  await page.goto(base + '/wiki/?card=H005', {waitUntil: 'networkidle0'});
  await page.waitForSelector('[data-growth="chain"]');
  const core = await page.$eval('#detail', node => node.innerText);
  if (!core.includes('二代壳') || core.includes('3 星')) throw new Error('Core2 detail lost the rename or invented a third star');
  if (core.split('厚壳工控').length > 2) throw new Error('Core2 detail treats it as 厚壳工控');
  await page.screenshot({path: path.join(out, 'wiki_desktop_core2_chain.png')});
  await page.evaluate(() => history.back());
  await page.waitForFunction(() => !document.querySelector('#detail').open);

  await page.goto(base + '/wiki/?card=H015', {waitUntil: 'networkidle0'});
  await page.waitForSelector('[data-surface="back"]');
  const tab = await page.$eval('[data-surface="back"]', node => node.innerText);
  if (!tab.includes('背面') || !tab.includes('不是正面')) throw new Error('Tab5 back label missing');
  await page.screenshot({path: path.join(out, 'wiki_desktop_tab5_back.png')});

  await page.goto(base + '/wiki/?card=C004c', {waitUntil: 'networkidle0'});
  await page.waitForFunction(() => document.body.innerText.includes('配件不用'));
  const motion = await page.$eval('#detail', node => node.innerText);
  if (motion.includes('耐') && !motion.includes('配件不用')) throw new Error('attachment shows durability');
  await page.screenshot({path: path.join(out, 'wiki_desktop_attachment.png')});

  await page.goto(base + '/wiki/', {waitUntil: 'networkidle0'});
  await page.waitForFunction(() => document.querySelector('#result-count')?.textContent === '96');
  await page.evaluate(() => document.querySelector('#cost-chips button[data-kind="cost"][data-value="2"]').click());
  await page.waitForFunction(() => document.querySelector('#result-count')?.textContent === '21');
  const twoCost = await page.$eval('#tile-H036', node => node.innerText);
  if (!twoCost.includes('2费') || !twoCost.includes('系列整机') || !twoCost.includes('轨上表')) throw new Error('DinMeter cost filter ' + twoCost);
  await page.screenshot({path: path.join(out, 'wiki_desktop_cost2.png')});
  await page.evaluate(() => document.querySelector('#cost-chips button[data-kind="cost"][data-value=""]').click());
  await page.evaluate(() => document.querySelector('#band-chips button[data-kind="band"][data-value="series_machine"]').click());
  const machines = await page.$$eval('.tile', nodes => nodes.map(node => node.dataset.rid));
  if (!machines.includes('H017') || !machines.includes('H041') || machines.includes('H038')) throw new Error('machine band ' + machines.join());
  await page.goto(base + '/wiki/?card=H017', {waitUntil: 'networkidle0'});
  const hub = await page.$eval('#detail', node => node.innerText);
  if (!hub.includes('系列档') || !hub.includes('系列整机') || !hub.includes('护卫')) throw new Error('PowerHub tier ' + hub);
  if (!hub.includes('5') || !hub.includes('7')) throw new Error('PowerHub stats ' + hub);
  await page.screenshot({path: path.join(out, 'wiki_desktop_powerhub.png')});
  await page.goto(base + '/wiki/?card=H018', {waitUntil: 'networkidle0'});
  const board = await page.$eval('#detail', node => node.innerText);
  if (!board.includes('存疑')) throw new Error('CoreMP135 should stay uncertain');
  await page.goto(base + '/wiki/?card=H038b', {waitUntil: 'networkidle0'});
  await page.waitForSelector('[data-growth="lateral"]');
  const pin = await page.$eval('[data-growth="lateral"]', node => node.innerText);
  if (!pin.includes('不是升级') || pin.includes('下一级')) throw new Error('pin variant looks like a promotion');

  const imageReport = await page.evaluate(async () => {
    const keys = ['char_webp', 'card_webp', 'char_thumb_webp', 'card_thumb_webp'];
    const paths = window.PULSEWikiCards.flatMap(card => keys.map(key => card.assets.web[key].path));
    const bad = [];
    for (const item of paths) {
      const response = await fetch(item);
      if (!response.ok) bad.push(response.status + ' ' + item);
      else if ((await response.arrayBuffer()).byteLength < 32) bad.push('small ' + item);
    }
    return {count: paths.length, bad};
  });
  if (imageReport.count !== 384 || imageReport.bad.length) throw new Error('images ' + JSON.stringify(imageReport.bad.slice(0, 8)));

  await page.setViewport({width: 390, height: 844});
  await page.goto(base + '/wiki/', {waitUntil: 'networkidle0'});
  await page.waitForFunction(() => document.querySelector('#result-count')?.textContent === '96');
  await page.screenshot({path: path.join(out, 'wiki_narrow_filters.png')});
  await page.evaluate(() => document.querySelector('#grid').scrollIntoView({block: 'start'}));
  await page.screenshot({path: path.join(out, 'wiki_narrow_grid.png')});
  await page.goto(base + '/wiki/?card=H015', {waitUntil: 'networkidle0'});
  await page.waitForSelector('[data-surface="back"]');
  await page.screenshot({path: path.join(out, 'wiki_narrow_tab5.png')});

  const game = await browser.newPage();
  const gameRequests = [];
  game.on('request', request => gameRequests.push(request.url()));
  await game.goto(base + '/dist/', {waitUntil: 'domcontentloaded', timeout: 60000});
  await game.waitForSelector('a.btn.ghost');
  const href = await game.$eval('a.btn.ghost', link => link.getAttribute('href'));
  if (href !== '../wiki/index.html') throw new Error('game link ' + href);
  if (gameRequests.some(url => url.includes('/wiki/assets/'))) throw new Error('game page fetched wiki art');

  if (errors.length) throw new Error(errors.join('\n'));
  await browser.close();
  console.log('PASS wiki browser');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
