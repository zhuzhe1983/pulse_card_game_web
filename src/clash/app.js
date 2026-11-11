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
  const services = root.PCGClashServices || { cards: [], design_hosts: [] };
  services.cards.concat(services.design_hosts || []).forEach(card => { cards[card.template_id] = card; });
  const presetFirst = ['art_h039a', 'xiao_yin', 'art_h038a', 'hou_ke', 'dian_zhen', 'art_h027a', 'xuan_niu', 'art_h003', 'art_h025', 'lian_jie'];
  const presetSecond = ['art_h005', 'art_h007', 'qiao_jian', 'art_h032', 'art_h036', 'art_h036a', 'art_c004c', 'art_c004d', 'gan_rao', 'hu_zhao'];
  const seatName = seat => seat === 0 ? '先手' : '后手';
  const kindName = kind => kind === 'main' ? '主控' : kind === 'attachment' ? '配件' : '战术';
  function blurb(card) {
    let text = kindName(card.kind);
    if (card.kind === 'main') text = `主控 · 攻${card.attack} 耐${card.durability}${card.guard ? ' · 护卫' : ''}${card.upper_host ? ' · 上位机' : ''}`;
    else if (card.effect === 'draw_one') text = '服务 · 抽 1 张';
    else if (card.effect === 'retrieve_grave') text = '服务 · 取回墓地顶';
    else if (card.effect === 'arm_aiflow') text = '服务 · 下一击 +2';
    else if (card.effect === 'seize') text = '服务 · 夺走敌方主控';
    else if (card.attack_bonus) text = `配件 · 攻击 +${card.attack_bonus}${card.chain_piece ? ' · 链节' : ''}`;
    else if (card.chain_piece) text = '配件 · 链节';
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
    return { scenario, reveal: false, catalog: false, handIndex: null, attacker: null, target: null, knob: false, aiming: false, linking: false, linkSource: null, chainIndex: null, menu: false, logOpen: false, showBanner: true, fresh: true, seen: new Set(), fx: null, error: null, log: [] };
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
    ui.aiming = false;
    ui.linking = false;
    ui.linkSource = null;
    ui.chainIndex = null;
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
      push('摆阵：后手用干扰打掉最左的厚壳。小印前移到最左。结束回合后先手可以再支援。');
    } else if (scenario === 'promote-stamp') {
      game = C.Game.empty(cards, rules, pack.capabilities);
      game.supply = [5, 0];
      game.max_supply = [5, 0];
      game.hands = [['art_h038a'], []];
      game.spawn(0, 'art_h024', 0, null, false);
      game.spawn(0, 'dian_zhen', 1, null, false);
      const stamp = game.spawn(0, 'xiao_yin', 2, null, false);
      stamp.attachments = ['lian_jie'];
      game.graves = [['hou_ke'], []];
      push('摆阵：小印在第 3 位，左右邻居不动。手牌是小印改。升星费用是差价 1。');
    } else if (scenario === 'grow') {
      game = C.Game.empty(cards, rules, pack.capabilities);
      game.supply = [10, 10];
      game.max_supply = [10, 10];
      game.hands = [['art_h024', 'art_h024', 'art_h039a'], []];
      game.graves = [['hou_ke'], []];
      ['xiao_yin', 'dian_zhen', 'xuan_niu', 'qiao_jian', 'qiao_jian'].forEach((id, index) => {
        const unit = game.spawn(0, id, index, null, false);
        unit.sick = false;
      });
      game.spawn(1, 'art_h024', 0, 4, false);
      game.spawn(1, 'hou_ke', 1, 4, false);
      push('摆阵：先手已经有 5 台。再打出新细条会排到最右，支援把厚壳插到最左。');
    } else if (scenario === 'crowd') {
      game = C.Game.empty(cards, rules, pack.capabilities);
      game.supply = [1, 0];
      game.max_supply = [1, 1];
      const line = ['xiao_yin', 'dian_zhen', 'xuan_niu', 'qiao_jian', 'art_h024', 'art_h003', 'hou_ke'];
      line.forEach((id, index) => {
        game.spawn(0, id, index, null, false).sick = false;
        game.spawn(1, id, index, null, false).sick = false;
      });
      push('摆阵：两边各 7 台，用来看战线有没有被核心或手牌挡住。');
    } else if (scenario === 'synergy') {
      game = C.Game.empty(cards, rules, pack.capabilities);
      game.supply = [10, 10];
      game.max_supply = [8, 8];
      game.decks = [['hou_ke'], []];
      game.hands = [['lian_jie', 'uiflow_blocks', 'ezdata_note', 'aiflow_say', 'burner_seize'], []];
      game.spawn(0, 'art_h050', 0, null, false).sick = false;
      game.spawn(0, 'qiao_jian', 1, null, false).sick = false;
      game.spawn(1, 'hou_ke', 0, 4, false);
      push('协同：零键可以连敲键。链节紧挨领队是 15%。手牌里有三张服务牌和夺舍。');
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

  function wantsTarget(card) {
    if (!card) return false;
    if (card.kind === 'attachment') return true;
    return card.effect === 'damage' || card.effect === 'mend' || card.effect === 'play_damage' || card.effect === 'seize';
  }

  function directPlay(card) {
    return !!(card && !wantsTarget(card) && (card.kind === 'main' || card.kind === 'spell'));
  }

  function canDeploy() {
    const card = selectedCard();
    return directPlay(card);
  }

  let handLock = 0;
  function deployFromHand(index) {
    const now = Date.now();
    if (now < handLock) return;
    handLock = now + 120;
    const id = game.hands[game.seat][index];
    const card = id ? cards[id] : null;
    if (!card) return;
    ui.handIndex = index;
    ui.attacker = null;
    ui.target = null;
    ui.knob = false;
    ui.linking = false;
    ui.linkSource = null;
    ui.chainIndex = null;
    ui.error = null;
    if (wantsTarget(card)) {
      ui.aiming = true;
      return render();
    }
    ui.aiming = false;
    if (directPlay(card)) return play(null);
    render();
  }

  function paintSelection() {
    const arena = document.querySelector('.arena');
    if (!arena) return render();
    arena.classList.toggle('aiming', !!ui.attacker);
    arena.classList.toggle('holding', canDeploy());
    document.querySelectorAll('.hands .playcard').forEach(node => {
      node.classList.toggle('selected', Number(node.dataset.handIndex) === ui.handIndex);
    });
    document.querySelectorAll('.minion').forEach(node => {
      node.classList.toggle('selected', !!(ui.attacker && node.dataset.iid === ui.attacker));
      node.classList.toggle('hot', !!(ui.attacker && Number(node.dataset.seat) !== game.seat));
    });
    document.querySelectorAll('.core-wrap').forEach(node => {
      const seatNode = node.querySelector('[data-stat="base"]');
      const foe = seatNode && Number(seatNode.dataset.seat) !== game.seat;
      node.classList.toggle('hot', !!(ui.attacker && foe));
    });
    const coachNode = document.querySelector('#coach');
    if (coachNode) coachNode.textContent = coach();
    const errorNode = document.querySelector('#last-error');
    if (errorNode) {
      errorNode.dataset.code = ui.error ? ui.error.code : '';
      errorNode.textContent = ui.error ? ui.error.message : '';
    }
    const pads = document.querySelector('.pads');
    if (pads) pads.innerHTML = actions();
    const mine = document.querySelector('.slots.mine');
    if (mine) mine.innerHTML = lane(game.seat);
  }

  function coach() {
    if (game.winner != null) return '终局已锁定。出牌、攻击、支援、旋钮和结束回合都会被拒绝。';
    if (ui.knob) return '旋钮已准备。点一台己方单位，本回合攻击 +1。可以点旋钮台自己。新入场也能用。';
    const card = selectedCard();
    if (card && wantsTarget(card)) {
      if (card.effect === 'mend' && ui.target) return '选择修复 2 点耐久（不超过卡面），或本回合攻击 +1。';
      if (card.kind === 'attachment') return `请选择目标：点一台己方主控，装上${card.name}。一台只能挂一个。`;
      if (card.effect === 'damage') return '请选择目标：点一台敌方单位。护卫拦不住，也没有反击。';
      if (card.effect === 'play_damage') return '请选择目标：点一台敌方单位造成 1 点伤害，或按焊装不造成伤害。';
      if (card.effect === 'seize') return '请选择目标：点一台敌方主控。链节标记、基地和己方单位都不能夺。';
      if (card.effect === 'mend') return '请选择目标：点一台己方单位，再选修复或临时强化。不能治疗基地。';
      if (card.chain_piece) return '链节会挂到点中的己方主控上。先点插入位置，标记就放在那里；不点就排到最右。';
    }
    if (ui.linking) return ui.linkSource ? '点一台己方 ESP32 主控。费用 1。本回合第一次接上时当前供电 +1。' : '点一台己方上位机。零键和树莓台可以发动。';
    if (card && card.kind === 'main') return `准备打出${card.name}。双击排到最右，也可以点队列里的插入位置。本回合不能攻击，技能不受这个限制。`;
    if (card && card.effect === 'supply') return '打出后当前供电 +1，可以暂时高于上限。回合结束会清零。';
    if (card && card.effect === 'heal_base') return '打出后己方基地恢复 4，不超过 20。';
    if (card && card.effect === 'draw_one') return '积木开工：抽 1 张。手牌满了就亮出进墓地。';
    if (card && card.effect === 'retrieve_grave') return '记一笔：取回自己墓地最上面一张。墓地是空的也会消耗这张牌。';
    if (card && card.effect === 'arm_aiflow') return '说人话：本回合下一次打击在百分比之前攻击 +2。已经武装时不能再打。';
    if (card && card.effect === 'play_draw') return '打出后额外抽 1 张。手牌满了会亮出进墓地。';
    if (card && card.rush) return '这张有冲锋，打出后本回合可以攻击。升星进来的仍不能攻击。';
    if (card && card.effect === 'mend' && !ui.target) return '点一台己方单位。可以修复耐久，或让它本回合攻击 +1。不能治疗基地。';
    if (card && card.effect === 'mend') return '选择修复 2 点耐久（不超过卡面），或本回合攻击 +1。';
    if (ui.attacker) return '点敌方单位，或按“攻击核心”。新入场不能攻击。对方有护卫时，没有千里眼就只能打护卫。';
    return '点手牌出牌，点己方单位后再选攻击目标。场上的小印可以支援自己墓地里的厚壳，小印不会离场。';
  }

  const artbook = root.PCGClashArt || {};
  const scenebook = root.PCGClashScene || { status: 'awaiting_generated_assets', slots: {} };
  function sceneUrl(slot) {
    const value = scenebook.slots && scenebook.slots[slot];
    return typeof value === 'string' && value ? value : '';
  }
  function sceneAttr(slot) {
    const url = sceneUrl(slot);
    return `data-scene-slot="${slot}" data-scene-ready="${url ? '1' : '0'}"${url ? ` style="--scene-url:url('${esc(url)}')"` : ''}`;
  }
  const painted = {
    bu_ji: 'scene/cards/art-supply-432x576.webp',
    uiflow_blocks: 'scene/cards/art-uiflow-432x576.webp',
    ezdata_note: 'scene/cards/art-ezdata-432x576.webp',
    aiflow_say: 'scene/cards/art-aiflow-432x576.webp',
    burner_seize: 'scene/cards/art-seize-432x576.webp'
  };
  function picture(card, kind) {
    if (card && card.template_id === tokenId) return `<img class="coin-lamp" src="scene/ui/lamp-power-on-amber-128.webp" alt="" draggable="false">`;
    const shot = card && artbook[card.rid];
    if (shot) return `<img src="${esc(kind === 'board' ? shot.char : shot.card)}" alt="" draggable="false">`;
    const paintedSrc = card && painted[card.template_id];
    if (paintedSrc) return `<img src="${esc(paintedSrc)}" alt="" draggable="false">`;
    return `<img src="scene/cardback/pulse-cardback-192x256.webp" alt="" draggable="false">`;
  }
  function mana(seat) {
    const max = Math.max(0, Math.min(10, game.max_supply[seat]));
    const cur = Math.max(0, game.supply[seat]);
    const bits = [];
    for (let i = 0; i < 10; i++) {
      const state = i < cur ? 'on' : i < max ? 'spent' : 'locked';
      bits.push(`<i class="${state}" data-lamp="${state}"></i>`);
    }
    return `<div class="mana" data-mana="${seat}" data-supply="${cur}" data-max="${max}">${bits.join('')}</div>`;
  }
  function handHtml(seat, dock) {
    const show = ui.reveal || seat === game.seat;
    if (!show) {
      const count = game.hands[seat].length;
      const backs = game.hands[seat].map((_, index) => `<div class="back" style="--i:${index};--n:${count}" aria-hidden="true"></div>`).join('');
      return `<div class="opp-hand" data-hand-seat="${seat}" data-hidden="1">${backs}<span class="hand-count">对方手牌 ${count}</span></div>`;
    }
    const count = game.hands[seat].length;
    const open = game.hands[seat].map((id, index) => {
      const card = cards[id];
      const selected = seat === game.seat && ui.handIndex === index;
      const ready = seat === game.seat && game.winner == null && card.cost <= game.supply[seat];
      const star = C.starOf(card);
      const nums = card.kind === 'main'
        ? `<span class="patk">${card.attack}</span><span class="php">${card.durability}</span>`
        : '';
      const coin = id === tokenId ? ' coin' : '';
      const body = `<span class="cost">${card.cost}</span>${star ? `<span class="star">${star}星</span>` : ''}<span class="art">${picture(card, 'board')}</span><span class="cname">${esc(card.name)}</span>${nums}<span class="detail">${esc(blurb(card))}</span>`;
      const fan = ` style="--i:${index};--n:${count}"`;
      if (seat !== game.seat) return `<div class="playcard${coin}" ${sceneAttr('hand_frame')} data-card="${esc(id)}"${fan}>${body}<span class="statsline">教学明牌</span></div>`;
      return `<button type="button" class="playcard${coin}${selected ? ' selected' : ''}${ready ? ' ready' : ''}" ${sceneAttr('hand_frame')} data-action="select-hand" data-hand-index="${index}" data-card="${esc(id)}"${fan}>${body}</button>`;
    }).join('');
    return `<div class="${dock ? 'hands fan' : 'opp-hand'}" data-hand-seat="${seat}" data-hidden="0">${open || '<span class="silk">没有手牌</span>'}</div>`;
  }
  function actButton(action, icon, label, tip, block, extra) {
    const off = block ? ' is-off' : '';
    const why = block ? `<i class="act-why">${esc(block.why)}</i>` : '';
    const code = block ? ` data-block="${esc(block.code)}"` : '';
    return `<button type="button" class="act${off}" data-action="${action}"${code}${extra || ''}><img src="${icon}" alt=""><span class="act-copy"><strong>${esc(label)}</strong><em>${esc(tip)}</em>${why}</span></button>`;
  }
  function attackBlock(unit) {
    if (!unit) return null;
    if (unit.sick) return { code: 'summoning_sickness', why: '新入场不能攻击' };
    if (unit.attacked) return { code: 'already_attacked', why: '本回合用过' };
    return null;
  }
  function paidBlock(unit, cost, usedKey) {
    if (unit && unit.ability_lock) return { code: 'seized_this_turn', why: '本回合不能发动' };
    if (usedKey && game.ability_used[game.seat][usedKey]) return { code: 'already_used_ability', why: '本回合用过' };
    if (game.supply[game.seat] < cost) return { code: 'not_enough_supply', why: '没电' };
    return null;
  }
  function supportBlock(unit) {
    const cost = cards[unit.card_id].amount;
    if (unit.ability_lock) return { code: 'seized_this_turn', why: '本回合不能发动' };
    if (game.ability_used[game.seat].support) return { code: 'already_used_ability', why: '本回合用过' };
    const reviveId = pack.capabilities.bindings.support.revive;
    const banned = game.promoteBan[game.seat] || [];
    if (!game.graves[game.seat].includes(reviveId) || banned.includes(reviveId)) {
      return { code: 'no_shell_in_grave', why: '墓地没有厚壳' };
    }
    if (game.supply[game.seat] < cost) return { code: 'not_enough_supply', why: '没电' };
    return null;
  }
  function unitMenu(unit) {
    const card = cards[unit.card_id];
    const bits = [];
    bits.push(actButton('attack-base', 'scene/ui/lamp-attack-amber.webp', '打基地', '打对方基地。对方有护卫，且这台没有千里眼时，只能打护卫。', attackBlock(unit)));
    if (card.effect === 'support') {
      const cost = card.amount;
      bits.push(actButton('support', 'scene/ui/lamp-durability-teal.webp', `复活厚壳 · ${cost}电`, `花 ${cost} 点电，把自己墓地里的厚壳叫回最左边，满耐久。小印留在场上。`, supportBlock(unit)));
    }
    if (card.effect === 'knob') {
      const cost = card.amount;
      bits.push(actButton('arm-knob', 'scene/ui/lamp-power-on-amber-128.webp', `攻击+1 · ${cost}电`, `花 ${cost} 点电，让一台己方单位本回合攻击 +1。可以点旋钮台自己。`, paidBlock(unit, cost, 'knob')));
    }
    if (card.upper_host) {
      const used = game.upper_links[game.seat].some(item => item.source === unit.iid);
      const block = used ? { code: 'already_used_ability', why: '本回合用过' } : paidBlock(unit, 1, '');
      bits.push(actButton('upper-link', 'scene/cards/art-hostlove-432x576.webp', '接通 · 1电', '花 1 点电，把这台上位机连到一台己方 ESP32 主控。本回合第一次接上时当前供电 +1。', block));
    }
    return `<div class="act-menu" role="menu">${bits.join('')}</div>`;
  }
  function aimMenu(seat, unit) {
    if (seat === game.seat || unit.link || game.winner != null) return '';
    const held = selectedCard();
    if (held && held.effect === 'seize') {
      const block = game.supply[game.seat] < held.cost ? { code: 'not_enough_supply', why: '没电' } : null;
      return `<div class="act-menu aim">${actButton('select-unit', 'scene/cards/art-seize-432x576.webp', `夺舍 · ${held.cost}电`, '夺走这台敌方主控，排到我方最右。耐久和配件留下，本回合不能攻击。', block, ` data-seat="${seat}" data-iid="${esc(unit.iid)}"`)}</div>`;
    }
    if (!ui.attacker) return '';
    const attacker = game.find(ui.attacker)[2];
    const name = cards[unit.card_id].name;
    return `<div class="act-menu aim">${actButton('select-unit', 'scene/ui/lamp-attack-amber.webp', `打${name}`, '和这台对打，双方同时结算。护卫没被忽略时只能打护卫。', attackBlock(attacker), ` data-seat="${seat}" data-iid="${esc(unit.iid)}"`)}</div>`;
  }
  function unitHtml(seat, slot, unit) {
    if (!unit) return '';
    const card = cards[unit.card_id];
    const selected = ui.attacker === unit.iid;
    const hot = ui.attacker && seat !== game.seat;
    const linked = game.upper_links[seat].some(item => item.source === unit.iid || item.target === unit.iid);
    const ribbons = [
      unit.sick ? '新入场' : '',
      unit.ability_lock ? '本回合锁定' : '',
      unit.attacked ? '已攻击' : '',
      C.hasGuard(cards, unit) ? '护卫' : '',
      linked ? '上位' : '',
      unit.attachments.map(id => cards[id].name).join(' ')
    ].filter(Boolean).join(' · ');
    const arrive = !(ui.seen && ui.seen.has(unit.iid));
    const lunge = ui.fx && ui.fx.attacker === unit.iid;
    const hit = ui.fx && ui.fx.target === unit.iid;
    const canAttack = seat === game.seat && game.phase === 'main' && game.winner == null && !unit.sick && !unit.attacked;
    if (unit.link) {
      return `<button type="button" class="link-mark${arrive ? ' arrive' : ''}" data-action="select-unit" data-link="1" data-board-seat="${seat}" data-slot="${slot}" data-seat="${seat}" data-iid="${esc(unit.iid)}" data-card="${esc(unit.card_id)}" data-host="${esc(unit.host_iid)}"><span class="mname">链</span><span class="ribbon">${esc(card.name)}</span></button>`;
    }
    return `<button type="button" class="minion${selected ? ' selected' : ''}${hot ? ' hot' : ''}${canAttack ? ' can-attack' : ''}${arrive ? ' arrive' : ''}${lunge ? ' lunge' : ''}${hit ? ' hit' : ''}${C.hasGuard(cards, unit) ? ' guard' : ''}${unit.sick ? ' sick' : ''}${unit.attacked ? ' spent' : ''}" ${sceneAttr('unit_frame')} data-action="select-unit" data-board-seat="${seat}" data-slot="${slot}" data-seat="${seat}" data-iid="${esc(unit.iid)}" data-card="${esc(unit.card_id)}" data-sick="${unit.sick}" data-guard="${C.hasGuard(cards, unit)}" data-attack="${C.attackOf(cards, unit)}" data-durability="${unit.durability}">
      <span class="portrait">${picture(card, 'board')}</span>
      <span class="atk">${C.attackOf(cards, unit)}</span>
      <span class="hp">${unit.durability}</span>
      <span class="mname">${esc(card.name)}</span>
      ${ribbons ? `<span class="ribbon">${esc(ribbons)}</span>` : ''}
    </button>`;
  }
  function insertMark(index) {
    const label = index === 0 ? '最左' : '插入';
    const on = ui.chainIndex === index ? ' on' : '';
    return `<button type="button" class="insert${on}" data-action="insert" data-index="${index}">${label}</button>`;
  }
  function formationLine(seat) {
    const state = game.formationState(seat);
    const head = state.leader ? `领队${state.percent}%` : '无领队';
    const extra = [];
    if (game.upper_links[seat].length) extra.push('上位+1');
    if (game.aiflow_armed[seat]) extra.push('说人话');
    return [head].concat(extra).join(' ');
  }
  function strikeHint() {
    if (!ui.attacker) return '';
    const unit = game.find(ui.attacker)[2];
    const damage = game.strikePreview(game.seat, C.attackOf(cards, unit));
    return `<p class="strike" data-strike="${damage}">这一击 ${damage}</p>`;
  }
  function lane(seat) {
    const row = game.boards[seat];
    const card = selectedCard();
    const inserting = seat === game.seat && card && ((card.kind === 'main' && directPlay(card)) || card.chain_piece);
    const bits = [];
    row.forEach((unit, slot) => {
      if (inserting) bits.push(insertMark(slot));
      const html = unitHtml(seat, slot, unit);
      if (unit.link) {
        bits.push(html);
        return;
      }
      const mine = seat === game.seat && ui.attacker === unit.iid;
      bits.push(`<div class="unit-wrap">${html}${mine ? unitMenu(unit) : ''}${aimMenu(seat, unit)}</div>`);
    });
    if (inserting) bits.push(insertMark(row.length));
    return bits.join('');
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
    const dropped = ui.fx && ui.fx.bases && ui.fx.bases[seat] > game.bases[seat];
    const delta = dropped ? ui.fx.bases[seat] - game.bases[seat] : 0;
    const portrait = seat === 0 ? 'scene/ui/core-first-warm-inner-256.webp' : 'scene/ui/core-second-cold-inner-256.webp';
    return `<div class="core-wrap${active ? ' active' : ''}${hot ? ' hot' : ''}">
      <button type="button" class="base-btn core${dropped ? ' flash' : ''}" ${sceneAttr('core_frame')} data-action="hit-base" data-seat="${seat}" aria-label="${seatName(seat)}核心">
        <img class="core-portrait" src="${portrait}" alt="">
        <span class="core-name">${seatName(seat)}核心</span>
        <span class="hp" data-seat="${seat}" data-stat="base">${game.bases[seat]}</span>
        ${delta ? `<span class="floater">-${delta}</span>` : ''}
      </button>
      ${supply(seat)}
    </div>`;
  }
  function supply(seat) {
    const held = selectedCard();
    const short = held && seat === game.seat && held.cost > game.supply[seat];
    return `<div class="battery${short ? ' short' : ''}">${mana(seat)}<div class="supply-read">供电 <b data-seat="${seat}" data-stat="supply">${game.supply[seat]}</b>/<b data-seat="${seat}" data-stat="max-supply">${game.max_supply[seat]}</b></div></div>`;
  }
  function stack(seat) {
    return `<div class="pile">
      <div class="pile-name">${seatName(seat)}</div>
      <div class="deck-stack" title="${seatName(seat)}牌库"><b data-seat="${seat}" data-stat="deck">${game.decks[seat].length}</b><span>牌库</span></div>
      <div class="grave-stack" title="${seatName(seat)}墓地"><b>${game.graves[seat].length}</b><span>墓地</span></div>
      <div class="silk">疲劳 <b data-seat="${seat}" data-stat="fatigue">${game.fatigue[seat]}</b></div>
      <div class="silk">手牌 <b data-seat="${seat}" data-stat="hand">${game.hands[seat].length}</b></div>
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
    if (card && directPlay(card)) {
      const label = card.effect === 'play_damage' ? '直接焊装' : card.kind === 'spell' ? '打出' : '焊装';
      bits.push(`<button type="button" class="pad live" data-action="play">${label}</button>`);
    }
    if (card && card.effect === 'mend' && ui.target) {
      bits.push('<button type="button" class="pad live" data-action="mend-heal">修复耐久</button>');
      bits.push('<button type="button" class="pad live" data-action="mend-temp">攻击 +1</button>');
    }
    bits.push(promoteButtons());
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
    const filters = [['all', '全部'], ['main', '主控'], ['attachment', '配件'], ['chain', '可升星'], ['baseline', '基线无图'], ['service', '软件服务']];
    const baselineOnly = new Set(content.cards.map(card => card.template_id).filter(id => !roster.cards.some(card => card.template_id === id)));
    const list = Object.keys(cards).filter(id => id !== tokenId).map(id => cards[id]).filter(card => {
      if (ui.poolFilter === 'main') return card.kind === 'main';
      if (ui.poolFilter === 'attachment') return card.kind === 'attachment';
      if (ui.poolFilter === 'chain') return card.growth_kind === 'chain';
      if (ui.poolFilter === 'baseline') return baselineOnly.has(card.template_id);
      if (ui.poolFilter === 'service') return card.record_kind === 'game_service' || card.record_kind === 'design_only_host';
      return true;
    }).sort((a, b) => a.name.localeCompare(b.name, 'zh'));
    $('#app').innerHTML = `<header class="top">
      <div class="brand"><b>PULSE</b><span>扩展组牌</span></div>
      <nav class="pulse-nav" data-shared-entry="clash-home"><a href="../../index.html">大厅</a><a href="../../wiki/index.html">图鉴</a><a href="../index.html">旧版点数</a></nav>
      <button type="button" class="btn" data-action="scenario" data-scenario="lesson">返回教学局</button>
    </header>
    <main class="builder" data-scenario="builder" data-ruleset="${esc(content.ruleset_id)}">
      <p class="balance">96 张硬件图册，加 7 张没有对应图的基线牌，再加没有 SKU、没有图的软件服务和设计牌树莓台。每副 8 到 12 张，至少 4 张主控，同名 1 张。星级只认卡上的 star，不认版本号。数值待试玩。</p>
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
        const label = card.record_kind === 'game_service' ? '服务' : card.record_kind === 'design_only_host' ? '设计' : kindName(card.kind);
        return `<button type="button" class="${picked ? 'picked' : ''}" data-action="toggle-pool" data-card="${esc(card.template_id)}">${esc(card.name)} · ${card.cost}费 · ${label}${star ? ' · ' + star + '星' : ''}${card.growth_kind === 'chain' ? ' · 可升星' : ''}<br><span class="hint">${esc(card.game_description || card.role_note || '基线牌，没有 96 图')}</span></button>`;
      }).join('')}</div>
    </main>`;
    document.body.dataset.ready = '1';
  }

  function captureGhosts() {
    if (ui.fresh || !game) return [];
    const alive = new Set(game.boards.flat().filter(Boolean).map(unit => unit.iid));
    return [...document.querySelectorAll('.arena .minion[data-iid], .arena .link-mark[data-iid]')].filter(node => !alive.has(node.dataset.iid)).map(node => {
      const rect = node.getBoundingClientRect();
      return { html: node.outerHTML, left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    });
  }

  function mountGhosts(ghosts) {
    const arena = document.querySelector('.arena');
    if (!arena) return;
    ghosts.forEach(ghost => {
      const holder = document.createElement('div');
      holder.innerHTML = ghost.html;
      const card = holder.firstElementChild;
      if (!card) return;
      card.classList.add('dying');
      card.removeAttribute('data-action');
      card.removeAttribute('data-board-seat');
      card.removeAttribute('data-card');
      card.style.position = 'fixed';
      card.style.left = ghost.left + 'px';
      card.style.top = ghost.top + 'px';
      card.style.width = ghost.width + 'px';
      card.style.height = ghost.height + 'px';
      card.style.margin = '0';
      arena.appendChild(card);
      setTimeout(() => card.remove(), 460);
    });
  }

  function render() {
    if (ui.scenario === 'builder') return renderBuilder();
    const ghosts = captureGhosts();
    const over = game.winner == null ? '' : game.winner === 'draw' ? '平局' : `${seatName(game.winner)}获胜`;
    const active = game.seat;
    const other = 1 - active;
    const turnText = over || seatName(active) + '的回合';
    const canEnd = game.winner == null && game.phase === 'main';
    const scenarios = [['lesson', '教学局'], ['support-present', '小印已在场'], ['support-deploy', '先打出小印'], ['support-again', '厚壳再死'], ['promote-stamp', '小印升星'], ['grow', '超过五台'], ['crowd', '两边七台'], ['synergy', '协同与夺舍'], ['builder', '扩展组牌']];
    $('#app').innerHTML = `<div class="table-page">
    <button type="button" class="menu-toggle" data-action="toggle-menu" aria-expanded="${ui.menu ? 'true' : 'false'}">菜单</button>
    <div class="menu-pop"${ui.menu ? '' : ' hidden'}>
      <a class="pulse-brand" data-nav="lobby" href="../../index.html"><span class="pulse-mark">P</span><span class="pulse-name">PULSE</span></a>
      <nav class="pulse-nav" data-shared-entry="clash-home" aria-label="站点入口">
        <a data-nav="lobby" href="../../index.html">大厅</a>
        <a data-nav="clash" href="./index.html" aria-current="page">回合战</a>
        <a data-nav="wiki" href="../../wiki/index.html">图鉴</a>
        <a data-nav="legacy" href="../index.html">旧版点数</a>
      </nav>
      <button type="button" data-action="toggle-reveal" aria-pressed="${ui.reveal}">${ui.reveal ? '遮住对方手牌' : '教学明牌'}</button>
      <button type="button" data-action="restart">重新开局</button>
      <div class="scenario-row">${scenarios.map(([id, label]) => `<button type="button" data-action="scenario" data-scenario="${id}">${label}</button>`).join('')}</div>
    </div>
    ${ui.reveal ? '<div class="banner" id="reveal-banner">教学明牌 · 双方手牌都看得见 · 牌库仍只显示张数</div>' : '<div id="reveal-banner" hidden></div>'}
    <main class="arena table${ui.attacker ? ' aiming' : ''}${canDeploy() ? ' holding' : ''}" data-scene-status="${esc(scenebook.status || 'awaiting_generated_assets')}" data-scenario="${esc(ui.scenario)}" data-ruleset="${esc(content.ruleset_id)}" data-source-commit="${esc(C.SOURCE_COMMIT)}">
      <div class="scene-bg" ${sceneAttr('arena_background')}></div>
      <div class="opp-dock">${handHtml(other, false)}</div>
      ${(game.hands[1] || []).includes(tokenId) ? '<p class="compensation">后手补偿：多 1 张牌 + 借一格电</p>' : ''}
      <aside class="bays">${stack(other)}${stack(active)}</aside>
      <div class="core-slot foe">${core(other)}</div>
      <div class="slots foe">${lane(other)}</div>
      <div class="midline">
        <h3 id="turn-label" data-seat="${game.seat}">${esc(turnText)}</h3>
        <p class="formation" data-formation="${game.formationState(active).percent}">${esc(formationLine(active))}</p>
        ${game.units(active).some(unit => cards[unit.card_id].upper_host && !unit.link) ? `<button type="button" class="upper-btn${ui.linking ? ' on' : ''}" data-action="upper-link"><img src="scene/cards/art-hostlove-432x576.webp" alt="">接通 · 1电</button>` : ''}
        ${strikeHint()}
        <p id="coach">${esc(coach())}</p>
        <p id="last-error" data-code="${esc(ui.error ? ui.error.code : '')}">${ui.error ? esc(ui.error.message) : ''}</p>
      </div>
      <div class="slots mine">${lane(active)}</div>
      <div class="core-slot mine">${core(active)}</div>
      <section class="hand-dock" aria-label="当前手牌">${handHtml(active, true)}</section>
      <aside class="rail tools">
        <button type="button" class="end-turn${canEnd ? ' hot' : ' wait'}" ${sceneAttr('end_turn')} data-action="end-turn">结束回合</button>
        <div class="pads">${actions()}</div>
      </aside>
      <button type="button" class="log-toggle" data-action="toggle-log" aria-expanded="${ui.logOpen ? 'true' : 'false'}">记录</button>
      <aside class="log-panel"${ui.logOpen ? '' : ' hidden'}>
        <h3>对战记录</h3>
        <ol id="action-log" class="log">${ui.log.slice().reverse().map(item => `<li${item.code ? ` class="bad" data-error-code="${esc(item.code)}"` : ''}>${esc(item.text)}</li>`).join('') || '<li>还没有记录</li>'}</ol>
      </aside>
    </main>
    </div>`;
    mountGhosts(ghosts);
    ui.seen = new Set(game.boards.flat().filter(Boolean).map(unit => unit.iid));
    ui.fx = null;
    ui.showBanner = false;
    ui.fresh = false;
    document.body.dataset.ready = '1';
    document.body.dataset.ruleset = content.ruleset_id;
  }

  function play(target, mode, index) {
    const card = selectedCard();
    if (!card) return note(new C.ClashError('请先选择手牌', 'not_in_hand'));
    const seat = game.seat;
    const bases = game.bases.slice();
    try {
      game.play(seat, card.template_id, target == null ? null : target, mode || null, index == null ? null : index);
    } catch (error) {
      return note(error);
    }
    ui.fx = { bases };
    let text = `${seatName(seat)}打出${card.name}，费用 ${card.cost}。`;
    if (card.effect === 'supply') text += `当前供电 ${game.supply[seat]}，上限仍是 ${game.max_supply[seat]}。`;
    push(text);
    clearChoice();
    render();
  }

  function attack(target) {
    if (!ui.attacker) return note(new C.ClashError('请先点一台己方单位', 'bad_target'));
    const attacker = game.find(ui.attacker)[2];
    const attackerId = ui.attacker;
    const bases = game.bases.slice();
    try {
      game.attack(game.seat, ui.attacker, target);
    } catch (error) {
      return note(error);
    }
    ui.fx = { attacker: attackerId, target, bases };
    const name = cards[attacker.card_id].name;
    push(target === 'base' ? `${name}攻击了对方基地。` : `${name}与对方单位同时结算伤害。`);
    clearChoice();
    render();
  }

  function onUnit(el) {
    const iid = el.dataset.iid;
    const seat = Number(el.dataset.seat);
    const unit = game.find(iid)[2];
    if (unit.link) return note(new C.ClashError('链节标记不能被选中', 'bad_target'));
    const card = selectedCard();
    if (ui.linking) {
      if (seat !== game.seat) return note(new C.ClashError('来自上位的爱只能连己方单位', 'bad_target'));
      if (!ui.linkSource) {
        if (!cards[unit.card_id].upper_host) return note(new C.ClashError('来自上位的爱只能由己方上位机发动', 'bad_target'));
        ui.linkSource = iid;
        ui.error = null;
        return render();
      }
      try { game.upperLink(game.seat, ui.linkSource, iid); }
      catch (error) { return note(error); }
      push(`来自上位的爱接上。当前供电 ${game.supply[game.seat]}，有效上限 ${game.effectiveMax(game.seat)}。`);
      clearChoice();
      return render();
    }
    if (ui.knob) {
      try { game.knob(game.seat, pack.capabilities.bindings.knob.source, iid); }
      catch (error) { return note(error); }
      push(`旋钮台强化了${cards[game.find(iid)[2].card_id].name}，本回合攻击 +1。`);
      clearChoice();
      return render();
    }
    if (card && card.effect === 'seize') {
      if (seat === game.seat) return note(new C.ClashError('夺舍只能指定敌方场上的主控', 'bad_target'));
      return play(iid);
    }
    if (card && card.kind === 'attachment') {
      if (seat !== game.seat) return note(new C.ClashError('配件只能装在己方主控上', 'bad_target'));
      return play(iid, null, card.chain_piece ? ui.chainIndex : null);
    }
    if (card && card.effect === 'play_damage') {
      if (seat === game.seat) return note(new C.ClashError('入场伤害只能指定敌方单位', 'bad_target'));
      return play(iid);
    }
    if (card && card.effect === 'damage') return play(iid);
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
    ui.showBanner = true;
    render();
  }

  function act(action, el, event) {
    if (el && el.dataset && el.dataset.block) {
      const why = el.querySelector('.act-why');
      return note(new C.ClashError(why ? why.textContent : '现在不能这么做', el.dataset.block));
    }
    if (action === 'toggle-menu') { ui.menu = !ui.menu; return render(); }
    if (action === 'toggle-log') { ui.logOpen = !ui.logOpen; return render(); }
    if (action === 'toggle-reveal') { ui.reveal = !ui.reveal; return render(); }
    if (action === 'toggle-catalog') { ui.catalog = !ui.catalog; return render(); }
    if (action === 'restart' || action === 'scenario') return begin(action === 'restart' ? ui.scenario : el.dataset.scenario);
    if (action === 'select-hand') {
      const index = Number(el.dataset.handIndex);
      if (event.detail >= 2) return deployFromHand(index);
      ui.handIndex = index;
      ui.attacker = null;
      ui.target = null;
      ui.knob = false;
      ui.linking = false;
      ui.linkSource = null;
      ui.chainIndex = null;
      ui.aiming = wantsTarget(cards[el.dataset.card]);
      ui.error = null;
      return paintSelection();
    }
    if (action === 'select-unit') return onUnit(el);
    if (action === 'play') return play(null);
    if (action === 'insert') {
      const held = selectedCard();
      if (held && held.chain_piece) {
        ui.chainIndex = Number(el.dataset.index);
        ui.error = null;
        return render();
      }
      return play(null, null, Number(el.dataset.index));
    }
    if (action === 'upper-link') {
      ui.linking = !ui.linking;
      ui.linkSource = null;
      ui.handIndex = null;
      ui.attacker = null;
      ui.knob = false;
      ui.error = null;
      return render();
    }
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
      push('小印支援：厚壳插到最左，原来的单位右移。厚壳满耐久、有护卫，本回合不能攻击。小印留在场上。');
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
    act(el.dataset.action, el, event);
  });
  document.addEventListener('dblclick', event => {
    const el = event.target.closest('[data-action="select-hand"]');
    if (!el || !$('#app').contains(el)) return;
    event.preventDefault();
    deployFromHand(Number(el.dataset.handIndex));
  });

  begin('lesson');
})(globalThis);
