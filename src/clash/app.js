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
  const batteryId = 'bei_yong_dian_chi';
  const cards = Object.create(null);
  Object.keys(pack.cards).forEach(id => { cards[id] = pack.cards[id]; });
  roster.cards.forEach(card => { cards[card.template_id] = card; });
  const services = root.PCGClashServices || { cards: [], design_hosts: [] };
  services.cards.concat(services.design_hosts || []).forEach(card => { cards[card.template_id] = card; });
  cards[batteryId] = {
    template_id: batteryId, name: '备用电池', kind: 'spell', cost: 0, attack: 0, durability: 0,
    attack_bonus: 0, grants_guard: false, bypass_guard: false, guard: false, effect: 'supply', amount: 1
  };
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
  let ui = blankUi('versus');
  ui.mode = 'ai';
  let aiTimer = 0;

  function blankUi(scenario) {
    return {
      scenario, reveal: false, catalog: false, handIndex: null, attacker: null, target: null, knob: false,
      aiming: false, linking: false, linkSource: null, chainIndex: null, menu: false, logOpen: false,
      showBanner: true, fresh: true, seen: new Set(), fx: null, error: null, log: [],
      handoff: false, seed: 0, opening: scenario === 'sim' ? 'sim' : 'lesson', simPool: 0, simExcluded: '', simNotes: '',
      nfcPanel: false, nfcRid: '', nfcStatus: '', confirmEnd: false, muteAttackRemind: false, idleIds: []
    };
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

  function stopAi() {
    ui.aiBusy = false;
    if (aiTimer) clearTimeout(aiTimer);
    aiTimer = 0;
  }

  function viewerBottom() {
    return 0;
  }

  function sideLabel(seat) {
    if (ui.mode === 'ai') return seat === 0 ? '你' : '对方';
    return seat === 0 ? '座位 0' : '座位 1';
  }

  function canAct() {
    if (!game || game.winner != null || game.phase !== 'main') return false;
    if (ui.handoff || ui.aiBusy || ui.animating) return false;
    if (ui.mode === 'ai' && game.seat !== 0) return false;
    return true;
  }

  function simPool() {
    return C.simCatalog(roster.cards, Object.keys(artbook));
  }

  function freshSeed() {
    const buf = new Uint32Array(1);
    if (root.crypto && root.crypto.getRandomValues) root.crypto.getRandomValues(buf);
    return (buf[0] || ((Date.now() ^ (Math.random() * 0x100000000)) >>> 0)) || 1;
  }

  function begin(scenario, seed) {
    stopAi();
    const keepReveal = ui.reveal;
    ui = blankUi(scenario);
    ui.reveal = keepReveal;
    ui.mode = scenario === 'versus' || scenario === 'sim' ? 'ai' : 'hotseat';
    ui.opening = scenario === 'sim' ? 'sim' : (scenario === 'versus' || scenario === 'lesson' ? 'lesson' : scenario);
    ui.aiBusy = false;
    ui.handoff = false;
    if (scenario === 'lesson' || scenario === 'versus' || scenario === 'sim') {
      let first = content.decks.first.slice();
      let second = content.decks.second.slice();
      if (scenario === 'sim') {
        const catalog = simPool();
        const built = C.buildSimDecks(catalog.included, seed == null ? freshSeed() : ((seed >>> 0) || 1));
        ui.seed = built.seed;
        ui.simPool = catalog.included.length;
        ui.simExcluded = catalog.excluded.map(item => item.id + ':' + item.reason).join(',');
        ui.simNotes = built.notes.filter(Boolean).join('，');
        ui.built = built.decks;
        first = built.decks[0].slice();
        second = built.decks[1].slice();
      } else {
        ui.seed = 0;
        ui.built = null;
      }
      const matchRules = scenario === 'sim' ? Object.assign({}, rules, { handLimit: 10 }) : rules;
      const matchToken = scenario === 'sim' ? batteryId : tokenId;
      game = new C.Game(cards, first, second, matchRules, matchToken, pack.capabilities);
      game.start_turn();
      if (scenario === 'sim') {
        push(`模拟战。种子 ${ui.seed}。每副 30 张，可入池 ${ui.simPool} 张。先手 3 张，后手 4 张，另发备用电池。手牌上限 10。${ui.simNotes ? ' ' + ui.simNotes : ''}`);
      } else if (scenario === 'versus') {
        push('固定教学。你在下方，对方在上方。结束回合后对方自动行动。这不是模拟战。');
      } else {
        push('本地双人。两人轮流，共用这一块屏幕。座位 0 在下方，座位 1 在上方。换人前要确认。');
      }
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
    if (!canAct()) return note(new C.ClashError(C.reasonText('not_your_turn'), 'not_your_turn'));
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
    const bottom = viewerBottom();
    const mine = document.querySelector('.slots.mine');
    const foe = document.querySelector('.slots.foe');
    if (mine) mine.innerHTML = lane(bottom);
    if (foe) foe.innerHTML = lane(1 - bottom);
    applyMarks(null);
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
    if (card && (card.template_id === tokenId || card.template_id === batteryId)) return `<img class="coin-lamp" src="scene/ui/lamp-power-on-amber-128.webp" alt="" draggable="false">`;
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
    const show = ui.reveal || (ui.mode === 'ai' ? seat === 0 : seat === game.seat);
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
      const coin = id === tokenId || id === batteryId ? ' coin' : '';
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
  function blockFrom(result) {
    if (!result || result.ok) return null;
    return { code: result.code, why: C.reasonText(result.code) };
  }
  function attackBlock(unit, target) {
    if (!unit) return { code: 'bad_target', why: C.reasonText('bad_target') };
    return blockFrom(C.probe(game, () => game.attack(game.seat, unit.iid, target)));
  }
  function supportBlock(unit) {
    if (!unit) return { code: 'no_stamp_on_board', why: C.reasonText('no_stamp_on_board') };
    return blockFrom(C.probe(game, () => game.support(game.seat)));
  }
  function strikeParts(seat, unit) {
    const printed = C.attackOf(cards, unit);
    if (printed <= 0) return { damage: 0, printed, boosted: false, title: '攻击栏为 0，这次伤害是 0' };
    const bits = [`攻击栏 ${printed}`];
    if (game.upper_links[seat].length) bits.push('来自上位的爱 +1');
    if (game.aiflow_armed[seat]) bits.push('说人话 +2');
    const form = game.formationState(seat);
    if (form.percent) bits.push(form.chain_run ? `领队 ${form.percent}%（连续链节 ${form.chain_run} 段）` : `领队 ${form.percent}%`);
    const damage = game.strikePreview(seat, printed);
    if (damage !== printed) bits.push('向上取整');
    return { damage, printed, boosted: damage !== printed, title: `${bits.join('，')}，伤害 ${damage}` };
  }
  function unitMenu(unit) {
    const card = cards[unit.card_id];
    const blow = strikeParts(game.seat, unit);
    const bits = [];
    bits.push(actButton('attack-base', 'scene/ui/lamp-attack-amber.webp', `打基地 · 造成 ${blow.damage}`, `打对方基地，造成 ${blow.damage}，没有反击。${blow.title}`, attackBlock(unit, 'base')));
    if (card.effect === 'support') {
      const cost = card.amount;
      bits.push(actButton('support', 'scene/ui/lamp-durability-teal.webp', `复活厚壳 · ${cost}电`, `花 ${cost} 点电，把自己墓地里的厚壳叫回最左边，满耐久。小印留在场上。`, supportBlock(unit)));
    }
    if (card.effect === 'knob') {
      const cost = card.amount;
      const block = blockFrom(C.probe(game, () => game.knob(game.seat, unit.iid, unit.iid)));
      bits.push(actButton('arm-knob', 'scene/ui/lamp-power-on-amber-128.webp', `攻击+1 · ${cost}电`, `花 ${cost} 点电，让一台己方单位本回合攻击 +1。可以点旋钮台自己。`, block));
    }
    if (card.upper_host) {
      const block = blockFrom(C.probe(game, () => {
        const ally = game.units(game.seat).find(item => item.iid !== unit.iid && game.isEsp32Main(item.card_id));
        if (!ally) throw new C.ClashError('没有合法目标', 'bad_target');
        game.upperLink(game.seat, unit.iid, ally.iid);
      }));
      bits.push(actButton('upper-link', 'scene/cards/art-hostlove-432x576.webp', '接通 · 1电', '花 1 点电，把这台上位机连到一台己方 ESP32 主控。本回合第一次接上时当前供电 +1。', block));
    }
    return `<div class="act-menu" role="menu">${bits.join('')}</div>`;
  }
  function skillBar() {
    if (!ui.attacker || !game) return '';
    let found;
    try { found = game.find(ui.attacker); } catch (error) { return ''; }
    const unit = found[2];
    if (!unit || found[0] !== game.seat || unit.link) return '';
    const side = game.seat === 0 ? 'bottom' : 'top';
    return `<div class="skill-bar ${side}" data-skill-for="${esc(unit.card_id)}">${unitMenu(unit)}</div>`;
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
    const hot = false;
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
    const blow = strikeParts(seat, unit);
    const nag = !!(ui.idleIds && ui.idleIds.indexOf(unit.iid) >= 0);
    if (unit.link) {
      return `<button type="button" class="link-mark${arrive ? ' arrive' : ''}" data-action="select-unit" data-link="1" data-board-seat="${seat}" data-slot="${slot}" data-seat="${seat}" data-iid="${esc(unit.iid)}" data-card="${esc(unit.card_id)}" data-host="${esc(unit.host_iid)}"><span class="mname">链</span><span class="ribbon">${esc(card.name)}</span></button>`;
    }
    return `<button type="button" class="minion${selected ? ' selected' : ''}${hot ? ' hot' : ''}${canAttack ? ' can-attack' : ''}${arrive ? ' arrive' : ''}${lunge ? ' lunge' : ''}${hit ? ' hit' : ''}${nag ? ' nag' : ''}${C.hasGuard(cards, unit) ? ' guard' : ''}${unit.sick ? ' sick' : ''}${unit.attacked ? ' spent' : ''}" ${sceneAttr('unit_frame')} data-action="select-unit" data-board-seat="${seat}" data-slot="${slot}" data-seat="${seat}" data-iid="${esc(unit.iid)}" data-card="${esc(unit.card_id)}" data-sick="${unit.sick}" data-attacked="${unit.attacked}" data-guard="${C.hasGuard(cards, unit)}" data-attack="${blow.printed}" data-strike="${blow.damage}" data-nag="${nag ? '1' : '0'}" data-durability="${unit.durability}">
      <span class="portrait">${picture(card, 'board')}</span>
      <span class="atk${blow.boosted ? ' boosted' : ''}" title="${esc(blow.title)}">${blow.damage}</span>
      ${blow.boosted ? `<span class="atk-src">${esc(blow.title)}</span>` : ''}
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
    let unit;
    try { unit = game.find(ui.attacker)[2]; } catch (error) { return ''; }
    const blow = strikeParts(game.seat, unit);
    return `<p class="strike" data-strike="${blow.damage}">这一击造成 ${blow.damage}${blow.boosted ? '。' + blow.title : ''}</p>`;
  }
  function idleAttackers() {
    if (!game || game.phase !== 'main' || game.winner != null) return [];
    const seat = game.seat;
    return game.units(seat).filter(unit => {
      if (unit.link || unit.sick || unit.attacked) return false;
      if (C.probe(game, () => game.attack(seat, unit.iid, 'base')).ok) return true;
      return game.units(1 - seat).some(foe => C.probe(game, () => game.attack(seat, unit.iid, foe.iid)).ok);
    });
  }
  function endPrompt() {
    const count = (ui.idleIds || []).length;
    return `<div class="end-confirm" data-end-confirm="1"><p>还有 ${count} 个单位没攻击，确定结束？</p><div class="end-actions"><button type="button" data-action="end-turn">结束回合</button><button type="button" data-action="cancel-end">继续</button><button type="button" data-action="mute-end">本局不再提醒</button></div></div>`;
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
      bits.push(`<div class="unit-wrap" data-wrap="${esc(unit.iid)}">${html}</div>`);
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
        <span class="core-name">${sideLabel(seat)}</span>
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
      setTimeout(() => card.remove(), 720);
    });
  }

  const Nfc = root.PCGClashNfc;
  const byRid = Object.create(null);
  roster.cards.forEach(card => { byRid[card.rid] = card; });
  function lookupRid(rid) { return byRid[rid] || null; }
  const nfcSession = Nfc.createTapSession({
    env: {
      ua: navigator.userAgent,
      secure: typeof window !== 'undefined' && window.isSecureContext,
      NDEFReader: typeof NDEFReader === 'function' ? NDEFReader : null
    },
    lookup: lookupRid,
    onStatus(text) {
      ui.nfcStatus = text;
      if (document.body.dataset.ready === '1') render();
    },
    onReady(found) { playFromNfc(found); }
  });

  function playFromNfc(found) {
    if (ui.nfcPanel) return;
    const card = cards[found.templateId];
    const decision = Nfc.decideTap({
      canAct: canAct(),
      hand: game && game.hands[game.seat],
      needsTarget: !(card && directPlay(card))
    }, found);
    if (decision.action === 'refuse') return note(new C.ClashError(decision.text, decision.code));
    if (decision.action !== 'play' && decision.action !== 'aim') return render();
    ui.handIndex = game.hands[game.seat].indexOf(found.templateId);
    ui.attacker = null;
    ui.knob = false;
    ui.linking = false;
    ui.linkSource = null;
    blockDouble = true;
    swallowUntil = Date.now() + 400;
    if (decision.action === 'aim') {
      ui.aiming = true;
      return render();
    }
    play(null);
  }

  function nfcControl() {
    const support = nfcSession.support;
    const label = support.enabled ? Nfc.TEXT.start : support.text;
    const init = support.enabled ? '<button type="button" class="nfc-init" data-action="nfc-init">初始化空白卡</button>' : '';
    const status = ui.nfcStatus ? `<p class="nfc-status">${esc(ui.nfcStatus)}</p>` : '';
    return `<button type="button" class="nfc-entry" data-action="nfc-start" data-nfc="${support.enabled ? 'on' : 'off'}"${support.enabled ? '' : ' disabled'}>${esc(label)}</button>${init}${status}`;
  }

  function nfcPanel() {
    if (!ui.nfcPanel || !nfcSession.support.enabled) return '';
    const options = roster.cards.map(card => `<option value="${esc(card.rid)}"${card.rid === ui.nfcRid ? ' selected' : ''}>${esc(card.name)}</option>`).join('');
    const card = lookupRid(ui.nfcRid);
    const detail = card
      ? `中文名 ${card.name} · 费用 ${card.cost} · 攻击 ${card.attack} · 耐久 ${card.durability} · 星级 ${card.star == null ? '无' : card.star}`
      : '先选一张图册牌';
    const canWrite = nfcSession.lastKind() === 'blank' && card;
    const canOverwrite = nfcSession.lastKind() === 'unknown' && card;
    return `<section class="nfc-panel" data-nfc-panel="1"><label>图册牌<select data-nfc-pick="1">${options}</select></label><p>${esc(detail)}</p><button type="button" data-action="nfc-write"${canWrite ? '' : ' disabled'}>写入这张卡</button><button type="button" data-action="nfc-overwrite"${canOverwrite ? '' : ' hidden'}>仍然覆写</button></section>`;
  }

  function render() {
    if (ui.scenario === 'builder') return renderBuilder();
    const ghosts = captureGhosts();
    const over = game.winner == null ? '' : game.winner === 'draw' ? '平局' : `${seatName(game.winner)}获胜`;
    const active = game.seat;
    const bottom = viewerBottom();
    const other = 1 - bottom;
    const turnText = over || (ui.mode === 'ai' ? (active === 0 ? '你的回合' : '对方的回合') : (active === 0 ? '座位 0 的回合' : '座位 1 的回合'));
    const modeNote = ui.opening === 'sim'
      ? `模拟战 · 种子 ${ui.seed} · 可入池 ${ui.simPool} 张。你在下方，对方在上方。`
      : ui.mode === 'ai'
        ? '固定教学：你在下方，对方在上方。结束回合后对方自动行动。这不是模拟战。'
        : '两人轮流，共用这一块屏幕。座位 0 在下方，座位 1 在上方。';
    const canEnd = canAct();
    ui.idleIds = ui.confirmEnd ? idleAttackers().map(unit => unit.iid) : [];
    const scenarios = [['versus', '固定教学'], ['sim', '模拟战'], ['lesson', '本地双人'], ['support-present', '小印已在场'], ['support-deploy', '先打出小印'], ['support-again', '厚壳再死'], ['promote-stamp', '小印升星'], ['grow', '超过五台'], ['crowd', '两边七台'], ['synergy', '协同与夺舍'], ['builder', '扩展组牌']];
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
    <main class="arena table${ui.attacker ? ' aiming' : ''}${canDeploy() ? ' holding' : ''}${ui.aiBusy ? ' ai-run' : ''}" data-scene-status="${esc(scenebook.status || 'awaiting_generated_assets')}" data-scenario="${esc(ui.scenario)}" data-ruleset="${esc(content.ruleset_id)}" data-source-commit="${esc(C.SOURCE_COMMIT)}" data-mode="${ui.mode}" data-opening="${esc(ui.opening)}" data-ai="${ui.aiBusy ? 'run' : 'idle'}" data-handoff="${ui.handoff ? '1' : '0'}" data-seed="${ui.seed || ''}" data-sim-pool="${ui.simPool || ''}" data-sim-excluded="${esc(ui.simExcluded || '')}" data-deck0="${esc(ui.built ? ui.built[0].join(',') : '')}" data-deck1="${esc(ui.built ? ui.built[1].join(',') : '')}">
      <div class="scene-bg" ${sceneAttr('arena_background')}></div>
      <div class="opp-dock">${handHtml(other, false)}</div>
      ${(game.hands[1] || []).includes(batteryId) ? '<p class="compensation">后手补偿：备用电池（0费，当前供电 +1）</p>' : (game.hands[1] || []).includes(tokenId) ? '<p class="compensation">后手补偿：多 1 张牌 + 借一格电</p>' : ''}
      <aside class="bays">${stack(other)}${stack(bottom)}</aside>
      <div class="mode-bar">
        <div class="mode-switch">
          <button type="button" data-action="mode" data-mode="versus" aria-pressed="${ui.mode === 'ai' && ui.opening === 'lesson' ? 'true' : 'false'}">固定教学</button>
          <button type="button" data-action="mode" data-mode="sim" aria-pressed="${ui.opening === 'sim' ? 'true' : 'false'}">模拟战</button>
          <button type="button" data-action="mode" data-mode="hotseat" aria-pressed="${ui.mode === 'hotseat' ? 'true' : 'false'}">本地双人</button>
          ${ui.opening === 'sim' ? `<button type="button" data-action="replay-seed">重放种子</button>` : ''}
        </div>
        <p class="mode-note">${esc(modeNote)}</p>
      </div>
      <div class="core-slot foe${ui.attacker && other !== game.seat ? ' aim-target' : ''}">${core(other)}</div>
      <div class="slots foe" style="--n:${Math.max(1, game.units(other).length)}">${lane(other)}</div>
      <div class="midline">
        <h3 id="turn-label" data-seat="${game.seat}">${esc(turnText)}</h3>
        <p class="formation" data-formation="${game.formationState(active).percent}">${esc(formationLine(active))}</p>
        ${strikeHint()}
        <p id="coach">${esc(coach())}</p>
        ${ui.notice ? `<p class="table-notice" data-notice="1">${esc(ui.notice)}</p>` : ''}
        <p id="last-error" data-code="${esc(ui.error ? ui.error.code : '')}">${ui.error ? esc(ui.error.message) : ''}</p>
      </div>
      ${ui.aiBusy ? '<p class="ai-banner">对方正在行动</p>' : ''}
      ${ui.handoff ? `<div class="handoff-mask" data-handoff="1"><div class="handoff-card"><p>轮到座位 ${game.seat}，请交给对方</p><p>两人轮流，共用这一块屏幕。确认之前不能替对方行动。</p><button type="button" data-action="handoff-confirm">交给座位 ${game.seat}</button></div></div>` : ''}
      <div class="slots mine" style="--n:${Math.max(1, game.units(bottom).length)}">${lane(bottom)}</div>
      <div class="core-slot mine${ui.attacker && bottom !== game.seat ? ' aim-target' : ''}">${core(bottom)}</div>
      ${skillBar()}
      <section class="hand-dock" aria-label="当前手牌">${handHtml(bottom, true)}</section>
      ${ui.confirmEnd ? endPrompt() : ''}
      <aside class="rail tools">
        <button type="button" class="end-turn${canEnd && !ui.aiBusy && (ui.mode !== 'ai' || game.seat === 0) ? ' hot' : ' wait'}" ${sceneAttr('end_turn')} data-action="end-turn">结束回合</button>
        <div class="pads">${actions()}</div>
      </aside>
      <div class="nfc-dock">${nfcControl()}${nfcPanel()}</div>
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
    applyMarks(null);
  }

  function play(target, mode, index) {
    if (ui.animating) return;
    if (!canAct()) return note(new C.ClashError(C.reasonText('not_your_turn'), 'not_your_turn'));
    const card = selectedCard();
    if (!card) return note(new C.ClashError('请先选择手牌', 'not_in_hand'));
    const commit = () => {
      const seat = game.seat;
      const bases = game.bases.slice();
      const logBefore = game.log.length;
      try {
        game.play(seat, card.template_id, target == null ? null : target, mode || null, index == null ? null : index);
      } catch (error) {
        return note(error);
      }
      ui.fx = { bases };
      let text = `${sideLabel(seat)}打出${card.name}，费用 ${card.cost}。`;
      if (card.effect === 'supply') text += `当前供电 ${game.supply[seat]}，上限仍是 ${game.max_supply[seat]}。`;
      if (card.effect === 'seize' && target != null) {
        const moved = game.find(target)[2];
        text += ` 夺舍：${cards[moved.card_id].name}改由${sideLabel(seat)}控制，移到${sideLabel(seat)}这一侧最右。`;
      }
      soakLog(logBefore);
      push(text);
      clearChoice();
      render();
    };
    if (target != null) {
      const from = document.querySelector('.playcard.selected') || document.querySelector('.slots.mine');
      const to = document.querySelector(`[data-iid="${target}"]`) || document.querySelector('.slots.foe');
      lockAnim(true);
      showBeam(card.name, from, to).then(() => {
        commit();
        lockAnim(false);
      });
      return;
    }
    commit();
  }

  function motion() {
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    return reduce
      ? { lift: 40, lunge: 50, back: 40, hold: 220, pause: 80, show: 120, die: 180 }
      : { lift: 200, lunge: 280, back: 180, hold: 600, pause: 700, show: 800, die: 420 };
  }

  function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

  function lockAnim(on) {
    ui.animating = on;
    document.body.dataset.animating = on ? '1' : '0';
  }

  function spawnFloater(el, text) {
    const rect = el && el.getBoundingClientRect ? el.getBoundingClientRect() : el;
    if (!rect || rect.left == null) return;
    const node = document.createElement('div');
    node.className = 'dmg-float';
    node.textContent = text;
    node.style.left = (rect.left + rect.width / 2) + 'px';
    node.style.top = (rect.top + 6) + 'px';
    document.body.appendChild(node);
    setTimeout(() => node.remove(), motion().hold + 180);
  }

  function unitHp(iid) {
    try { return game.find(iid)[2].durability; } catch (error) { return 0; }
  }

  function attackNames(attackerId, target) {
    const attacker = game.find(attackerId)[2];
    const targetName = target === 'base' ? '核心' : cards[game.find(target)[2].card_id].name;
    return { attackerName: cards[attacker.card_id].name, targetName };
  }

  async function presentAttack(seat, attackerId, target) {
    const preview = attackNames(attackerId, target);
    const beforeTarget = target === 'base' ? game.bases[1 - seat] : unitHp(target);
    const beforeAttacker = unitHp(attackerId);
    const timing = motion();
    const atkNode = document.querySelector(`[data-iid="${attackerId}"]`);
    const tgtNode = target === 'base'
      ? document.querySelector(`.core-slot.${seat === viewerBottom() ? 'foe' : 'mine'} .base-btn`)
      : document.querySelector(`[data-iid="${target}"]`);
    lockAnim(true);
    try {
      if (atkNode) atkNode.classList.add('combat-lift');
      await sleep(timing.lift);
      if (atkNode && tgtNode && timing.lunge > 80) {
        const from = atkNode.getBoundingClientRect();
        const to = tgtNode.getBoundingClientRect();
        const dx = (to.left + to.width / 2) - (from.left + from.width / 2);
        const dy = (to.top + to.height / 2) - (from.top + from.height / 2);
        atkNode.style.transition = `transform ${timing.lunge}ms ease-in`;
        atkNode.style.transform = `translate(${dx}px, ${dy}px) scale(1.08)`;
        await sleep(timing.lunge);
        if (tgtNode) tgtNode.classList.add('combat-hit');
        atkNode.style.transition = `transform ${timing.back}ms ease-out`;
        atkNode.style.transform = 'translate(0, 0) scale(1)';
        await sleep(timing.back);
      } else {
        if (tgtNode) tgtNode.classList.add('combat-hit');
        await sleep(timing.lunge);
      }
      const bases = game.bases.slice();
      try {
        game.attack(seat, attackerId, target);
      } catch (error) {
        note(error);
        throw error;
      }
      const deal = beforeTarget - (target === 'base' ? game.bases[1 - seat] : unitHp(target));
      const back = beforeAttacker - unitHp(attackerId);
      const targetPoint = tgtNode ? tgtNode.getBoundingClientRect() : null;
      const attackerPoint = atkNode ? atkNode.getBoundingClientRect() : null;
      ui.fx = { attacker: attackerId, target, bases };
      push(`${preview.attackerName} 攻击 ${preview.targetName}，造成 ${deal}`);
      if (back) push(`${preview.targetName} 攻击 ${preview.attackerName}，造成 ${back}`);
      clearChoice();
      render();
      spawnFloater(targetPoint, '-' + deal);
      if (back) spawnFloater(attackerPoint, '-' + back);
      await sleep(timing.hold);
    } finally {
      lockAnim(false);
    }
  }

  function attack(target) {
    if (ui.animating) return;
    if (!canAct()) return note(new C.ClashError(C.reasonText('not_your_turn'), 'not_your_turn'));
    if (!ui.attacker) return note(new C.ClashError('请先点一台己方单位', 'bad_target'));
    const attackerId = ui.attacker;
    const probe = C.probe(game, () => game.attack(game.seat, attackerId, target));
    if (!probe.ok) return note(new C.ClashError(probe.message, probe.code));
    presentAttack(game.seat, attackerId, target).catch(() => {});
  }

  async function showAiCard(card) {
    const node = document.createElement('div');
    node.className = 'ai-showcard';
    node.innerHTML = `<div>${esc(card.name)}</div><div>${card.cost}费</div>`;
    document.body.appendChild(node);
    await sleep(motion().show);
    node.remove();
  }

  async function showBeam(caption, fromEl, toEl) {
    const nodes = [];
    if (fromEl && toEl && fromEl.getBoundingClientRect && toEl.getBoundingClientRect) {
      const from = fromEl.getBoundingClientRect();
      const to = toEl.getBoundingClientRect();
      const x1 = from.left + from.width / 2;
      const y1 = from.top + from.height / 2;
      const x2 = to.left + to.width / 2;
      const y2 = to.top + to.height / 2;
      const beam = document.createElement('div');
      beam.className = 'fx-beam';
      beam.style.left = x1 + 'px';
      beam.style.top = y1 + 'px';
      beam.style.width = Math.hypot(x2 - x1, y2 - y1) + 'px';
      beam.style.transform = `rotate(${Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI}deg)`;
      document.body.appendChild(beam);
      nodes.push(beam);
    }
    const node = document.createElement('div');
    node.className = 'fx-caption';
    node.textContent = caption;
    document.body.appendChild(node);
    nodes.push(node);
    await sleep(motion().lunge);
    nodes.forEach(item => item.remove());
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

  function describeAi(action) {
    if (action.type === 'support') return '对方发动复活厚壳。';
    if (action.type === 'attack') return action.target === 'base' ? '对方攻击你的核心。' : '对方攻击你场上的单位。';
    return `对方打出${cards[action.card].name}。`;
  }

  function startAi() {
    stopAi();
    ui.aiBusy = true;
    ui.aiSteps = 0;
    const failed = new Set();
    push('对方正在行动。');
    render();
    const step = async () => {
      if (!ui.aiBusy || !game || ui.mode !== 'ai') return;
      if (game.winner != null || game.seat !== 1 || game.phase !== 'main' || ui.aiSteps >= 16) {
        if (game && game.winner == null && game.seat === 1 && game.phase === 'main') {
          try { C.finishTurn(game); } catch (error) { note(error); }
          push('对方结束回合。');
        }
        stopAi();
        render();
        return;
      }
      const action = C.planAi(C.aiView(game), failed);
      ui.aiSteps += 1;
      if (!action) {
        try { C.finishTurn(game); } catch (error) { note(error); }
        push('对方没有继续行动，结束回合。');
        stopAi();
        render();
        return;
      }
      try {
        if (action.type === 'attack') await presentAttack(1, action.iid, action.target);
        else {
          if (action.type === 'play') await showAiCard(cards[action.card]);
          else await showBeam(describeAi(action));
          C.applyAi(game, action);
          push(describeAi(action));
          render();
        }
      } catch (error) {
        failed.add(action.key);
        aiTimer = setTimeout(step, 160);
        return;
      }
      await sleep(motion().pause);
      if (ui.aiBusy) step();
    };
    aiTimer = setTimeout(step, motion().pause);
  }

  function soakLog(before) {
    const bits = [];
    game.log.slice(before).forEach(line => {
      const text = String(line);
      if (text.includes('手牌已满')) bits.push(text + '。这张牌展示后烧毁，没有触发出场。');
      if (text.includes('疲劳')) bits.push(text + '。疲劳打在自己的核心上。');
    });
    ui.notice = bits.join(' ');
  }

  function endTurn() {
    if (ui.aiBusy || ui.animating) return;
    if (ui.mode === 'ai' && game.seat !== 0) return;
    if (!ui.confirmEnd && !ui.muteAttackRemind && idleAttackers().length) {
      ui.confirmEnd = true;
      ui.error = null;
      render();
      return;
    }
    ui.confirmEnd = false;
    const logBefore = game.log.length;
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
    soakLog(logBefore);
    push(text);
    ui.showBanner = true;
    if (ui.mode === 'hotseat' && game.winner == null) ui.handoff = true;
    render();
    if (ui.mode === 'ai' && game.winner == null && game.seat === 1 && !ui.handoff) startAi();
  }

  function act(action, el, event) {
    if (ui.animating) return;
    if (el && el.dataset && el.dataset.block) {
      const why = el.querySelector('.act-why');
      return note(new C.ClashError(why ? why.textContent : C.reasonText(el.dataset.block), el.dataset.block));
    }
    const free = ['mode', 'toggle-menu', 'toggle-log', 'scenario', 'restart', 'handoff-confirm', 'replay-seed'];
    if ((ui.aiBusy || ui.handoff || (ui.mode === 'ai' && game && game.seat !== 0)) && !free.includes(action)) {
      return note(new C.ClashError(C.reasonText('not_your_turn'), 'not_your_turn'));
    }
    if (action === 'mute-end') {
      ui.muteAttackRemind = true;
      ui.confirmEnd = false;
      return endTurn();
    }
    if (action === 'cancel-end') {
      ui.confirmEnd = false;
      return render();
    }
    if (ui.confirmEnd && action !== 'end-turn') ui.confirmEnd = false;
    if (action === 'handoff-confirm') {
      ui.handoff = false;
      return render();
    }
    if (action === 'replay-seed') return begin('sim', ui.seed);
    if (action === 'nfc-start') {
      ui.nfcScanning = true;
      nfcSession.start();
      return;
    }
    if (action === 'nfc-init') {
      ui.nfcPanel = !ui.nfcPanel;
      return render();
    }
    if (action === 'nfc-write') {
      nfcSession.writeCard();
      ui.nfcStatus = nfcSession.status();
      return render();
    }
    if (action === 'nfc-overwrite') {
      nfcSession.overwrite();
      ui.nfcStatus = nfcSession.status();
      return render();
    }
    if (action === 'mode') {
      if (el.dataset.mode === 'hotseat') begin('lesson');
      else if (el.dataset.mode === 'sim') begin('sim');
      else begin('versus');
      return;
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
      const selected = ui.attacker ? game.find(ui.attacker)[2] : null;
      ui.linking = true;
      ui.linkSource = selected && cards[selected.card_id].upper_host ? selected.iid : null;
      ui.handIndex = null;
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

  let gesture = null;
  let swallowUntil = 0;
  let blockDouble = false;
  let inspectTimer = 0;
  let dragNodes = [];

  function clearDragNodes() {
    dragNodes.forEach(node => node.remove());
    dragNodes = [];
    document.body.classList.remove('hand-out');
    const arena = document.querySelector('.arena');
    if (arena) arena.classList.remove('dragging');
  }

  function markHost(key) {
    if (!key) return null;
    if (key.startsWith('unit:')) {
      const iid = key.slice(5);
      const node = document.querySelector(`[data-wrap="${iid}"]`) || document.querySelector(`[data-iid="${iid}"]`);
      return node;
    }
    if (key.startsWith('core:')) {
      const seat = key.slice(5);
      const button = document.querySelector(`[data-action="hit-base"][data-seat="${seat}"]`);
      return button ? button.closest('.core-wrap') : null;
    }
    if (key.startsWith('seam:')) return document.querySelector(`.insert[data-index="${key.slice(5)}"]`);
    if (key.startsWith('half:')) return document.querySelector(key.endsWith(String(viewerBottom())) ? '.slots.mine' : '.slots.foe');
    return null;
  }

  function clearMarkAttrs() {
    document.querySelectorAll('[data-mark]').forEach(node => node.removeAttribute('data-mark'));
    document.querySelectorAll('.reject-badge, .trade').forEach(node => node.remove());
  }

  function intentKind() {
    const card = selectedCard();
    if (card) {
      if (card.effect === 'seize') return 'seize';
      if (card.effect === 'damage' || card.effect === 'play_damage') return 'damage';
      if (card.effect === 'mend' || card.kind === 'attachment') return 'ally';
      if (card.kind === 'main' || card.kind === 'spell') return 'deploy';
    }
    if (ui.knob || (ui.linking && ui.linkSource)) return 'ally';
    if (ui.attacker) return 'attack';
    return '';
  }

  function shortReject(code, kind) {
    if (code === 'guard_blocks') return C.reasonText('guard_blocks');
    if (kind === 'seize') return '不符合夺舍';
    if (kind === 'attack' || kind === 'damage') return code === 'bad_target' ? '不是可选的敌方单位' : C.reasonText(code);
    if (kind === 'ally') return code === 'bad_target' ? '不是可选的友方单位' : C.reasonText(code);
    return C.reasonText(code);
  }

  function collectMarks() {
    const legal = new Set();
    let reason = { code: '', text: '' };
    if (!canAct()) return { legal, reason };
    const card = selectedCard();
    const seat = game.seat;
    if (card && game.supply[seat] < card.cost) {
      return { legal, reason: { code: 'not_enough_supply', text: C.reasonText('not_enough_supply') } };
    }
    const tryPlay = (target, mode, index) => C.probe(game, () => game.play(seat, card.template_id, target, mode, index));
    if (card && card.kind === 'main' && card.effect !== 'play_damage') {
      const count = game.boards[seat].length;
      for (let index = 0; index <= count; index += 1) {
        if (tryPlay(null, null, index).ok) legal.add('seam:' + index);
      }
      if (!legal.size) reason = { code: 'bad_target', text: C.reasonText('bad_target') };
      return { legal, reason };
    }
    if (card && card.kind === 'spell' && !wantsTarget(card)) {
      const result = tryPlay(null, null, null);
      if (result.ok) legal.add('half:' + seat);
      else reason = { code: result.code, text: C.reasonText(result.code) };
      return { legal, reason };
    }
    if (card && (card.effect === 'seize' || card.effect === 'damage' || card.effect === 'play_damage')) {
      game.units(1 - seat).forEach(unit => {
        if (tryPlay(unit.iid, null, null).ok) legal.add('unit:' + unit.iid);
      });
      if (card.kind === 'main') {
        const count = game.boards[seat].length;
        for (let index = 0; index <= count; index += 1) {
          if (tryPlay(null, null, index).ok) legal.add('seam:' + index);
        }
      }
      if (!legal.size) reason = { code: 'bad_target', text: C.reasonText('bad_target') };
      return { legal, reason };
    }
    if (card && card.effect === 'mend') {
      game.units(seat).forEach(unit => {
        if (tryPlay(unit.iid, 'heal', null).ok || tryPlay(unit.iid, 'temp', null).ok) legal.add('unit:' + unit.iid);
      });
      if (!legal.size) reason = { code: 'bad_target', text: C.reasonText('bad_target') };
      return { legal, reason };
    }
    if (card && card.kind === 'attachment') {
      let host = false;
      game.units(seat).forEach(unit => {
        const result = tryPlay(unit.iid, null, null);
        if (result.ok) {
          legal.add('unit:' + unit.iid);
          host = true;
        }
      });
      if (card.chain_piece && host) {
        const count = game.boards[seat].length;
        for (let index = 0; index <= count; index += 1) legal.add('seam:' + index);
      }
      if (!legal.size) reason = { code: 'bad_target', text: C.reasonText('bad_target') };
      return { legal, reason };
    }
    if (ui.knob) {
      const source = game.units(seat).find(unit => cards[unit.card_id].effect === 'knob');
      if (source) {
        game.units(seat).forEach(unit => {
          if (C.probe(game, () => game.knob(seat, source.iid, unit.iid)).ok) legal.add('unit:' + unit.iid);
        });
      }
      if (!legal.size) reason = { code: 'bad_target', text: C.reasonText('bad_target') };
      return { legal, reason };
    }
    if (ui.linking && ui.linkSource) {
      game.units(seat).forEach(unit => {
        if (C.probe(game, () => game.upperLink(seat, ui.linkSource, unit.iid)).ok) legal.add('unit:' + unit.iid);
      });
      if (!legal.size) reason = { code: 'bad_target', text: C.reasonText('bad_target') };
      return { legal, reason };
    }
    if (ui.attacker) {
      let blocked = null;
      game.units(1 - seat).forEach(unit => {
        const result = C.probe(game, () => game.attack(seat, ui.attacker, unit.iid));
        if (result.ok) legal.add('unit:' + unit.iid);
        else if (!blocked) blocked = result;
      });
      const base = C.probe(game, () => game.attack(seat, ui.attacker, 'base'));
      if (base.ok) legal.add('core:' + (1 - seat));
      else if (!blocked) blocked = base;
      if (!legal.size && blocked) reason = { code: blocked.code, text: C.reasonText(blocked.code) };
      return { legal, reason };
    }
    return { legal, reason };
  }

  function applyMarks(focusKey, bad) {
    if (!document.querySelector('.arena')) return;
    clearMarkAttrs();
    const marks = collectMarks();
    const arena = document.querySelector('.arena');
    arena.classList.toggle('marking', marks.legal.size > 0 || !!(bad && bad.key));
    marks.legal.forEach(key => {
      const node = markHost(key);
      if (!node) return;
      node.dataset.mark = key === focusKey ? 'hot' : 'legal';
      if (!ui.attacker || (!key.startsWith('unit:') && !key.startsWith('core:'))) return;
      let attacker;
      try { attacker = game.find(ui.attacker)[2]; } catch (error) { return; }
      const deal = strikeParts(game.seat, attacker);
      let text = `受 ${deal.damage}`;
      let title = `你造成 ${deal.damage}（${deal.title}）。打核心没有反击。`;
      if (key.startsWith('unit:')) {
        let foe;
        try { foe = game.find(key.slice(5))[2]; } catch (error) { return; }
        const back = strikeParts(foe.seat, foe);
        text = `受 ${deal.damage} · 反 ${back.damage}`;
        title = `你造成 ${deal.damage}（${deal.title}）。对方反击 ${back.damage}（${back.title}）。`;
      }
      const badge = document.createElement('span');
      badge.className = 'trade';
      badge.textContent = text;
      badge.title = title;
      node.appendChild(badge);
    });
    const reasonNode = document.querySelector('#last-error');
    if (!ui.error && reasonNode && marks.reason.code && !marks.legal.size) {
      reasonNode.dataset.code = marks.reason.code;
      reasonNode.textContent = marks.reason.text;
    }
    if (bad && bad.key && !marks.legal.has(bad.key)) {
      const node = markHost(bad.key);
      if (node) {
        node.dataset.mark = 'bad';
        const badge = document.createElement('div');
        badge.className = 'reject-badge';
        badge.innerHTML = `<span class="cross" aria-hidden="true">×</span><span class="why">${esc(bad.text)}</span>`;
        node.appendChild(badge);
      }
    }
    return marks;
  }

  function pointHit(x, y) {
    const stack = document.elementsFromPoint ? document.elementsFromPoint(x, y) : [document.elementFromPoint(x, y)];
    for (const el of stack) {
      if (!el || !el.closest) continue;
      if (el.closest('.drag-ghost, .aim-arrow, .reject-badge, .peek')) continue;
      const seam = el.closest('.insert');
      if (seam) return { key: 'seam:' + seam.dataset.index, el: seam };
      const link = el.closest('.link-mark');
      if (link) return { key: 'unit:' + link.dataset.iid, el: link, link: true };
      const unit = el.closest('.minion');
      if (unit) return { key: 'unit:' + unit.dataset.iid, el: unit.closest('.unit-wrap') || unit };
      const core = el.closest('.core-wrap');
      if (core) {
        const seatNode = core.querySelector('[data-stat="base"]');
        return { key: 'core:' + (seatNode ? seatNode.dataset.seat : ''), el: core };
      }
      const lane = el.closest('.slots');
      if (lane) return { key: 'half:' + (lane.classList.contains('mine') ? String(viewerBottom()) : String(1 - viewerBottom())), el: lane };
      if (el.closest('.hand-dock, .opp-dock')) return { key: 'hand', el };
    }
    return null;
  }

  function specificReject(hit) {
    if (!hit || hit.key === 'hand') return null;
    const card = selectedCard();
    const seat = game.seat;
    const kind = intentKind();
    let result = { ok: false, code: 'bad_target' };
    if (card && hit.key.startsWith('seam:') && card.kind === 'main') {
      result = C.probe(game, () => game.play(seat, card.template_id, null, null, Number(hit.key.slice(5))));
    } else if (card && hit.key.startsWith('unit:')) {
      const mode = card.effect === 'mend' ? 'heal' : null;
      const index = card.chain_piece ? Number(hit.key.slice(5) ? 0 : 0) : null;
      result = C.probe(game, () => game.play(seat, card.template_id, hit.key.slice(5), mode, card.chain_piece ? 0 : null));
    } else if (card && hit.key.startsWith('core:')) {
      result = { ok: false, code: card.effect === 'seize' ? 'bad_target' : 'bad_target' };
    } else if (ui.attacker && hit.key.startsWith('unit:')) {
      result = C.probe(game, () => game.attack(seat, ui.attacker, hit.key.slice(5)));
    } else if (ui.attacker && hit.key.startsWith('core:')) {
      if (hit.key.slice(5) === String(1 - seat)) result = C.probe(game, () => game.attack(seat, ui.attacker, 'base'));
      else result = { ok: false, code: 'bad_target' };
    } else if (ui.knob && hit.key.startsWith('unit:')) {
      const source = game.units(seat).find(unit => cards[unit.card_id].effect === 'knob');
      result = source ? C.probe(game, () => game.knob(seat, source.iid, hit.key.slice(5))) : result;
    }
    if (result.ok) return null;
    return { key: hit.key, text: shortReject(result.code, kind) };
  }

  function hostNear(index, marks) {
    const row = game.boards[game.seat];
    const found = [];
    row.forEach((unit, slot) => {
      if (unit.link || !marks.legal.has('unit:' + unit.iid)) return;
      found.push({ slot, unit });
    });
    found.sort((a, b) => Math.abs(a.slot - index) - Math.abs(b.slot - index) || a.slot - b.slot);
    return found[0] ? found[0].unit : null;
  }

  function submitGesture(g, hit, marks) {
    if (!canAct() || !hit || !marks.legal.has(hit.key)) return false;
    if (g.kind === 'hand') {
      ui.handIndex = g.handIndex;
      const card = selectedCard();
      if (!card) return false;
      if (card.kind === 'main' && hit.key.startsWith('seam:')) return play(null, null, Number(hit.key.slice(5))) || true;
      if ((card.kind === 'spell' && !wantsTarget(card) && hit.key === 'half:' + game.seat) || (card.kind === 'main' && card.effect === 'play_draw' && hit.key.startsWith('seam:'))) {
        return play(null) || true;
      }
      if (card.kind === 'attachment' && hit.key.startsWith('unit:')) {
        return play(hit.key.slice(5), null, card.chain_piece ? 0 : null) || true;
      }
      if (card.chain_piece && hit.key.startsWith('seam:')) {
        const host = hostNear(Number(hit.key.slice(5)), marks);
        if (!host) return false;
        return play(host.iid, null, Number(hit.key.slice(5))) || true;
      }
      if ((card.effect === 'seize' || card.effect === 'damage' || card.effect === 'play_damage') && hit.key.startsWith('unit:')) {
        return play(hit.key.slice(5)) || true;
      }
      if (card.effect === 'mend' && hit.key.startsWith('unit:')) {
        ui.handIndex = g.handIndex;
        ui.target = hit.key.slice(5);
        ui.error = null;
        render();
        return true;
      }
      return false;
    }
    if (g.kind === 'unit' && ui.attacker) {
      if (hit.key.startsWith('unit:') && marks.legal.has(hit.key)) return attack(hit.key.slice(5)) || true;
      if (hit.key.startsWith('core:') && marks.legal.has(hit.key)) return attack('base') || true;
    }
    if (g.kind === 'knob' && hit.key.startsWith('unit:')) {
      const source = game.units(game.seat).find(unit => cards[unit.card_id].effect === 'knob');
      if (!source) return false;
      try { game.knob(game.seat, source.iid, hit.key.slice(5)); }
      catch (error) { note(error); return true; }
      push(`旋钮台强化了${cards[game.find(hit.key.slice(5))[2].card_id].name}，本回合攻击 +1。`);
      clearChoice();
      render();
      return true;
    }
    return false;
  }

  function showPeek(cardId) {
    const card = cards[cardId];
    if (!card) return;
    document.querySelectorAll('.peek').forEach(node => node.remove());
    const peek = document.createElement('div');
    peek.className = 'peek';
    peek.textContent = `${card.name} · ${blurb(card)} · 只查看，不出牌`;
    document.body.appendChild(peek);
    setTimeout(() => peek.remove(), 900);
  }

  function moveGhost(x, y) {
    const ghost = document.querySelector('.drag-ghost');
    if (!ghost) return;
    ghost.style.left = x + 'px';
    ghost.style.top = y + 'px';
    const arrow = document.querySelector('.aim-arrow line');
    if (!arrow || !gesture || !gesture.origin) return;
    arrow.setAttribute('x2', x);
    arrow.setAttribute('y2', y);
  }

  function ensureGhost(label, attack) {
    if (document.querySelector('.drag-ghost')) return;
    const ghost = document.createElement('div');
    ghost.className = 'drag-ghost';
    ghost.textContent = label;
    document.body.appendChild(ghost);
    dragNodes.push(ghost);
    if (attack && gesture) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'aim-arrow');
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', gesture.origin.x);
      line.setAttribute('y1', gesture.origin.y);
      line.setAttribute('x2', gesture.x);
      line.setAttribute('y2', gesture.y);
      svg.appendChild(line);
      document.body.appendChild(svg);
      dragNodes.push(svg);
    }
  }

  function refreshDrag() {
    if (!gesture) return;
    const hit = pointHit(gesture.x, gesture.y);
    const marks = applyMarks(hit && hit.key, null) || { legal: new Set() };
    const bad = hit && !marks.legal.has(hit.key) && hit.key !== 'hand' && !hit.key.startsWith('half:') ? specificReject(hit) : null;
    if (bad) applyMarks(null, bad);
    else if (hit && marks.legal.has(hit.key)) applyMarks(hit.key, null);
    moveGhost(gesture.x, gesture.y);
    const arrow = document.querySelector('.aim-arrow line');
    if (arrow) arrow.setAttribute('stroke', bad ? '#ff2a2a' : '#1cff6a');
  }

  function beginDragVisual() {
    const arena = document.querySelector('.arena');
    if (arena) arena.classList.add('dragging');
    if (gesture.kind === 'hand') {
      document.body.classList.add('hand-out');
      ui.handIndex = gesture.handIndex;
      ui.attacker = null;
      const laneEl = document.querySelector(game.seat === viewerBottom() ? '.slots.mine' : '.slots.foe');
      if (laneEl) laneEl.innerHTML = lane(game.seat);
      const card = selectedCard();
      ensureGhost(card ? card.name : '牌', !!(card && wantsTarget(card)));
    } else if (gesture.kind === 'knob') {
      ui.knob = true;
      ui.attacker = null;
      ui.handIndex = null;
      ensureGhost('攻击+1', true);
    } else if (gesture.kind === 'unit') {
      const unit = game.find(gesture.iid)[2];
      const ready = unit && !unit.sick && !unit.attacked && !unit.link && Number(gesture.seat) === game.seat;
      if (!ready) return;
      ui.attacker = gesture.iid;
      ui.handIndex = null;
      const box = gesture.origin;
      ensureGhost(cards[unit.card_id].name, true);
      if (box) {
        const arrow = document.querySelector('.aim-arrow line');
        if (arrow) {
          arrow.setAttribute('x1', box.x);
          arrow.setAttribute('y1', box.y);
        }
      }
    }
    refreshDrag();
  }

  function finishGesture(cancelled) {
    const g = gesture;
    clearTimeout(inspectTimer);
    inspectTimer = 0;
    const hit = g ? pointHit(g.x, g.y) : null;
    const dragged = !!(g && g.dragging);
    const inspected = !!(g && g.inspect && !g.dragging);
    gesture = null;
    clearDragNodes();
    if (dragged || inspected) {
      swallowUntil = Date.now() + 80;
      blockDouble = true;
      setTimeout(() => { blockDouble = false; }, 400);
    }
    if (!g || cancelled || g.dead) {
      if (dragged) {
        clearChoice();
        render();
      }
      return;
    }
    if (inspected) return;
    if (!dragged) return;
    ui.handIndex = g.kind === 'hand' ? g.handIndex : ui.handIndex;
    if (g.kind === 'unit' && g.iid) ui.attacker = g.iid;
    const marks = collectMarks();
    const submitted = submitGesture(g, hit, marks);
    if (!submitted) {
      clearChoice();
      render();
    }
  }

  document.addEventListener('pointerdown', event => {
    if (gesture && event.pointerId !== gesture.id) {
      gesture.dead = true;
      finishGesture(true);
      return;
    }
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const hand = event.target.closest && event.target.closest('[data-action="select-hand"]');
    const unit = event.target.closest && event.target.closest('.minion[data-action="select-unit"]');
    const knob = event.target.closest && event.target.closest('[data-action="arm-knob"]');
    if (!hand && !unit && !knob) return;
    const rect = (unit || hand || knob).getBoundingClientRect();
    gesture = {
      id: event.pointerId,
      x0: event.clientX,
      y0: event.clientY,
      x: event.clientX,
      y: event.clientY,
      t0: Date.now(),
      dragging: false,
      inspect: false,
      dead: false,
      kind: hand ? 'hand' : knob ? 'knob' : 'unit',
      handIndex: hand ? Number(hand.dataset.handIndex) : null,
      cardId: hand ? hand.dataset.card : '',
      iid: unit ? unit.dataset.iid : '',
      seat: unit ? unit.dataset.seat : '',
      origin: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    };
    clearTimeout(inspectTimer);
    inspectTimer = setTimeout(() => {
      if (!gesture || gesture.dragging || gesture.id !== event.pointerId) return;
      gesture.inspect = true;
      if (gesture.cardId) showPeek(gesture.cardId);
    }, 400);
  }, true);

  document.addEventListener('pointermove', event => {
    if (!gesture || event.pointerId !== gesture.id) return;
    gesture.x = event.clientX;
    gesture.y = event.clientY;
    const dx = gesture.x - gesture.x0;
    const dy = gesture.y - gesture.y0;
    const dist = Math.hypot(dx, dy);
    const dock = document.querySelector('.hand-dock');
    const dockTop = dock ? dock.getBoundingClientRect().top : 0;
    const pulledOut = gesture.kind === 'hand' && gesture.y < dockTop - 2;
    const upward = gesture.kind === 'hand' && dy < -10 && Math.abs(dy) >= Math.abs(dx);
    const handScroll = gesture.kind === 'hand' && !pulledOut && !upward;
    if (handScroll) return;
    if (dist > 10 || pulledOut) {
      if (gesture.inspect && !pulledOut && !upward) return;
      event.preventDefault();
      if (!gesture.dragging) {
        gesture.dragging = true;
        clearTimeout(inspectTimer);
        beginDragVisual();
      } else refreshDrag();
    }
  }, { passive: false });

  document.addEventListener('pointerup', event => {
    if (!gesture || event.pointerId !== gesture.id) return;
    gesture.x = event.clientX;
    gesture.y = event.clientY;
    finishGesture(false);
  });
  document.addEventListener('pointercancel', event => {
    if (!gesture || event.pointerId !== gesture.id) return;
    gesture.dead = true;
    finishGesture(true);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && gesture) {
      gesture.dead = true;
      finishGesture(true);
    }
  });
  document.addEventListener('contextmenu', event => {
    if (!gesture) return;
    event.preventDefault();
    gesture.dead = true;
    finishGesture(true);
  });

  document.addEventListener('change', event => {
    const el = event.target.closest('[data-nfc-pick]');
    if (!el) return;
    ui.nfcRid = el.value;
    nfcSession.select(lookupRid(ui.nfcRid));
    render();
  });

  document.addEventListener('click', event => {
    if (Date.now() < swallowUntil) {
      swallowUntil = 0;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const el = event.target.closest('[data-action]');
    if (!el || !$('#app').contains(el)) return;
    event.preventDefault();
    act(el.dataset.action, el, event);
  });
  document.addEventListener('dblclick', event => {
    if (Date.now() < swallowUntil || blockDouble) return;
    const el = event.target.closest('[data-action="select-hand"]');
    if (!el || !$('#app').contains(el)) return;
    event.preventDefault();
    deployFromHand(Number(el.dataset.handIndex));
  });

  begin('versus');
})(globalThis);
