(function (root) {
  'use strict';
  const C = root.PCGClash;
  const content = root.PCGClashContent;
  const pack = C.loadPack(content, root.PCGClashCapabilities);
  const roster = root.PCGClashRoster;
  const $ = document.querySelector.bind(document);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const rules = pack.rules;
  const tokenId = pack.tokenId;
  const cards = Object.create(null);
  Object.keys(pack.cards).forEach(id => { cards[id] = pack.cards[id]; });
  roster.cards.forEach(card => { cards[card.template_id] = card; });
  const presetFirst = ['art_h039a', 'xiao_yin', 'art_h038a', 'hou_ke', 'dian_zhen', 'art_h027a', 'xuan_niu', 'art_h003', 'art_h025', 'lian_jie'];
  const presetSecond = ['art_h005', 'art_h007', 'qiao_jian', 'art_h032', 'art_h036', 'art_h036a', 'art_c004c', 'art_c004d', 'gan_rao', 'hu_zhao'];
  const seatName = seat => seat === 0 ? '先手' : '后手';
  const kindName = kind => kind === 'main' ? '主控' : kind === 'attachment' ? '配件' : '战术';
  function blurb(card) {
    let text = kindName(card.kind);
    if (card.kind === 'main') text = `主控 · 攻${card.attack} 耐${card.durability}${card.guard ? ' · 护卫' : ''}`;
    else if (card.attack_bonus) text = `配件 · 攻击 +${card.attack_bonus}`;
    else if (card.grants_guard) text = '配件 · 获得护卫';
    else if (card.bypass_guard) text = '配件 · 无视护卫';
    else if (card.effect === 'supply') text = `战术 · 供电 +${card.amount}`;
    else if (card.effect === 'heal_base') text = `战术 · 基地 +${card.amount}`;
    else if (card.effect === 'damage') text = `战术 · 敌方 -${card.amount} 耐久`;
    else if (card.effect === 'mend') text = `战术 · 修复 ${card.amount} 或攻击 +1`;
    const star = C.starOf(card);
    if (star != null) text += ` · ${star}星`;
    return text;
  }

  let game = null;
  let ui = blankUi('lesson');

  function blankUi(scenario) {
    return { scenario, reveal: false, catalog: false, handIndex: null, attacker: null, target: null, knob: false, error: null, log: [] };
  }

  function push(text, code) {
    ui.log.push({ text, code: code || '' });
    if (ui.log.length > 40) ui.log.shift();
  }

  function note(error) {
    ui.error = { code: error.code || 'rejected', message: error.message || String(error) };
    push(ui.error.message, ui.error.code);
    render();
  }

  function clearChoice() {
    ui.handIndex = null;
    ui.attacker = null;
    ui.target = null;
    ui.knob = false;
    ui.error = null;
  }

  function begin(scenario) {
    const keepReveal = ui.reveal;
    ui = blankUi(scenario);
    ui.reveal = keepReveal;
    if (scenario === 'lesson') {
      game = new C.Game(cards, content.decks.first.slice(), content.decks.second.slice(), rules, tokenId, pack.capabilities);
      game.start_turn();
      push('教学局。牌序固定，不洗牌。先手第 1 回合不抽牌，供电已回满。');
    } else if (scenario === 'support-present') {
      game = C.Game.empty(cards, rules, pack.capabilities);
      game.supply = [6, 6];
      game.max_supply = [6, 6];
      game.bases = [16, 18];
      game.hands = [['bu_ji', 'gan_rao'], []];
      game.graves = [['hou_ke'], []];
      game.spawn(0, 'xiao_yin', 0, null, false);
      game.spawn(1, 'dian_zhen', 0);
      push('摆阵：小印已经在场，厚壳在自己的墓地。支援叫回厚壳，小印留在场上。');
    } else if (scenario === 'support-deploy') {
      game = C.Game.empty(cards, rules, pack.capabilities);
      game.supply = [6, 6];
      game.max_supply = [6, 6];
      game.hands = [['xiao_yin'], []];
      game.graves = [['hou_ke'], []];
      push('摆阵：厚壳已在墓地，小印还在手牌。没有小印在场时支援不会扣电。');
    } else if (scenario === 'support-again') {
      game = C.Game.empty(cards, rules, pack.capabilities);
      game.supply = [0, 2];
      game.max_supply = [3, 2];
      game.bases = [16, 18];
      game.hands = [[], ['gan_rao']];
      game.turns_started = [0, 1];
      game.spawn(0, 'hou_ke', 0, 2, false);
      game.spawn(0, 'xiao_yin', 1, null, false);
      game.seat = 1;
      push('摆阵：后手用干扰打掉位置 0 的厚壳。小印留在位置 1。结束回合后先手可以再支援。');
    } else if (scenario === 'promote-stamp') {
      game = C.Game.empty(cards, rules, pack.capabilities);
      game.supply = [5, 0];
      game.max_supply = [5, 0];
      game.hands = [['art_h038a'], []];
      const stamp = game.spawn(0, 'xiao_yin', 2, null, false);
      stamp.attachments = ['lian_jie'];
      game.graves = [['hou_ke'], []];
      push('摆阵：位置 2 的小印挂着链节，手牌是小印改。升星费用是差价 1。');
    } else if (scenario === 'builder') {
      game = null;
      ui.decks = [presetFirst.slice(), presetSecond.slice()];
      ui.builderSeat = 0;
      ui.poolFilter = 'chain';
      push('扩展组牌。点选顺序就是牌库从上到下的顺序，不洗牌。');
    }
    render();
  }

  function selectedCard() {
    if (ui.handIndex == null) return null;
    const id = game.hands[game.seat][ui.handIndex];
    return id ? cards[id] : null;
  }

  function canDeploy() {
    const card = selectedCard();
    return !!(card && (card.kind === 'main' || card.effect === 'supply' || card.effect === 'heal_base'));
  }

  function coach() {
    if (game.winner != null) return '终局已锁定。出牌、攻击、支援、旋钮和结束回合都会被拒绝。';
    if (ui.knob) return '旋钮已准备。点一台己方单位，本回合攻击 +1。可以点旋钮台自己。新入场也能用。';
    const card = selectedCard();
    if (card && card.kind === 'main') return `准备打出${card.name}。它进入最左边的空位，本回合不能攻击，技能不受这个限制。`;
    if (card && card.effect === 'supply') return '打出后当前供电 +1，可以暂时高于上限。回合结束会清零。';
    if (card && card.effect === 'heal_base') return '打出后己方基地恢复 4，不超过 20。';
    if (card && card.kind === 'attachment') return `点一台己方主控，装上${card.name}。一台只能挂一个。护罩不能装到已有护卫的单位。`;
    if (card && card.effect === 'damage') return '点一台敌方单位。护卫拦不住，也没有反击。';
    if (card && card.effect === 'play_damage') return '可以点一台敌方单位造成 1 点伤害，护卫拦不住。也可以不指定目标，那样不造成伤害。';
    if (card && card.effect === 'play_draw') return '打出后额外抽 1 张。手牌满了会亮出进墓地。';
    if (card && card.rush) return '这张有冲锋，打出后本回合可以攻击。升星进来的仍不能攻击。';
    if (card && card.effect === 'mend' && !ui.target) return '点一台己方单位。可以修复耐久，或让它本回合攻击 +1。不能治疗基地。';
    if (card && card.effect === 'mend') return '选择修复 2 点耐久（不超过卡面），或本回合攻击 +1。';
    if (ui.attacker) return '点敌方单位，或按“攻击对方基地”。新入场不能攻击。对方有护卫时，没有千里眼就只能打护卫。';
    return '点手牌出牌，点己方单位后再选攻击目标。场上的小印可以支援自己墓地里的厚壳，小印不会离场。';
  }

  const artbook = root.PCGClashArt || {};
  function picture(card, kind) {
    const shot = card && artbook[card.rid];
    if (!shot) return `<span class="glyph" aria-hidden="true">${esc((card && card.name || '?').slice(0, 1))}</span>`;
    return `<img src="${esc(kind === 'board' ? shot.char : shot.card)}" alt="" draggable="false">`;
  }
  function mana(seat) {
    const max = game.max_supply[seat];
    const cur = game.supply[seat];
    const count = Math.max(max, Math.min(cur, 10));
    return `<div class="mana">${Array.from({length: count}, (_, i) => `<i class="${i < cur ? 'on' : ''}"></i>`).join('')}</div>`;
  }
  function handHtml(seat, dock) {
    const show = ui.reveal || seat === game.seat;
    if (!show) {
      const backs = game.hands[seat].map(() => '<div class="back" aria-hidden="true"></div>').join('');
      return `<div class="${dock ? 'hands' : 'opp-hand'}" data-hand-seat="${seat}" data-hidden="1">${backs}<span class="silk">手牌 ${game.hands[seat].length}</span></div>`;
    }
    const count = game.hands[seat].length;
    const open = game.hands[seat].map((id, index) => {
      const card = cards[id];
      const selected = seat === game.seat && ui.handIndex === index;
      const star = C.starOf(card);
      const nums = card.kind === 'main'
        ? `<span class="patk">${card.attack}</span><span class="php">${card.durability}</span>`
        : `<span class="statsline">${esc(blurb(card))}</span>`;
      const body = `<span class="cost">${card.cost}</span>${star ? `<span class="star">${star}星</span>` : ''}<span class="art">${picture(card, 'board')}</span><span class="cname">${esc(card.name)}</span>${nums}`;
      const fan = ` style="--i:${index};--n:${count}"`;
      if (seat !== game.seat) return `<div class="playcard" data-card="${esc(id)}"${fan}>${body}<span class="statsline">教学明牌</span></div>`;
      return `<button type="button" class="playcard${selected ? ' selected' : ''}" data-action="select-hand" data-hand-index="${index}" data-card="${esc(id)}"${fan}>${body}</button>`;
    }).join('');
    return `<div class="${dock ? 'hands fan' : 'opp-hand'}" data-hand-seat="${seat}" data-hidden="0">${open || '<span class="silk">没有手牌</span>'}</div>`;
  }
  function unitHtml(seat, slot, unit) {
    if (!unit) {
      const drop = seat === game.seat && canDeploy();
      return `<div class="slot empty socket${drop ? ' ready' : ''}" data-board-seat="${seat}" data-slot="${slot}" data-card=""${drop ? ' data-action="play"' : ''}><span class="pins"></span><span class="silk">座 ${slot + 1}</span></div>`;
    }
    const card = cards[unit.card_id];
    const selected = ui.attacker === unit.iid;
    const hot = ui.attacker && seat !== game.seat;
    const ribbons = [
      unit.sick ? '新入场' : '',
      unit.attacked ? '已攻击' : '',
      C.hasGuard(cards, unit) ? '护卫' : '',
      unit.attachments.map(id => cards[id].name).join(' ')
    ].filter(Boolean).join(' · ');
    return `<button type="button" class="minion${selected ? ' selected' : ''}${hot ? ' hot' : ''}${C.hasGuard(cards, unit) ? ' guard' : ''}${unit.sick ? ' sick' : ''}${unit.attacked ? ' spent' : ''}" data-action="select-unit" data-board-seat="${seat}" data-slot="${slot}" data-seat="${seat}" data-iid="${esc(unit.iid)}" data-card="${esc(unit.card_id)}" data-sick="${unit.sick}" data-guard="${C.hasGuard(cards, unit)}" data-attack="${C.attackOf(cards, unit)}" data-durability="${unit.durability}">
      <span class="portrait">${picture(card, 'board')}</span>
      <span class="atk">${C.attackOf(cards, unit)}</span>
      <span class="hp">${unit.durability}</span>
      <span class="mname">${esc(card.name)}</span>
      ${ribbons ? `<span class="ribbon">${esc(ribbons)}</span>` : ''}
    </button>`;
  }
  function coreSvg() {
    return `<svg class="core-art" viewBox="0 0 86 86" aria-hidden="true">
      <circle cx="43" cy="43" r="38" fill="#10281c" stroke="currentColor" stroke-width="3"/>
      <circle cx="43" cy="43" r="30" fill="none" stroke="#8a5a32" stroke-width="1" stroke-dasharray="2 3"/>
      <rect x="28" y="30" width="30" height="24" rx="4" fill="#0b1c14" stroke="#9dcec4"/>
      <circle cx="36" cy="40" r="3.2" fill="#39f3d4"/>
      <circle cx="50" cy="40" r="3.2" fill="#ffb020"/>
      <rect x="36" y="47" width="14" height="2.4" rx="1" fill="#e8a56a"/>
      <path d="M43 30 V16" stroke="#e8a56a" stroke-width="2"/>
      <circle cx="43" cy="13" r="3" fill="#ff4d3a"/>
      <circle cx="16" cy="43" r="2" fill="#d7e2c8"/><circle cx="70" cy="43" r="2" fill="#d7e2c8"/>
      <circle cx="43" cy="72" r="2" fill="#d7e2c8"/>
    </svg>`;
  }
  function core(seat) {
    const active = game.seat === seat && game.phase === 'main';
    const hot = ui.attacker && seat !== game.seat;
    return `<div class="core-wrap${active ? ' active' : ''}${hot ? ' hot' : ''}">
      <button type="button" class="base-btn core" data-action="hit-base" data-seat="${seat}" aria-label="${seatName(seat)}基地">
        ${coreSvg()}
        <span class="hp" data-seat="${seat}" data-stat="base">${game.bases[seat]}</span>
      </button>
      <div class="silk">${seatName(seat)}核心</div>
      ${seat === game.seat ? '' : supply(seat)}
    </div>`;
  }
  function supply(seat) {
    return `<div class="battery">${mana(seat)}<div class="supply-read">供电 <b data-seat="${seat}" data-stat="supply">${game.supply[seat]}</b> / <b data-seat="${seat}" data-stat="max-supply">${game.max_supply[seat]}</b></div></div>`;
  }
  function stack(seat) {
    return `<div class="stack">
      <div class="deck-stack" data-seat="${seat}" data-stat="deck" title="${seatName(seat)}牌库">${game.decks[seat].length}</div>
      <div class="silk">库</div>
      <div class="grave-stack" title="${seatName(seat)}墓地">${game.graves[seat].length}</div>
      <div class="silk">墓</div>
      <div class="silk">疲劳 <b data-seat="${seat}" data-stat="fatigue">${game.fatigue[seat]}</b></div>
      <div class="silk">手 <b data-seat="${seat}" data-stat="hand">${game.hands[seat].length}</b></div>
      <ol class="grave" data-grave="${seat}" hidden>${game.graves[seat].map(id => `<li data-card="${esc(id)}">${esc(cards[id].name)}</li>`).join('')}</ol>
    </div>`;
  }

  function catalog() {
    if (!ui.catalog) return '';
    const rows = content.cards.map(card => `<article>
      <h4>${esc(card.name)} · ${card.cost} 费</h4>
      <p>${kindName(card.kind)}${card.kind === 'main' ? ` · 攻 ${card.attack} · 耐 ${card.durability}` : ''}${card.guard ? ' · 护卫' : ''}</p>
      <p>玩法种类：${kindName(card.kind)}。游戏角色：${esc(card.game_role || '卡表未单列')}。硬件主控：${esc(card.hardware_controller || '卡表未单列，不从玩法反推')}。美术 type：${card.art_type == null ? '未填' : esc(card.art_type)}。</p>
      <p>星级：${C.starOf(card) == null ? '卡上没写' : C.starOf(card) + ' 星'}。家族：${C.familyOf(card) == null ? '卡上没写' : esc(C.familyOf(card))}。</p>
      <p>${esc(card.role_note || '')}</p>
      <p class="hint">系列 ${esc(card.series)} 只用于找图，不参与结算，也不当成家族或星级。版本号不会换成星级。本地没有这张图时就显示文字。</p>
    </article>`).join('');
    const token = content.second_player_token;
    return `<div class="catalog">${rows}<article><h4>${esc(token.name)}</h4><p>${esc(token.role_note)}</p><p class="hint">后手代币，不在代表卡列表里，也不在牌库里。当前代表卡 ${content.cards.length} 张。</p></article></div>`;
  }

  function actions() {
    const card = selectedCard();
    const bits = [];
    if (card && (card.kind === 'main' || card.effect === 'supply' || card.effect === 'heal_base')) {
      const label = card.effect === 'play_damage' ? '直接焊装' : '焊装';
      bits.push(`<button type="button" class="pad live" data-action="play">${label}</button>`);
    }
    if (card && card.effect === 'mend' && ui.target) {
      bits.push('<button type="button" class="pad live" data-action="mend-heal">修复耐久</button>');
      bits.push('<button type="button" class="pad live" data-action="mend-temp">攻击 +1</button>');
    }
    bits.push(`<button type="button" class="pad${ui.attacker ? ' live' : ''}" data-action="attack-base">打核心</button>`);
    bits.push(promoteButtons());
    bits.push('<button type="button" class="pad" data-action="support">支援</button>');
    bits.push(`<button type="button" class="pad${ui.knob ? ' live' : ''}" data-action="arm-knob">旋钮</button>`);
    return bits.join('');
  }

  function promoteChoices() {
    if (!game || game.phase !== 'main' || game.winner != null) return [];
    const hand = game.hands[game.seat];
    const found = [];
    for (const unit of game.units(game.seat)) {
      const card = cards[unit.card_id];
      if (card && card.next_template_id && hand.includes(card.next_template_id)) {
        found.push({ currentId: unit.card_id, where: '位置 ' + unit.slot });
      }
      for (const attachment of unit.attachments) {
        const part = cards[attachment];
        if (part && part.next_template_id && hand.includes(part.next_template_id)) {
          found.push({ currentId: attachment, where: cards[unit.card_id].name + ' 的配件' });
        }
      }
    }
    return found;
  }

  function promoteButtons() {
    return promoteChoices().map(choice => {
      const current = cards[choice.currentId];
      const next = cards[current.next_template_id];
      const cost = Math.max(1, next.cost - current.cost);
      const short = game.supply[game.seat] < cost ? '，电不够' : '';
      return `<button type="button" class="pad live" data-action="promote" data-current="${esc(choice.currentId)}">升到${esc(next.name)} ${cost}电${short}</button>`;
    }).join('');
  }

  function deckOk(deck) {
    return deck.length >= 8 && deck.length <= 12 && new Set(deck).size === deck.length && deck.filter(id => cards[id].kind === 'main').length >= 4;
  }

  function renderBuilder() {
    const seat = ui.builderSeat || 0;
    const deck = ui.decks[seat];
    const filters = [['all', '全部'], ['main', '主控'], ['attachment', '配件'], ['chain', '可升星'], ['baseline', '基线无图']];
    const baselineOnly = new Set(content.cards.map(card => card.template_id).filter(id => !roster.cards.some(card => card.template_id === id)));
    const list = Object.keys(cards).filter(id => id !== tokenId).map(id => cards[id]).filter(card => {
      if (ui.poolFilter === 'main') return card.kind === 'main';
      if (ui.poolFilter === 'attachment') return card.kind === 'attachment';
      if (ui.poolFilter === 'chain') return card.growth_kind === 'chain';
      if (ui.poolFilter === 'baseline') return baselineOnly.has(card.template_id);
      return true;
    }).sort((a, b) => a.name.localeCompare(b.name, 'zh'));
    $('#app').innerHTML = `<header class="top">
      <div class="brand"><b>PULSE</b><span>扩展组牌</span></div>
      <nav class="pulse-nav" data-shared-entry="clash-home"><a href="../../index.html">大厅</a><a href="../../wiki/index.html">图鉴</a><a href="../index.html">旧版点数</a></nav>
      <button type="button" class="btn" data-action="scenario" data-scenario="lesson">返回教学局</button>
    </header>
    <main class="builder" data-scenario="builder" data-ruleset="${esc(content.ruleset_id)}">
      <p class="balance">96 张扩展加 7 张没有对应图的基线牌。每副 8 到 12 张，至少 4 张主控，同名 1 张。星级只认卡上的 star，不认版本号。数值待试玩。</p>
      <div class="scenario-row">
        <button type="button" data-action="builder-seat" data-seat="0">先手 ${ui.decks[0].length} 张</button>
        <button type="button" data-action="builder-seat" data-seat="1">后手 ${ui.decks[1].length} 张</button>
        <button type="button" data-action="preset" data-preset="first">先手示例：小印链</button>
        <button type="button" data-action="preset" data-preset="second">后手示例：壳与表</button>
        <button type="button" class="primary" data-action="start-free" ${deckOk(ui.decks[0]) && deckOk(ui.decks[1]) ? '' : 'disabled'}>开始扩展对局</button>
      </div>
      <p>${seatName(seat)}牌库：</p>
      <div class="deck-picks" data-deck="${seat}">${deck.map(id => `<span data-card="${esc(id)}">${esc(cards[id].name)}</span>`).join('、') || '还没选'}</div>
      <div class="scenario-row">${filters.map(([id, label]) => `<button type="button" data-action="pool-filter" data-value="${id}">${label}</button>`).join('')}</div>
      <div class="pool">${list.map(card => {
        const star = C.starOf(card);
        const picked = deck.includes(card.template_id);
        return `<button type="button" class="${picked ? 'picked' : ''}" data-action="toggle-pool" data-card="${esc(card.template_id)}">${esc(card.name)} · ${card.cost}费 · ${kindName(card.kind)}${star ? ' · ' + star + '星' : ''}${card.growth_kind === 'chain' ? ' · 可升星' : ''}<br><span class="hint">${esc(card.game_description || card.role_note || '基线牌，没有 96 图')}</span></button>`;
      }).join('')}</div>
    </main>`;
    document.body.dataset.ready = '1';
  }

  function render() {
    if (ui.scenario === 'builder') return renderBuilder();
    const over = game.winner == null ? '' : game.winner === 'draw' ? '平局' : `${seatName(game.winner)}获胜`;
    const active = game.seat;
    const other = 1 - active;
    $('#app').innerHTML = `<div class="table-page">
    <header class="pulse-top">
      <a class="pulse-brand" data-nav="lobby" href="../../index.html"><span class="pulse-mark">P</span><span><span class="pulse-name">PULSE</span><div class="pulse-sub">脉冲对决</div></span></a>
      <nav class="pulse-nav" data-shared-entry="clash-home" aria-label="站点入口">
        <a data-nav="lobby" href="../../index.html">大厅</a>
        <a data-nav="clash" href="./index.html" aria-current="page">回合战</a>
        <a data-nav="wiki" href="../../wiki/index.html">图鉴</a>
        <a data-nav="legacy" href="../index.html">旧版点数</a>
      </nav>
      <div class="top-actions">
        <button type="button" data-action="toggle-reveal" aria-pressed="${ui.reveal}">${ui.reveal ? '遮住对方手牌' : '教学明牌'}</button>
        <button type="button" data-action="restart">重新开局</button>
      </div>
    </header>
    <p class="orient">竖屏可以操作。横过来能一次看完这块开发板。</p>
    ${ui.reveal ? '<div class="banner" id="reveal-banner">教学明牌 · 双方手牌都看得见 · 牌库仍只显示张数</div>' : '<div id="reveal-banner" hidden></div>'}
    <main class="arena table${ui.attacker ? ' aiming' : ''}${canDeploy() ? ' holding' : ''}" data-scenario="${esc(ui.scenario)}" data-ruleset="${esc(content.ruleset_id)}" data-source-commit="${esc(C.SOURCE_COMMIT)}">
      <svg class="traces" viewBox="0 0 1200 800" preserveAspectRatio="none" aria-hidden="true">
        <path d="M70 36 H1130 V764 H70 Z" fill="none" stroke="#c47a45" stroke-width="3"/>
        <path d="M90 70 H1110 M90 730 H1110 M210 90 V710 M990 90 V710" fill="none" stroke="#e8a56a" stroke-width="1.4" opacity=".45"/>
        <path d="M230 180 H970 M230 400 H970 M230 620 H970" fill="none" stroke="#39f3d4" stroke-width="1.2" opacity=".28"/>
        <g fill="#d7e2c8">${[120, 240, 360, 520, 760, 980].map(x => [150, 390, 640].map(y => `<circle cx="${x}" cy="${y}" r="3.2"/>`).join('')).join('')}</g>
        <g fill="none" stroke="#8a5a32" stroke-width="2">${[[40, 24], [1168, 24], [40, 776], [1168, 776]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="7"/>`).join('')}</g>
      </svg>
      <aside class="rail side">
        ${handHtml(other, false)}
        ${stack(other)}
        ${stack(active)}
        <details class="teach"><summary>教学</summary><div class="scenario-row">
          <button type="button" data-action="scenario" data-scenario="lesson">教学局</button>
          <button type="button" data-action="scenario" data-scenario="support-present">小印已在场</button>
          <button type="button" data-action="scenario" data-scenario="support-deploy">先打出小印</button>
          <button type="button" data-action="scenario" data-scenario="support-again">厚壳再死</button>
          <button type="button" data-action="scenario" data-scenario="promote-stamp">小印升星</button>
          <button type="button" data-action="scenario" data-scenario="builder">扩展组牌</button>
        </div></details>
        <details class="quiet-log"><summary>记录</summary><ol id="action-log" class="log">${ui.log.slice(-6).reverse().map(item => `<li${item.code ? ` class="bad" data-error-code="${esc(item.code)}"` : ''}>${esc(item.text)}</li>`).join('')}</ol></details>
      </aside>
      <div class="core-slot foe">${core(other)}</div>
      <div class="slots foe">${game.boards[other].map((unit, slot) => unitHtml(other, slot, unit)).join('')}</div>
      <div class="midline">
        <h3 id="turn-label" data-seat="${game.seat}">${over || seatName(active) + '的回合'}</h3>
        <p id="coach">${esc(coach())}</p>
        <p id="last-error" data-code="${esc(ui.error ? ui.error.code : '')}">${ui.error ? esc(ui.error.message) : ''}</p>
      </div>
      <div class="slots mine">${game.boards[active].map((unit, slot) => unitHtml(active, slot, unit)).join('')}</div>
      <div class="core-slot mine">${core(active)}</div>
      <section class="hand-dock" aria-label="当前手牌">${handHtml(active, true)}</section>
      <aside class="rail tools">
        <button type="button" class="end-turn" data-action="end-turn">结束回合</button>
        ${supply(active)}
        <div class="pads">${actions()}</div>
      </aside>
    </main>
    </div>`;
    document.body.dataset.ready = '1';
    document.body.dataset.ruleset = content.ruleset_id;
  }

  function play(target, mode) {
    const card = selectedCard();
    if (!card) return note(new C.ClashError('请先选择手牌', 'not_in_hand'));
    const seat = game.seat;
    try {
      game.play(seat, card.template_id, target == null ? null : target, mode || null);
    } catch (error) {
      return note(error);
    }
    let text = `${seatName(seat)}打出${card.name}，费用 ${card.cost}。`;
    if (card.effect === 'supply') text += `当前供电 ${game.supply[seat]}，上限仍是 ${game.max_supply[seat]}。`;
    push(text);
    clearChoice();
    render();
  }

  function attack(target) {
    if (!ui.attacker) return note(new C.ClashError('请先点一台己方单位', 'bad_target'));
    const attacker = game.find(ui.attacker)[2];
    try {
      game.attack(game.seat, ui.attacker, target);
    } catch (error) {
      return note(error);
    }
    const name = cards[attacker.card_id].name;
    push(target === 'base' ? `${name}攻击了对方基地。` : `${name}与对方单位同时结算伤害。`);
    clearChoice();
    render();
  }

  function onUnit(el) {
    const iid = el.dataset.iid;
    const seat = Number(el.dataset.seat);
    const card = selectedCard();
    if (ui.knob) {
      try { game.knob(game.seat, pack.capabilities.bindings.knob.source, iid); }
      catch (error) { return note(error); }
      push(`旋钮台强化了${cards[game.find(iid)[2].card_id].name}，本回合攻击 +1。`);
      clearChoice();
      return render();
    }
    if (card && card.effect === 'play_damage') {
      if (seat === game.seat) return note(new C.ClashError('入场伤害只能指定敌方单位', 'bad_target'));
      return play(iid);
    }
    if (card && (card.kind === 'attachment' || card.effect === 'damage')) return play(iid);
    if (card && card.effect === 'mend') {
      ui.target = iid;
      ui.error = null;
      return render();
    }
    if (seat === game.seat) {
      ui.attacker = iid;
      ui.handIndex = null;
      ui.error = null;
      return render();
    }
    if (ui.attacker) return attack(iid);
    note(new C.ClashError('这台不是你的单位', 'bad_target'));
  }

  function endTurn() {
    const next = 1 - game.seat;
    const deckBefore = game.decks[next].length;
    const handBefore = game.hands[next].length;
    const graveBefore = game.graves[next].length;
    const fatigueBefore = game.fatigue[next];
    const actor = seatName(game.seat);
    try {
      C.finishTurn(game);
    } catch (error) {
      return note(error);
    }
    clearChoice();
    let text = `${actor}结束回合，临时攻击和供电清零。立刻轮到${seatName(game.seat)}。`;
    if (deckBefore === 0 && game.fatigue[next] !== fatigueBefore) {
      text += game.winner != null
        ? ` ${seatName(next)}疲劳后基地倒下，供电上限没有增加。终局锁定。`
        : ` ${seatName(next)}疲劳 ${game.fatigue[next]}，基地 ${game.bases[next]}，然后供电回满。`;
    } else if (deckBefore > 0 && game.hands[next].length === handBefore && game.graves[next].length > graveBefore) {
      text += ` 手牌已满，${cards[game.graves[next].at(-1)].name}亮出后进入墓地。`;
    } else if (deckBefore > 0 && game.hands[next].length > handBefore) {
      text += ui.reveal ? ` 教学明牌：抽到${cards[game.hands[next].at(-1)].name}。` : ' 抽了 1 张牌。';
    } else if (game.seat === 0 && game.turns_started[0] === 1) {
      text += ' 先手第 1 回合不抽牌。';
    }
    push(text);
    render();
  }

  function act(action, el) {
    if (action === 'toggle-reveal') { ui.reveal = !ui.reveal; return render(); }
    if (action === 'toggle-catalog') { ui.catalog = !ui.catalog; return render(); }
    if (action === 'restart' || action === 'scenario') return begin(action === 'restart' ? ui.scenario : el.dataset.scenario);
    if (action === 'select-hand') {
      ui.handIndex = Number(el.dataset.handIndex);
      ui.attacker = null;
      ui.target = null;
      ui.knob = false;
      ui.error = null;
      return render();
    }
    if (action === 'select-unit') return onUnit(el);
    if (action === 'play') return play(null);
    if (action === 'mend-heal') return play(ui.target, 'heal');
    if (action === 'mend-temp') return play(ui.target, 'temp');
    if (action === 'attack-base') return attack('base');
    if (action === 'hit-base') {
      if (Number(el.dataset.seat) !== game.seat && ui.attacker) return attack('base');
      return;
    }
    if (action === 'support') {
      try { game.support(game.seat); }
      catch (error) { return note(error); }
      push('小印支援：厚壳以满耐久进入最左空位，有护卫，本回合不能攻击。小印留在场上。');
      clearChoice();
      return render();
    }
    if (action === 'arm-knob') {
      ui.knob = true;
      ui.handIndex = null;
      ui.attacker = null;
      ui.error = null;
      return render();
    }
    if (action === 'promote') {
      const currentId = el.dataset.current;
      const current = cards[currentId];
      const next = cards[current.next_template_id];
      const cost = Math.max(1, next.cost - current.cost);
      try { game.promote(game.seat, currentId); }
      catch (error) { return note(error); }
      push(`${current.name}升成${next.name}，花了 ${cost} 电。新牌在原处，满耐久，本回合不能攻击，旧配件不留下。`);
      clearChoice();
      return render();
    }
    if (action === 'builder-seat') { ui.builderSeat = Number(el.dataset.seat); return render(); }
    if (action === 'pool-filter') { ui.poolFilter = el.dataset.value; return render(); }
    if (action === 'preset') {
      ui.decks[ui.builderSeat] = (el.dataset.preset === 'second' ? presetSecond : presetFirst).slice();
      return render();
    }
    if (action === 'toggle-pool') {
      const id = el.dataset.card;
      const deck = ui.decks[ui.builderSeat];
      const index = deck.indexOf(id);
      if (index >= 0) deck.splice(index, 1);
      else if (deck.length >= 12) return note(new C.ClashError('一副最多 12 张', 'bad_card'));
      else deck.push(id);
      ui.error = null;
      return render();
    }
    if (action === 'start-free') {
      if (!deckOk(ui.decks[0]) || !deckOk(ui.decks[1])) return note(new C.ClashError('两副都要 8 到 12 张，且至少 4 张主控', 'bad_card'));
      const decks = ui.decks.map(deck => deck.slice());
      ui = blankUi('free');
      game = new C.Game(cards, decks[0], decks[1], rules, tokenId, pack.capabilities);
      game.start_turn();
      push('扩展对局开始。牌序按组牌时的点选顺序，不洗牌。');
      return render();
    }
    if (action === 'end-turn') return endTurn();
  }

  document.addEventListener('click', event => {
    const el = event.target.closest('[data-action]');
    if (!el || !$('#app').contains(el)) return;
    event.preventDefault();
    act(el.dataset.action, el);
  });

  begin('lesson');
})(globalThis);
