(function (root) {
  'use strict';
  const C = root.PCGClash;
  const content = root.PCGClashContent;
  const pack = C.loadPack(content, root.PCGClashCapabilities);
  const $ = document.querySelector.bind(document);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const rules = pack.rules;
  const cards = pack.cards;
  const tokenId = pack.tokenId;
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
    }
    render();
  }

  function selectedCard() {
    if (ui.handIndex == null) return null;
    const id = game.hands[game.seat][ui.handIndex];
    return id ? cards[id] : null;
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
    if (card && card.effect === 'mend' && !ui.target) return '点一台己方单位。可以修复耐久，或让它本回合攻击 +1。不能治疗基地。';
    if (card && card.effect === 'mend') return '选择修复 2 点耐久（不超过卡面），或本回合攻击 +1。';
    if (ui.attacker) return '点敌方单位，或按“攻击对方基地”。新入场不能攻击。对方有护卫时，没有千里眼就只能打护卫。';
    return '点手牌出牌，点己方单位后再选攻击目标。场上的小印可以支援自己墓地里的厚壳，小印不会离场。';
  }

  function art(card) {
    const series = esc(card.series || '');
    return `<span class="no-art">无图 · 系列 ${series}</span><img class="series-art" alt="" hidden data-series="${series}" src="series/${series}.png" onload="this.hidden=false;this.previousElementSibling.hidden=true" onerror="this.remove()">`;
  }

  function handHtml(seat) {
    const show = ui.reveal || seat === game.seat;
    if (!show) {
      const backs = game.hands[seat].map(() => '<div class="back" aria-hidden="true"></div>').join('');
      return `<div class="hands" data-hand-seat="${seat}" data-hidden="1">${backs}<span class="hint">手牌 ${game.hands[seat].length} 张，牌面已遮住</span></div>`;
    }
    const open = game.hands[seat].map((id, index) => {
      const card = cards[id];
      const selected = seat === game.seat && ui.handIndex === index;
      const body = `${art(card)}<span class="cost">${card.cost}</span><div class="name">${esc(card.name)}</div><div class="hint">${esc(blurb(card))}</div>`;
      if (seat !== game.seat) return `<div class="card" data-card="${esc(id)}">${body}<div class="tag">教学明牌</div></div>`;
      return `<button type="button" class="card${selected ? ' selected' : ''}" data-action="select-hand" data-hand-index="${index}" data-card="${esc(id)}">${body}</button>`;
    }).join('');
    return `<div class="hands" data-hand-seat="${seat}" data-hidden="0">${open || '<span class="hint">没有手牌</span>'}</div>`;
  }

  function unitHtml(seat, slot, unit) {
    if (!unit) return `<div class="slot empty" data-board-seat="${seat}" data-slot="${slot}" data-card="">空位 ${slot}</div>`;
    const card = cards[unit.card_id];
    const tags = [
      unit.sick ? '<span class="tag sick">新入场</span>' : '',
      unit.attacked ? '<span class="tag">已攻击</span>' : '',
      C.hasGuard(cards, unit) ? '<span class="tag guard">护卫</span>' : '',
      unit.temp_attack ? `<span class="tag att">临时 +${unit.temp_attack}</span>` : '',
      unit.attachments.map(id => `<span class="tag att">配件 ${esc(cards[id].name)}</span>`).join('')
    ].join('');
    return `<button type="button" class="unit" data-action="select-unit" data-board-seat="${seat}" data-slot="${slot}" data-seat="${seat}" data-iid="${esc(unit.iid)}" data-card="${esc(unit.card_id)}" data-sick="${unit.sick}" data-guard="${C.hasGuard(cards, unit)}" data-attack="${C.attackOf(cards, unit)}" data-durability="${unit.durability}">
      <div class="slot-label"><b>${slot}</b><span class="name">${esc(card.name)}</span></div>
      <div class="nums">攻 ${C.attackOf(cards, unit)} · 耐 ${unit.durability}/${card.durability}</div>
      ${tags || '<span class="tag">可行动</span>'}
    </button>`;
  }

  function side(seat) {
    const active = game.seat === seat && game.phase === 'main';
    return `<section class="side${active ? ' active' : ''}" data-player="${seat}">
      <div class="side-head">
        <h2>${seatName(seat)}${active ? ' · 当前回合' : ''}</h2>
        <button type="button" class="base-btn" data-action="hit-base" data-seat="${seat}">基地 <span class="hp" data-seat="${seat}" data-stat="base">${game.bases[seat]}</span></button>
        <div class="stats">供电 <b data-seat="${seat}" data-stat="supply">${game.supply[seat]}</b> / 上限 <b data-seat="${seat}" data-stat="max-supply">${game.max_supply[seat]}</b>${game.supply[seat] > game.max_supply[seat] ? ' · 高于上限' : ''}</div>
        <div class="stats">牌库 <b data-seat="${seat}" data-stat="deck">${game.decks[seat].length}</b> · 疲劳 <b data-seat="${seat}" data-stat="fatigue">${game.fatigue[seat]}</b> · 手牌 <b data-seat="${seat}" data-stat="hand">${game.hands[seat].length}</b></div>
      </div>
      <div class="slots">${game.boards[seat].map((unit, slot) => unitHtml(seat, slot, unit)).join('')}</div>
      ${handHtml(seat)}
      <ol class="grave" data-grave="${seat}">${game.graves[seat].map(id => `<li data-card="${esc(id)}">${esc(cards[id].name)}</li>`).join('') || '<li>墓地是空的</li>'}</ol>
    </section>`;
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
      bits.push(`<button type="button" class="primary" data-action="play">${card.kind === 'main' ? '打出到最左空位' : '打出'}</button>`);
    }
    if (card && card.effect === 'mend' && ui.target) {
      bits.push('<button type="button" class="primary" data-action="mend-heal">修复 2 点耐久</button>');
      bits.push('<button type="button" class="primary" data-action="mend-temp">本回合攻击 +1</button>');
    }
    bits.push('<button type="button" data-action="attack-base">攻击对方基地</button>');
    bits.push('<button type="button" data-action="support">小印支援厚壳</button>');
    bits.push('<button type="button" data-action="arm-knob">旋钮强化</button>');
    bits.push('<button type="button" class="primary" data-action="end-turn">结束回合</button>');
    return bits.join('');
  }

  function render() {
    const over = game.winner == null ? '' : game.winner === 'draw' ? '平局' : `${seatName(game.winner)}获胜`;
    $('#app').innerHTML = `<header class="top">
      <div class="brand"><b>PULSE</b><span>脉冲对决 · 回合战</span></div>
      <nav data-shared-entry="clash-home" aria-label="站点入口">
        <a data-nav="clash" href="./index.html" aria-current="page">回合战</a>
        <a data-nav="legacy" href="../index.html" title="旧版点数对局在上一级页面。只发回合战压缩包时，这个链接不在包内。">旧版点数对局</a>
        <!-- wiki-slot: 图鉴分支把下一行换成 <a data-nav="wiki" href="../wiki/">卡片图鉴</a>。不要把图鉴元数据当玩法数据。 -->
        <span data-nav="wiki" data-wiki-slot="pending" title="图鉴由另一条分支接入。玩法数据只认卡表，不认图鉴，也不从版本号推星级。">图鉴</span>
      </nav>
      <div class="top-actions">
        <button type="button" class="btn" data-action="toggle-reveal" aria-pressed="${ui.reveal}">${ui.reveal ? '遮住对方手牌' : '教学明牌'}</button>
        <button type="button" class="btn" data-action="toggle-catalog">${ui.catalog ? '收起卡表' : content.cards.length + ' 张卡表'}</button>
        <button type="button" class="btn" data-action="restart">重新开局</button>
      </div>
    </header>
    ${ui.reveal ? '<div class="banner" id="reveal-banner">教学明牌 · 双方手牌都看得见 · 牌库仍只显示张数</div>' : '<div id="reveal-banner" hidden></div>'}
    <p class="balance">首版数值，待试玩平衡。基地 20，供电上限 10，手牌 8，场位 5。鼠标本地双人，没有联网，也没有电脑对手。</p>
    <main class="table" data-scenario="${esc(ui.scenario)}" data-ruleset="${esc(content.ruleset_id)}" data-source-commit="${esc(C.SOURCE_COMMIT)}">
      <div class="scenario-row">
        <button type="button" data-action="scenario" data-scenario="lesson">教学局</button>
        <button type="button" data-action="scenario" data-scenario="support-present">战例：小印已在场</button>
        <button type="button" data-action="scenario" data-scenario="support-deploy">战例：先打出小印</button>
        <button type="button" data-action="scenario" data-scenario="support-again">战例：厚壳再死</button>
      </div>
      ${side(1)}
      <section class="center">
        <h3 id="turn-label" data-seat="${game.seat}">${over || seatName(game.seat) + '的回合'}</h3>
        <p id="coach">${esc(coach())}</p>
        <p id="last-error" data-code="${esc(ui.error ? ui.error.code : '')}">${ui.error ? esc(ui.error.message) + '（' + esc(ui.error.code) + '）' : '没有待处理的非法操作'}</p>
        <div class="action-row">${actions()}</div>
        <ol id="action-log" class="log">${ui.log.slice().reverse().map(item => `<li${item.code ? ` class="bad" data-error-code="${esc(item.code)}"` : ''}>${esc(item.text)}</li>`).join('')}</ol>
      </section>
      ${side(0)}
      ${catalog()}
      <p class="foot">规则 ${esc(content.ruleset_id)} · 来源提交 ${esc(C.SOURCE_COMMIT)} · 当前卡表 ${content.cards.length} 张，另加后手代币。星级和家族只在卡数据写了才显示，不从版本号推断，升星还没接。系列图片按 series 从本目录 series/ 读取，缺图就用文字。结算不看硬件型号。</p>
    </main>`;
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
