/* Headless real-browser checks. Supply PLAYWRIGHT_MODULE_PATH if not installed locally.
 * Serve the repository first, e.g. python3 tools/serve.py --port 8026.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const base = process.env.PULSE_TEST_URL || 'http://127.0.0.1:8026';
const output = path.resolve(__dirname, '../output/playwright');
fs.mkdirSync(output, { recursive: true });
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('response', r => { if (r.status() >= 400 && !r.url().endsWith('favicon.ico')) errors.push(`${r.status()} ${r.url()}`); });
    const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
    const ready = () => page.waitForFunction(() => document.body.dataset.ready === '1' && document.body.dataset.animating !== '1');
    const reset = async scenario => { await page.goto(`${base}/dist/clash/?scenario=${scenario || 'tactics'}`); await ready(); };
    const select = async id => { const card = page.locator(`.hands [data-action="select-hand"][data-card="${id}"]`); await card.scrollIntoViewIfNeeded(); await card.click(); };
    const target = id => page.locator(`.slots.foe .minion[data-card="${id}"]`);
    await reset(); await select('pulse_bolt'); await target('art_h028').click(); await ready();
    assert.equal((await state()).boards[1].some(u => u.card_id === 'art_h028'), false);
    assert.equal((await state()).supply[0], 8);
    await reset(); await select('arc_wave'); await page.locator('[data-action="play"]').click(); await ready();
    assert.equal((await state()).boards[1].length, 1, 'AoE removes two units');
    assert.equal((await state()).boards[0].length, 2, 'AoE preserves allies');
    await reset(); await select('emergency_stop'); await target('art_h015').click(); await ready();
    assert.equal(await target('art_h015').evaluate(el => el.classList.contains('frozen')), true);
    await reset(); await select('factory_reset'); await target('art_h015').click(); await ready();
    assert.equal((await state()).opponentHandCount, 1);
    await reset(); await select('safe_shutdown'); await target('art_h028').click(); await ready();
    assert.equal((await state()).supply[0], 10); assert.equal((await state()).error.code, 'attack_too_low');
    await target('art_h015').click(); await ready(); assert.equal((await state()).boards[1].length, 2);
    await reset(); await select('repair_protocol'); await page.locator('[data-action="play"]').click(); await ready();
    assert.equal((await state()).bases[0], 27);
    await reset(); await select('overclock'); await page.locator('.slots.mine .minion[data-card="art_h024"]').click(); await ready();
    assert.equal((await state()).boards[0][0].attack, 6);
    await reset(); await select('cache_read'); await page.locator('[data-action="play"]').click(); await ready();
    assert.equal((await state()).hand.length, 9);
    await reset('versus');
    await page.locator('.hands [data-card="xiao_yin"]').dblclick(); await ready();
    assert.equal((await state()).boards[0].length, 1);
    await page.locator('[data-action="end-turn"]').click();
    await page.waitForFunction(() => { const s = JSON.parse(render_game_to_text()); return s.seat === 0 && s.turn[0] === 2 && !s.animating; }, { timeout: 15000 });
    assert.ok((await state()).boards[1].length > 0, 'AI takes its own turn');
    await reset('lesson'); await page.locator('[data-action="end-turn"]').click();
    assert.equal(await page.locator('.handoff-mask').count(), 1);
    assert.deepEqual((await state()).hand, [], 'handoff does not expose cards through text state');
    await page.locator('[data-action="handoff-confirm"]').click(); assert.equal((await state()).seat, 1);
    await select('art_h039b'); await page.locator('[data-action="play"]').click(); await ready();
    assert.equal((await state()).boards[1].length, 1, 'hotseat second player can play from the lower hand');
    await reset('lesson');
    for (let i = 0; i < 45 && (await state()).winner == null; i++) {
      await page.locator('[data-action="end-turn"]').click();
      if (await page.locator('[data-action="handoff-confirm"]').count()) await page.locator('[data-action="handoff-confirm"]').click();
    }
    assert.notEqual((await state()).winner, null, 'fatigue reaches a real terminal state');
    assert.equal(await page.locator('.result-layer').count(), 1);
    await page.locator('.result-layer [data-action="restart"]').click(); await ready();
    assert.equal((await state()).winner, null);
    assert.deepEqual((await state()).bases, [30,30]);
    await reset('versus'); await page.locator('[data-action="end-turn"]').click();
    await page.locator('[data-action="toggle-menu"]').click();
    await page.locator('.menu-pop [data-action="restart"]').click(); await ready();
    await page.waitForTimeout(1000);
    assert.deepEqual((await state()).turn, [1,0], 'old AI actions cannot mutate a restarted match');
    assert.deepEqual((await state()).boards, [[],[]]);
    await reset('builder');
    await page.locator('[data-action="pool-filter"][data-value="all"]').click();
    while (await page.locator('.pool .picked').count()) await page.locator('.pool .picked').first().click();
    for (const id of ['art_h003','art_h024','dian_zhen','xiao_yin','hou_ke','qiao_jian','xuan_niu','art_h012']) {
      await page.locator(`.pool [data-card="${id}"]`).click();
    }
    await page.locator('[data-action="start-free"]').click(); await ready();
    for (let i = 0; i < 4; i++) {
      await page.locator('[data-action="end-turn"]').click();
      await page.locator('[data-action="handoff-confirm"]').click();
    }
    await select('art_h003'); await page.locator('[data-action="play"]').click(); await ready();
    assert.equal((await state()).boards[0][0].card_id, 'art_h003', 'entry-damage main can deploy when no enemy exists');
    await page.locator('[data-action="toggle-menu"]').click();
    await page.locator('.menu-pop [data-action="restart"]').click(); await ready();
    assert.equal((await state()).scenario, 'free');
    assert.deepEqual((await state()).turn, [1,0]);
    assert.equal((await state()).hand[0].id, 'art_h003', 'custom practice deck survives restart');
    await reset();
    await page.screenshot({ path: path.join(output, 'tactical-desktop-final.png') });
    for (const [width, height] of [[390,844],[375,667],[768,1024],[844,390]]) {
      await page.setViewportSize({ width, height }); await reset();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no page overflow');
      const end = await page.locator('[data-action="end-turn"]').boundingBox();
      assert.ok(end.x >= 0 && end.y >= 0 && end.x + end.width <= width && end.y + end.height <= height, 'end button fits');
      await select('pulse_bolt'); await target('art_h028').click(); await ready();
      assert.equal((await state()).supply[0], 8);
      await page.screenshot({ path: path.join(output, `tactical-${width}x${height}.png`) });
    }
    await page.setViewportSize({ width:1440, height:900 }); await reset();
    await select('emergency_stop');
    const from = await page.locator('.hands [data-card="emergency_stop"]').boundingBox();
    const to = await target('art_h015').boundingBox();
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down(); await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps:12 }); await page.mouse.up(); await ready();
    assert.equal(await target('art_h015').evaluate(el => el.classList.contains('frozen')), true, 'drag spell');
    await reset(); await select('arc_wave');
    const wave = await page.locator('.hands [data-card="arc_wave"]').boundingBox();
    const enemy = await target('art_h015').boundingBox();
    await page.mouse.move(wave.x + wave.width / 2, wave.y + wave.height / 2);
    await page.mouse.down(); await page.mouse.move(enemy.x + enemy.width / 2, enemy.y + enemy.height / 2, {steps:12}); await page.mouse.up(); await ready();
    assert.equal((await state()).boards[1].length, 1, 'area skill can be dropped on the enemy formation');
    await reset(); await select('pulse_bolt');
    const before = await state();
    await page.keyboard.press('Escape');
    assert.equal((await state()).supply[0], before.supply[0], 'cancel never spends power');
    assert.equal((await state()).selected, null, 'Escape clears selection');
    await page.setViewportSize({ width:390, height:844 }); await reset('crowd');
    await page.screenshot({path:path.join(output, 'tactical-crowd-phone.png')});
    await page.locator('.slots.mine .minion[data-card="xiao_yin"]').click();
    await target('hou_ke').scrollIntoViewIfNeeded(); await target('hou_ke').click(); await ready();
    assert.equal((await state()).boards[0].length, 6, 'full board remains attackable on phone');
    await page.setViewportSize({ width:1440, height:900 });
    await page.goto(`${base}/dist/`); await page.waitForURL('**/dist/clash/**'); await ready();
    assert.equal((await state()).scenario, 'sim', 'old entry redirects to the active game');
    await page.goto(`${base}/`);
    assert.equal(await page.getByText('开始一局 →', { exact:true }).count(), 1);
    assert.equal(await page.getByText('旧版点数', { exact:false }).count(), 0);
    await page.screenshot({path:path.join(output, 'tactical-lobby.png')});
    await page.goto(`${base}/wiki/`);
    await page.waitForFunction(() => document.querySelector('#service-grid').textContent.includes('紧急停机'));
    assert.deepEqual(errors, []);
    console.log('PASS tactical browser: 8 spells, atomic rejection, AI, hotseat, fatigue result/restart, AI restart cancellation, 5 viewport sizes, crowded phone board, custom practice/restart, targeted/area drag, redirect, lobby/wiki, no runtime or resource errors.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
