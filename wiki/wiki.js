(function () {
  'use strict';
  const api = globalThis.PULSEWiki;
  const $ = selector => document.querySelector(selector);
  const detail = $('#detail');
  const grid = $('#grid');
  const filters = $('#filters');
  const ROLE = {main: '主控', attachment: '配件'};
  const GROWTH = {chain: '升星', lateral: '横向', solo: '单张'};
  const CONTROLLER = {
    independent_host: '独立主机',
    auxiliary_programmable_mcu: '辅助可编程单片机',
    no_main_chip_listed: '规格未列主控'
  };
  let cards = [];
  let pack = {status: 'pending_integration', cards: {}, families: {}};
  let state = readState();
  let zoomOpen = false;

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[char]));
  }

  function readState() {
    const params = new URLSearchParams(location.search);
    return {
      q: params.get('q') || '',
      type: params.get('type') || '',
      series: params.get('series') || '',
      group: params.get('group') || '',
      family: params.get('family') || '',
      growth: params.get('growth') || '',
      star: params.get('star') || '',
      cost: params.get('cost') || '',
      band: params.get('band') || '',
      sort: params.get('sort') || 'cost',
      card: params.get('card') || '',
      view: params.get('view') === 'card' ? 'card' : 'char'
    };
  }

  function pageUrl(next) {
    const params = new URLSearchParams();
    ['q', 'type', 'series', 'group', 'family', 'growth', 'star', 'cost', 'band', 'sort', 'card'].forEach(key => {
      if (next[key]) params.set(key, next[key]);
    });
    if (next.view === 'card' && next.card) params.set('view', 'card');
    const query = params.toString();
    return location.pathname + (query ? '?' + query : '') + location.hash;
  }

  function webPath(card, key) {
    const item = card.assets && card.assets.web && card.assets.web[key];
    const path = item && item.path;
    return typeof path === 'string' && /^assets\/(?:char|card|thumb\/char|thumb\/card)\/[^/]+\.webp$/.test(path) ? path : '';
  }

  function isTabBack(card) {
    return card.rid === 'H015';
  }

  function filtered() {
    const list = api.filterCards(cards, state).slice();
    const costOf = card => {
      const play = card.design && card.design.gameplay;
      return play && play.cost != null ? Number(play.cost) : 99;
    };
    const nameOf = card => (card.design && card.design.identity && card.design.identity.game_name_zh) || '';
    if (state.sort === 'rid') list.sort((a, b) => a.rid.localeCompare(b.rid));
    else if (state.sort === 'name') list.sort((a, b) => nameOf(a).localeCompare(nameOf(b), 'zh'));
    else list.sort((a, b) => costOf(a) - costOf(b) || a.rid.localeCompare(b.rid));
    return list;
  }

  function isOn(kind, value) {
    if (kind === 'reset-growth') return !state.family && !state.growth;
    return state[kind] === value;
  }

  function chip(kind, value, label, count) {
    const on = isOn(kind, value);
    return `<button type="button" class="chip${on ? ' on' : ''}" data-kind="${esc(kind)}" data-value="${esc(value)}" aria-pressed="${on ? 'true' : 'false'}">${esc(label)} <span>${count}</span></button>`;
  }

  function optionKeys(map) {
    return [...map.keys()].sort((a, b) => {
      if (a === '') return 1;
      if (b === '') return -1;
      return String(a).localeCompare(String(b), 'en');
    });
  }

  function paintChoices() {
    const typeMap = api.tally(cards, card => card.type);
    $('#type-chips').innerHTML = chip('type', '', '全部', cards.length)
      + chip('type', 'typeA', 'typeA', typeMap.get('typeA') || 0)
      + chip('type', 'typeB', 'typeB', typeMap.get('typeB') || 0);
    const seriesMap = api.tally(cards, card => card.product_series || '');
    $('#series-chips').innerHTML = chip('series', '', '全部', cards.length) + optionKeys(seriesMap).map(key => chip('series', key === '' ? '_none' : key, key === '' ? '未归类' : key, seriesMap.get(key))).join('');
    const groupMap = api.tally(cards, card => card.nav_group || '');
    $('#group-chips').innerHTML = chip('group', '', '全部', cards.length) + optionKeys(groupMap).map(key => chip('group', key === '' ? '_none' : key, key === '' ? '未按前缀' : key, groupMap.get(key))).join('');
    paintGrowth();
    paintStars();
    paintCosts();
  }

  const BAND = {series_core: '系列核心', series_machine: '系列整机', accessory: '配件'};
  function tierText(play) {
    if (!play || !play.cost_band) return '';
    const doubt = play.series_confidence === 'uncertain' ? ' · 存疑' : '';
    return (BAND[play.cost_band] || play.cost_band) + doubt;
  }

  function paintCosts() {
    const costs = api.tally(cards, card => {
      const play = card.design && card.design.gameplay;
      return play && play.cost != null ? String(play.cost) : '';
    });
    const nums = [...costs.keys()].filter(Boolean).sort((a, b) => Number(a) - Number(b));
    $('#cost-chips').innerHTML = chip('cost', '', '全部', cards.length) + nums.map(cost => chip('cost', cost, cost + ' 费', costs.get(cost))).join('');
    const bands = api.tally(cards, card => (card.design && card.design.gameplay && card.design.gameplay.cost_band) || '');
    $('#band-chips').innerHTML = chip('band', '', '全部档', cards.length) + ['series_core', 'series_machine', 'accessory'].filter(id => bands.has(id)).map(id => chip('band', id, BAND[id], bands.get(id))).join('');
    const sortBox = document.querySelector('#sort-chips');
    if (sortBox) sortBox.innerHTML = chip('sort', 'cost', '按费用', '') + chip('sort', 'rid', '按编号', '') + chip('sort', 'name', '按中文名', '');
  }

  function paintGrowth() {
    const families = pack.families || {};
    const chain = Object.values(families).filter(family => family.growth_kind === 'chain');
    const lateral = Object.values(families).filter(family => family.growth_kind === 'lateral');
    const chainHtml = chip('reset-growth', '', '全部', cards.length) + chain.map(family => chip('family', family.id, family.label, family.members.length)).join('');
    const lateralHtml = lateral.map(family => `<button type="button" class="chip${state.family === family.id ? ' on' : ''}" data-kind="family" data-value="${esc(family.id)}" aria-pressed="${state.family === family.id ? 'true' : 'false'}" title="${esc(family.summary || '')}">${esc(family.label)}等 <span>${family.members.length}</span></button>`).join('');
    const soloCount = cards.filter(card => card.design && card.design.growth.kind === 'solo').length;
    $('#chain-chips').innerHTML = chainHtml;
    $('#lateral-chips').innerHTML = lateralHtml + chip('growth', 'solo', '单张', soloCount);
  }

  function paintStars() {
    const stars = new Map();
    cards.forEach(card => {
      const star = card.design && card.design.growth.star;
      const key = star == null ? 'none' : String(star);
      stars.set(key, (stars.get(key) || 0) + 1);
    });
    const numbered = [...stars.keys()].filter(key => key !== 'none').sort((a, b) => Number(a) - Number(b));
    $('#star-chips').innerHTML = chip('star', '', '全部', cards.length)
      + numbered.map(key => chip('star', key, key + ' 星', stars.get(key))).join('')
      + (stars.has('none') ? chip('star', 'none', '无星级', stars.get('none')) : '');
  }

  function markChips() {
    document.querySelectorAll('#filters button[data-kind]').forEach(button => {
      const on = isOn(button.dataset.kind, button.dataset.value);
      button.classList.toggle('on', on);
      button.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function starMark(card) {
    const star = card.design && card.design.growth.star;
    if (Number.isInteger(star) && star > 0) return `<span class="star-line" data-star="${star}">${'★'.repeat(star)} ${star} 星</span>`;
    return '<span class="star-line" data-star="none">无星级</span>';
  }

  function paintGrid() {
    const list = filtered();
    $('#result-count').textContent = String(list.length);
    if (!list.length) {
      grid.innerHTML = '<p class="empty">没有符合条件的卡。</p>';
      return;
    }
    grid.innerHTML = list.map(card => {
      const thumb = card.assets.web.char_thumb_webp;
      const name = card.design ? card.design.identity.game_name_zh : '';
      const growth = card.design && card.design.growth;
      const familyLabel = growth && growth.kind === 'chain' ? ' · ' + ((pack.families[growth.family] || {}).label || '') : '';
      const back = isTabBack(card) ? '<span class="back-pill">背面</span>' : '';
      const alt = esc(card.official_product_name_en + (isTabBack(card) ? ' 主体缩略图，官方背面，不是正面' : ' 主体缩略图'));
      return `<button type="button" class="tile" data-rid="${esc(card.rid)}" id="tile-${esc(card.rid)}">
        ${back}
        <span class="thumb"><img src="${esc(webPath(card, 'char_thumb_webp'))}" alt="${alt}" width="${Number(thumb.width) || 160}" height="${Number(thumb.height) || 160}" loading="eager" decoding="async"></span>
        ${starMark(card)}
        <span class="meta"><span>${esc(card.rid)}</span><span class="type ${esc(card.type)}">${esc(card.type)}</span></span>
        <strong class="official">${esc(card.official_product_name_en)}</strong>
        <span class="zh design">${esc(name)}</span>
        <span class="cost-lamp" data-cost="${esc(card.design ? card.design.gameplay.cost : '')}">${esc(card.design ? card.design.gameplay.cost : '')}</span>
        <span class="group-line">${esc(GROWTH[growth && growth.kind] || '')}${esc(familyLabel)}${card.design ? ' · ' + esc(card.design.gameplay.cost) + '费 · ' + esc(tierText(card.design.gameplay)) : ''}</span>
      </button>`;
    }).join('');
  }

  function effectLines(card) {
    const play = card.design.gameplay;
    if (play.role === 'attachment') {
      const lines = [];
      if (play.attack_bonus) lines.push('攻击 +' + play.attack_bonus);
      if (play.grants_guard) lines.push('给宿主护卫');
      if (play.bypass_guard) lines.push('宿主攻击时忽略护卫');
      return lines;
    }
    const lines = [];
    if (play.guard) lines.push('护卫');
    if (play.rush) lines.push('冲锋');
    if (play.effect === 'play_draw') lines.push('入场抽 ' + play.effect_amount);
    if (play.effect === 'play_damage') lines.push('入场伤害 ' + play.effect_amount);
    if (play.effect === 'knob') lines.push('旋钮');
    if (play.effect === 'support') lines.push('支援');
    return lines.length ? lines : ['无额外技能'];
  }

  function stats(card) {
    const play = card.design.gameplay;
    const tier = `<div class="stat"><span>系列档</span><strong>${esc(tierText(play) || '未标')}</strong></div>`;
    const reason = play.cost_note ? `<p class="cost-reason"><span>定费理由</span> ${esc(play.cost_note)}</p>` : '';
    if (play.role === 'attachment') {
      return `<div class="stat cost-stat"><span class="cost-lamp lg">${esc(play.cost)}</span><span>费用</span></div>${tier}<div class="stat"><span>配件效果</span><strong>${esc(effectLines(card).join('、'))}</strong></div><div class="stat"><span>攻 / 耐</span><strong class="missing">配件不用</strong></div>${reason}`;
    }
    return `<div class="stat cost-stat"><span class="cost-lamp lg">${esc(play.cost)}</span><span>费用</span></div>${tier}<div class="stat"><span>攻</span><strong>${esc(play.attack)}</strong></div><div class="stat"><span>耐</span><strong>${esc(play.durability)}</strong></div>${reason}`;
  }

  function compareStats(card) {
    const play = card.design.gameplay;
    if (play.role === 'attachment') return esc(effectLines(card).join('、')) + ' · 费用 ' + esc(play.cost);
    return '费用 ' + esc(play.cost) + ' · 攻 ' + esc(play.attack) + ' · 耐 ' + esc(play.durability);
  }

  function neighbor(card, heading) {
    if (!card) return `<article><h4>${heading}</h4><p class="missing">没有相邻级</p></article>`;
    const star = card.design.growth.star;
    return `<article><h4>${heading}${star ? ' · ' + esc(star) + ' 星' : ''}</h4><p>${esc(card.design.identity.game_name_zh)}</p><p class="fine">${esc(card.official_product_name_en)}</p><p>${compareStats(card)}</p><button type="button" class="text-btn" data-action="open" data-rid="${esc(card.rid)}">${esc(card.rid)}</button></article>`;
  }

  function growthBlock(card) {
    const view = api.growthView(cards, card);
    const rules = pack.growth_rules || {};
    if (view.mode === 'chain') {
      const pair = view.prev || card;
      const higher = view.prev ? card : view.next;
      const sample = higher ? `这一对牌面费用是 ${pair.design.gameplay.cost} 和 ${higher.design.gameplay.cost}，按规则试算升到高星付 ${api.promoteCost(pair, higher)}。` : '';
      const inherit = card.design.gameplay.role === 'attachment'
        ? '配件升星时，旧配件进墓地，新配件仍装在同一个宿主上。宿主的新入场和已攻击不变。'
        : (rules.inheritance || '');
      return `<section class="panel growth" data-growth="chain" data-family="${esc(view.family)}"><h3>升星 · ${esc((pack.families[view.family] || {}).label || view.family)} · ${esc(view.star)} 星</h3><p class="flag">星级来自设计包，不是把 v1.1 / v1.2 / v1.3 机械换成星星。没有第三星。</p><p>${esc(card.design.growth.basis)}</p><p class="fine">升星规则：${esc(rules.cost || '')} ${esc(rules.deck || '')} 不降星。${esc(inherit)} ${sample}这是设计规则，网页引擎是否已接入以实际版本为准。</p><div class="compare">${neighbor(view.prev, '上一级')}<article class="here"><h4>这一级 · ${esc(view.star)} 星</h4><p>${esc(card.design.identity.game_name_zh)}</p><p class="fine">${esc(card.precise_model_or_revision || card.official_product_name_en)}</p><p>${compareStats(card)}</p></article>${neighbor(view.next, '下一级')}</div></section>`;
    }
    if (view.mode === 'lateral') {
      const items = view.members.map(item => `<li><button type="button" class="text-btn" data-action="open" data-rid="${esc(item.rid)}">${esc(item.design.identity.game_name_zh)} · ${esc(item.official_product_name_en)}</button></li>`).join('');
      return `<section class="panel growth" data-growth="lateral" data-family="${esc(view.family)}"><h3>同族不同用途，不是升级</h3><p>${esc(card.design.growth.basis)}</p><ul class="skills">${items}</ul></section>`;
    }
    return `<section class="panel growth" data-growth="solo"><h3>单张，不升星</h3><p>${esc(card.design.growth.basis)}</p></section>`;
  }

  function v8Block(card) {
    const identity = card.design.identity;
    const oldRow = card.game_card_v8;
    if (!identity.v8_game_name_zh && !identity.v8_change && !oldRow) return '';
    return `<details class="draft"><summary>旧 v8 草案对照</summary><p class="flag">这里不是现在的中文名。Core2 的旧名「厚壳」已经改成「二代壳」，避免和厚壳工控混在一起。</p><dl>${identity.v8_game_name_zh ? `<dt>旧中文名</dt><dd>${esc(identity.v8_game_name_zh)}</dd>` : ''}${identity.v8_change ? `<dt>这次怎么改</dt><dd>${esc(identity.v8_change)}</dd>` : ''}${oldRow ? `<dt>旧表技能原文</dt><dd>${esc(oldRow.skill || '空')}</dd><dt>旧表来源</dt><dd>${esc(oldRow.source || '')}</dd>` : ''}</dl></details>`;
  }

  function technical(card) {
    const source = card.assets && card.assets.source || {};
    const rows = ['char_png', 'card_png', 'card_svg'].map(key => {
      const item = source[key] || {};
      return `<dt>${esc(key)}</dt><dd class="mono">${esc(item.sha256 || '')}<br>${esc(item.logical_source || '')}</dd>`;
    }).join('');
    const web = ['char_webp', 'card_webp'].map(key => {
      const item = card.assets.web[key] || {};
      return `<dt>${esc(key)}</dt><dd class="mono">${esc(item.sha256 || '')}<br>${esc(item.path || '')}</dd>`;
    }).join('');
    const revisions = (card.revisions || []).map(item => esc(item.id) + ' · ' + esc(item.updated_local || '') + ' · ' + esc(item.source || '')).join('<br>') || '无';
    return `<details><summary>技术细节与哈希</summary><p class="fine">逻辑源名称和 SHA256。原始 PNG/SVG 不在这个网站里。</p><dl>${rows}${web}<dt>模板</dt><dd class="mono">${esc(card.design.template_id)}${card.design.baseline_template_id ? ' · 与教学基线相同 id' : ''}</dd><dt>修订</dt><dd>${revisions}</dd></dl></details>`;
  }

  function paintDetail() {
    zoomOpen = false;
    const card = cards.find(item => item.rid === state.card);
    if (!card || !card.design) {
      detail.innerHTML = `<div class="sheet"><div class="sheet-head"><h2 id="detail-title">没有这张卡</h2><button type="button" class="close" data-action="close" aria-label="关闭">×</button></div><p>链接里的 rid 不在这 96 张里。</p></div>`;
      return;
    }
    const view = state.view === 'card' ? 'card' : 'char';
    const back = isTabBack(card);
    const alt = esc(card.official_product_name_en + (view === 'card' ? ' 整卡展示图' : ' 主体展示图') + (back ? '，用户选择的官方背面，不是正面' : ''));
    const list = filtered();
    const index = list.findIndex(item => item.rid === card.rid);
    const prev = index > 0 ? list[index - 1] : null;
    const next = index >= 0 && index < list.length - 1 ? list[index + 1] : null;
    const notes = (card.visual_notes || []).map(esc).join('<br>');
    const controller = card.design.hardware_class || {};
    const identity = card.design.identity;
    const star = card.design.growth.star;
    detail.innerHTML = `<div class="sheet"><div class="sheet-head"><div><p class="kicker">官方型号 · 卡图标题不改</p><h2 id="detail-title">${esc(card.official_product_name_en)}</h2><p class="zh design">${esc(identity.game_name_zh)}</p><p class="rid">${esc(card.rid)} · ${esc(card.precise_model_or_revision || '')}</p></div><button type="button" class="close" data-action="close" aria-label="关闭">×</button></div>
      <p class="badges"><span class="type ${esc(card.type)}">硬件 ${esc(card.type)}</span><span class="type role">游戏角色 ${esc(ROLE[card.design.gameplay.role] || '')}</span><span class="type growth">${esc(GROWTH[card.design.growth.kind] || '')}${star ? ' ' + esc(star) + ' 星' : ''}</span><span class="type draft">playtest_draft</span></p>
      ${back ? `<p class="back-callout" data-surface="back"><strong>背面 · 用户选择</strong><br>这张主体是用户指定的官方背面，不是正面。<br>${notes}</p>` : ''}
      <div class="detail-grid"><div><div class="stage"><img id="hero" src="${esc(webPath(card, view === 'card' ? 'card_webp' : 'char_webp'))}" alt="${alt}"></div><p class="star-slot" data-star="${star || 'none'}">${star ? '★'.repeat(star) + ' ' + star + ' 星' : '无星级'}</p><div class="toolbar"><div class="seg" role="group" aria-label="图片"><button type="button" data-action="view" data-view="char" aria-pressed="${view === 'char' ? 'true' : 'false'}">主体${back ? '（背面）' : ''}</button><button type="button" data-action="view" data-view="card" aria-pressed="${view === 'card' ? 'true' : 'false'}">整卡</button></div><button type="button" class="text-btn" data-action="zoom">放大</button></div><div class="downloads"><a href="${esc(webPath(card, 'char_webp'))}" download>下载主体展示图（WebP）</a><a href="${esc(webPath(card, 'card_webp'))}" download>下载整卡展示图（WebP）</a></div><p class="fine">下载的是网页展示版 WebP，不是原始 PNG 或 SVG。星级不画进图片。</p></div>
      <div><section class="panel design-panel"><h3>首版设计 · 待试玩</h3><p class="flag">playtest_draft。这些数字和技能不是官方规格，也不是已经在网页对战里实现的结果。</p><p>${esc(identity.game_description)}</p><dl><dt>游戏阵营</dt><dd>${esc(identity.faction)}</dd><dt>设计说明</dt><dd>${esc(identity.balance_intent || '')}</dd></dl><div class="stats">${stats(card)}</div><h3>技能</h3><ul class="skills">${effectLines(card).map(line => `<li>${esc(line)}</li>`).join('')}</ul></section>
      ${growthBlock(card)}
      <section class="panel hardware-panel"><h3>官方硬件</h3><dl><dt>系列</dt><dd>${card.product_series ? esc(card.product_series) : '未归类'}</dd><dt>浏览前缀</dt><dd>${esc(card.nav_group || '未按前缀')} <span class="fine">不是成长家族</span></dd><dt>美术 type</dt><dd>${esc(card.type)} / ${esc(card.style)}</dd><dt>主控归类</dt><dd>${esc(CONTROLLER[controller.controller] || controller.controller || '')} <span class="fine">来自芯片栏，不是游戏角色</span>${controller.note ? '<br>' + esc(controller.note) : ''}</dd><dt>SKU</dt><dd>${esc(card.trusted_sku || '')} · ${esc(card.sku_status || '')}</dd><dt>芯片</dt><dd>${(card.official_main_chips || []).length ? '<ul class="skills">' + card.official_main_chips.map(item => `<li>${esc(item)}</li>`).join('') + '</ul>' : '规格未记录可编程主控'}</dd><dt>资料</dt><dd><a href="${esc(card.official_product_link)}" target="_blank" rel="noopener noreferrer">官方产品页</a></dd>${notes && !back ? `<dt>画面说明</dt><dd>${notes}</dd>` : ''}<dt>授权说明</dt><dd>${esc(card.license_or_usage_note || '')}</dd></dl></section>
      ${v8Block(card)}${technical(card)}
      <div class="result-nav"><button type="button" class="text-btn" data-action="open" data-rid="${prev ? esc(prev.rid) : ''}" ${prev ? '' : 'disabled'}>结果中的上一张</button><button type="button" class="text-btn" data-action="open" data-rid="${next ? esc(next.rid) : ''}" ${next ? '' : 'disabled'}>结果中的下一张</button></div></div></div>
      <div id="zoom" hidden><button type="button" class="close" data-action="close-zoom" aria-label="关闭放大">×</button><img alt=""></div></div>`;
  }

  function openCard(rid, mode) {
    if (!rid) return;
    state.card = rid;
    if (mode === 'push') history.pushState(state, '', pageUrl(state));
    else if (mode === 'replace') history.replaceState(state, '', pageUrl(state));
    paintDetail();
    if (!detail.open) detail.showModal();
    const close = detail.querySelector('[data-action="close"]');
    if (mode === 'push' && close) close.focus();
  }

  function requestClose() {
    if (zoomOpen) {
      closeZoom();
      return;
    }
    if (state.card) history.back();
  }

  function closeZoom() {
    const zoom = $('#zoom');
    if (zoom) zoom.hidden = true;
    zoomOpen = false;
  }

  function openZoom() {
    const hero = $('#hero');
    const zoom = $('#zoom');
    if (!hero || !zoom) return;
    zoom.querySelector('img').src = hero.src;
    zoom.querySelector('img').alt = hero.alt;
    zoom.hidden = false;
    zoomOpen = true;
    zoom.querySelector('[data-action="close-zoom"]').focus();
  }

  function moveResult(step) {
    const list = filtered();
    const index = Math.max(0, list.findIndex(card => card.rid === state.card));
    const target = list[index + step];
    if (target) openCard(target.rid, 'push');
  }

  function paintBanners() {
    const counts = pack.counts || {};
    $('#total-pill').textContent = cards.length + ' 张';
    $('#art-banner').textContent = `美术预览，尚未验收。这 ${cards.length} 张图就是图鉴里的对应卡，对战牌桌用其中的主体图。`;
    $('#design-banner').textContent = `设计已接到 ${pack.ruleset_id || 'pcg.clash.v0'}，状态仍是 playtest_draft、待试玩。${counts.chains || 0} 条升星链、${counts.star1 || 0} 张一星、${counts.star2 || 0} 张二星，没有三星。中文名和技能不是官方规格。`;
    const rules = pack.growth_rules || {};
    $('#rules-note').textContent = rules.cost ? '升星：' + rules.cost + '不降星。' : '';
    $('#source-line').textContent = pack.source_commit ? '设计来源 ' + pack.source_repo + ' ' + pack.source_commit : '';
  }

  function render() {
    $('#q').value = state.q;
    paintChoices();
    paintBanners();
    paintGrid();
  }

  grid.addEventListener('click', event => {
    const tile = event.target.closest('.tile');
    if (tile) openCard(tile.dataset.rid, 'push');
  });
  filters.addEventListener('submit', event => event.preventDefault());
  filters.addEventListener('click', event => {
    const button = event.target.closest('button[data-kind]');
    if (!button) return;
    event.preventDefault();
    const kind = button.dataset.kind;
    if (kind === 'reset-growth') {
      state.family = '';
      state.growth = '';
    } else {
      state[kind] = button.dataset.value;
      if (kind === 'family') state.growth = '';
      if (kind === 'growth') state.family = '';
    }
    history.replaceState(state, '', pageUrl(state));
    markChips();
    paintGrid();
  });
  $('#q').addEventListener('input', event => {
    state.q = event.target.value;
    history.replaceState(state, '', pageUrl(state));
    paintGrid();
  });
  detail.addEventListener('click', event => {
    if (event.target === detail) {
      requestClose();
      return;
    }
    const button = event.target.closest('[data-action]');
    if (!button || button.disabled) return;
    const action = button.dataset.action;
    if (action === 'close') requestClose();
    if (action === 'close-zoom') closeZoom();
    if (action === 'zoom') openZoom();
    if (action === 'view') {
      state.view = button.dataset.view === 'card' ? 'card' : 'char';
      history.replaceState(state, '', pageUrl(state));
      paintDetail();
    }
    if (action === 'open') openCard(button.dataset.rid, 'push');
  });
  detail.addEventListener('cancel', event => {
    event.preventDefault();
    requestClose();
  });
  window.addEventListener('popstate', () => {
    closeZoom();
    state = readState();
    render();
    if (state.card) {
      paintDetail();
      if (!detail.open) detail.showModal();
    } else if (detail.open) detail.close();
  });
  window.addEventListener('keydown', event => {
    const typing = event.target && event.target.matches && event.target.matches('input, textarea');
    if (event.key === '/' && !typing && !detail.open) {
      event.preventDefault();
      $('#q').focus();
      return;
    }
    if (!state.card || typing || zoomOpen) return;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      moveResult(-1);
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      moveResult(1);
    }
  });

  function serviceCard(card) {
    const kind = card.record_kind === 'design_only_host' ? '设计牌' : '服务牌';
    const stats = card.kind === 'main' ? ` · 攻${card.attack} 耐${card.durability}${card.upper_host ? ' · 上位机' : ''}` : '';
    return `<article class="service-card" data-service="${esc(card.template_id)}" data-sku="none">
      <span class="glyph">${esc((card.name || '?').slice(0, 1))}</span>
      <h3>${esc(card.name)}</h3>
      <p class="meta">${kind} · ${card.cost} 费${stats}</p>
      <p>${esc(card.role_note || '')}</p>
      <p>${esc(card.hardware_note || '')}</p>
    </article>`;
  }

  function renderServices(payload) {
    const grid = $('#service-grid');
    if (!grid) return;
    const cards = (payload.cards || []).concat(payload.design_hosts || []);
    grid.innerHTML = cards.map(serviceCard).join('');
  }

  Promise.all([
    fetch('data/cards.json').then(response => {
      if (!response.ok) throw new Error('cards.json');
      return response.json();
    }),
    fetch('data/design-pack.json').then(response => {
      if (!response.ok) throw new Error('design-pack.json');
      return response.json();
    }),
    fetch('data/clash_services.json').then(response => {
      if (!response.ok) throw new Error('clash_services.json');
      return response.json();
    })
  ]).then(([catalog, designPack, servicePack]) => {
    renderServices(servicePack);
    pack = designPack || pack;
    cards = api.mergeCatalog(catalog, pack).cards;
    globalThis.PULSEWikiCards = cards;
    const landed = state;
    const listState = Object.assign({}, landed, {card: ''});
    history.replaceState(listState, '', pageUrl(listState));
    render();
    if (landed.card) openCard(landed.card, 'push');
  }).catch(error => {
    grid.innerHTML = `<p class="empty">图鉴资料没有读到（${esc(error.message)}）。请用静态服务器打开本目录。</p>`;
  });
})();
