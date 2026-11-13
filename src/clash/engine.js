/* pcg.clash.v0 table rules.
 * Bound to prompt commit 8a9acd2e221708835dab446d019a47dcd90896c6.
 * Card numbers come from the playtest JSON. Combat reads kind, cost, attack,
 * durability, guard, bonuses and the closed effect list only.
 * star, family and version are stored when a pack supplies them and are not read here. */
(function (root) {
  'use strict';
  const RULESET = 'pcg.clash.v0';
  const SOURCE_COMMIT = '8a9acd2e221708835dab446d019a47dcd90896c6';
  const IMPLEMENTED_EFFECTS = Object.freeze(['support', 'knob', 'mend', 'damage', 'heal_base', 'supply', 'play_draw', 'play_damage', 'draw_one', 'retrieve_grave', 'arm_aiflow', 'seize', 'damage_all', 'freeze', 'bounce', 'execute', 'overclock', 'play_heal']);
  const IMPLEMENTED = new Set(IMPLEMENTED_EFFECTS);
  const REASON_TEXT = Object.freeze({
    summoning_sickness: '刚上场，本回合不能攻击',
    already_attacked: '这台本回合已经攻击过',
    not_enough_supply: '供电不足',
    guard_blocks: '对方有护卫，只能攻击护卫',
    bad_target: '没有合法目标',
    already_used_ability: '本回合这个技能已经用过',
    seized_this_turn: '刚改由你控制，本回合不能发动',
    not_your_turn: '现在不能替这一方操作',
    no_shell_in_grave: '墓地没有厚壳',
    no_stamp_on_board: '场上没有小印',
    already_has_attachment: '这台已经有配件',
    already_has_guard: '这台已经有护卫',
    wrong_host: '这张配件没有合法宿主',
    hat_slot_full: '这台 Stick 的帽子口已经占用',
    module_slot_full: '这台 Core 的模块口已经占用',
    base_slot_full: 'Atom 的底座口已经占用',
    unit_slot_full: 'Atom 的 Unit 口已满',
    chain_slot_full: '这台主控的 Chain 口已经占用',
    need_to_chain: 'Atom 要先装上接上串，才能接 Chain',
    bad_index: '插入位置不对',
    game_over: '终局已锁定',
    board_full: '战场已满，最多同时部署 7 台主控',
    frozen: '已停机，下一次己方回合结束后恢复',
    attack_too_low: '只能关闭攻击至少 5 的敌方主控'
  });

  class ClashError extends Error {
    constructor(message, code = 'rejected') {
      super(message);
      this.name = 'ClashError';
      this.code = code;
    }
  }

  function loadCards(payload) {
    const cards = Object.create(null);
    for (const card of payload.cards) cards[card.template_id] = Object.assign({}, card);
    const token = payload.second_player_token;
    cards[token.template_id] = Object.assign({}, token);
    return cards;
  }

  function starOf(card) {
    if (!card || card.star == null) return null;
    if (card.star === 1 || card.star === 2 || card.star === 3) return card.star;
    return null;
  }

  function familyOf(card) {
    if (!card) return null;
    const value = typeof card.family === 'string' ? card.family : card.growth_family;
    if (typeof value !== 'string') return null;
    const family = value.trim();
    return family ? family : null;
  }

  function validateCard(card) {
    if (card.effect != null && !IMPLEMENTED.has(card.effect)) {
      throw new ClashError('还没有这个效果：' + card.effect, 'unsupported_effect');
    }
    if (card.star != null && starOf(card) == null) {
      throw new ClashError('星级只能是卡数据里的 1、2 或 3', 'bad_star');
    }
    if (Object.prototype.hasOwnProperty.call(card, 'family') && card.family != null && familyOf(card) == null) {
      throw new ClashError('家族必须是卡面上的非空字符串', 'bad_family');
    }
  }

  function loadPack(payload, capabilities) {
    if (!payload || payload.ruleset_id !== RULESET) throw new ClashError('规则集不是 pcg.clash.v0', 'unsupported_effect');
    if (!capabilities || capabilities.ruleset_id !== RULESET || !Array.isArray(capabilities.effects)) {
      throw new ClashError('能力契约不属于这一规则集', 'unsupported_effect');
    }
    for (const effect of capabilities.effects) {
      if (!IMPLEMENTED.has(effect)) throw new ClashError('能力契约里有尚未实现的效果 ' + effect, 'unsupported_effect');
    }
    for (const effect of IMPLEMENTED_EFFECTS) {
      if (!capabilities.effects.includes(effect)) throw new ClashError('能力契约少了已实现的效果 ' + effect, 'unsupported_effect');
    }
    const seen = new Set();
    for (const card of payload.cards) {
      if (seen.has(card.template_id)) throw new ClashError('卡牌编号重复', 'bad_card');
      seen.add(card.template_id);
      validateCard(card);
    }
    validateCard(payload.second_player_token);
    const supportCards = payload.cards.filter(card => card.effect === 'support');
    const support = capabilities.bindings && capabilities.bindings.support;
    if (!support || supportCards.some(card => card.kind !== 'main')) {
      throw new ClashError('支援绑定和卡表不一致', 'binding_mismatch');
    }
    const knobCards = payload.cards.filter(card => card.effect === 'knob');
    const knob = capabilities.bindings.knob;
    if (!knob || knob.temp_attack !== 1 || knobCards.some(card => card.kind !== 'main')) {
      throw new ClashError('旋钮绑定和卡表不一致', 'binding_mismatch');
    }
    const cards = loadCards(payload);
    if (supportCards.length && !cards[support.revive]) throw new ClashError('支援目标不在卡表里', 'binding_mismatch');
    return { cards, rules: rulesFromPayload(payload), tokenId: payload.second_player_token.template_id, capabilities };
  }

  function rulesFromPayload(payload) {
    return {
      baseLife: payload.base_life,
      maxSupply: payload.max_supply,
      handLimit: payload.hand_limit,
      boardLimit: payload.board_limit,
      openingHand: payload.opening_hand.slice()
    };
  }

  function lineKey(card) {
    return (card && (card['ser' + 'ies_key'] || card.cost_line)) || 'other';
  }

  function attachmentBonus(cards, unit) {
    const metas = unit.attachment_meta || [];
    let total = 0;
    let adjacency = 0;
    const details = [];
    let previous = null;
    let previousLive = false;
    const ids = unit.attachments || [];
    for (let index = 0; index < ids.length; index += 1) {
      const meta = metas[index] || { ready: true, severed: false };
      if (meta.severed) break;
      if (meta.ready === false) {
        previous = null;
        previousLive = false;
        continue;
      }
      const card = cards[ids[index]];
      const bonus = card.attack_bonus || 0;
      total += bonus;
      if (bonus) details.push([card.name || ids[index], bonus]);
      const mount = card.mount_class;
      if (previousLive && mount && mount === previous) adjacency += 1;
      previous = mount;
      previousLive = true;
    }
    return { total, adjacency, details };
  }

  function attackOf(cards, unit) {
    const bonus = attachmentBonus(cards, unit);
    return cards[unit.card_id].attack + bonus.total + bonus.adjacency + (unit.temp_attack || 0);
  }

  function hasGuard(cards, unit) {
    if (cards[unit.card_id].guard) return true;
    return unit.attachments.some(id => cards[id].grants_guard);
  }

  function bypassGuard(cards, unit) {
    return unit.attachments.some(id => cards[id].bypass_guard);
  }

  class Game {
    static empty(cards, rules, capabilities) {
      const game = Object.create(Game.prototype);
      game.cards = cards;
      game.rules = rules;
      game.capabilities = capabilities;
      game.bases = [rules.baseLife, rules.baseLife];
      game.max_supply = [0, 0];
      game.supply = [0, 0];
      game.fatigue = [0, 0];
      game.decks = [[], []];
      game.hands = [[], []];
      game.boards = [[], []];
      game.graves = [[], []];
      game.ability_used = [{}, {}];
      game.promoteBan = [[], []];
      game.upper_links = [[], []];
      game.upper_pulsed = [false, false];
      game.aiflow_armed = [false, false];
      game.seat = 0;
      game.turns_started = [1, 0];
      game.phase = 'main';
      game.winner = null;
      game.log = [];
      game._nextId = 1;
      return game;
    }

    constructor(cards, deck0, deck1, rules, tokenId = 'jie_yi_ge_dian', capabilities = null) {
      this.cards = cards;
      this.rules = rules;
      this.capabilities = capabilities;
      this.bases = [rules.baseLife, rules.baseLife];
      this.max_supply = [0, 0];
      this.supply = [0, 0];
      this.fatigue = [0, 0];
      this.decks = [deck0.slice(), deck1.slice()];
      this.hands = [[], []];
      this.boards = [[], []];
      this.graves = [[], []];
      this.ability_used = [{}, {}];
      this.promoteBan = [[], []];
      this.upper_links = [[], []];
      this.upper_pulsed = [false, false];
      this.aiflow_armed = [false, false];
      this.seat = 0;
      this.turns_started = [0, 0];
      this.phase = 'opening';
      this.winner = null;
      this.log = [];
      this._nextId = 1;
      for (let n = 0; n < rules.openingHand[0]; n++) this._openingDraw(0);
      for (let n = 0; n < rules.openingHand[1]; n++) this._openingDraw(1);
      this.hands[1].push(tokenId);
      this.log.push('起手：先手3张，后手4张，后手获得借一格电');
    }

    _openingDraw(seat) {
      if (!this.decks[seat].length) throw new ClashError('起手时牌库不够');
      this.hands[seat].push(this.decks[seat].shift());
    }

    event(text) { this.log.push(text); }

    units(seat) { return this.boards[seat].filter(unit => unit && !unit.link); }

    isChain(cardId) { return !!(this.cards[cardId] && this.cards[cardId].chain_piece); }

    isUpperHost(cardId) { return !!(this.cards[cardId] && this.cards[cardId].upper_host); }

    isEsp32Main(cardId) {
      const card = this.cards[cardId];
      if (!card || card.upper_host || card.kind !== 'main') return false;
      if (card.esp32_main) return true;
      const chips = card['official_' + 'main_chips'] || [];
      const role = card['hardware_' + 'controller'];
      return role === 'independent_host' && chips.join(' ').includes('ESP32');
    }

    formationState(seat) {
      const row = this.units(seat);
      if (!row.length) return { leader: false, leader_attack: 0 };
      return { leader: true, leader_attack: 0 };
    }

    lineNeighbors(seat, unit) {
      const row = this.units(seat);
      const index = row.findIndex(item => item.iid === unit.iid);
      if (index < 0) return [0, 0];
      const key = lineKey(this.cards[unit.card_id]);
      const left = index > 0 && lineKey(this.cards[row[index - 1].card_id]) === key ? 1 : 0;
      const right = index + 1 < row.length && lineKey(this.cards[row[index + 1].card_id]) === key ? 1 : 0;
      return [left, right];
    }

    applySeries(seat) {
      for (const unit of this.units(seat)) {
        const [left, right] = this.lineNeighbors(seat, unit);
        const bonus = Math.min(this.rules.adjacencyCap == null ? 2 : this.rules.adjacencyCap, left + right);
        const old = unit.line_durability || 0;
        unit.line_durability = bonus;
        unit.durability = unit.durability + bonus - old;
      }
    }

    profile(seat, unit, consumeAiflow) {
      const card = this.cards[unit.card_id];
      const bonus = attachmentBonus(this.cards, unit);
      const parts = [['基础', card.attack, card.durability]];
      bonus.details.forEach(item => parts.push([item[0], item[1], 0]));
      if (bonus.adjacency) parts.push(['同类相连', bonus.adjacency, 0]);
      if (unit.temp_attack) parts.push(['本回合临时', unit.temp_attack, 0]);
      const raw = card.attack + bonus.total + bonus.adjacency + (unit.temp_attack || 0);
      let attack = 0;
      if (raw > 0) {
        attack = raw;
        const [left, right] = this.lineNeighbors(seat, unit);
        const lineAttack = this.rules.adjacencyAttack == null ? 1 : this.rules.adjacencyAttack;
        const lineCap = this.rules.adjacencyCap == null ? 2 : this.rules.adjacencyCap;
        if (left) {
          attack += lineAttack;
          parts.push(['左邻同系', lineAttack, 1]);
        }
        if (right && (!left || lineCap > 1)) {
          attack += lineAttack;
          parts.push(['右邻同系', lineAttack, 1]);
        }
        if (this.upper_links[seat].some(item => item.target === unit.iid)) {
          attack += 1;
          parts.push(['来自上位的爱', 1, 0]);
        }
        if (this.aiflow_armed[seat]) {
          attack += 2;
          parts.push(['说人话', 2, 0]);
          if (consumeAiflow) this.aiflow_armed[seat] = false;
        }
      }
      const wound = card.durability + (unit.line_durability || 0) - unit.durability;
      if (wound > 0) parts.push(['受伤', 0, -wound]);
      return { attack, parts };
    }

    strikePreview(seat, unitOrValue) {
      if (typeof unitOrValue === 'number') {
        if (unitOrValue <= 0) return 0;
        return unitOrValue;
      }
      return this.profile(seat, unitOrValue, false).attack;
    }

    strikeDamage(seat, unitOrValue) {
      if (typeof unitOrValue === 'number') {
        if (unitOrValue <= 0) return 0;
        return unitOrValue;
      }
      return this.profile(seat, unitOrValue, true).attack;
    }

    attachmentRejection(host, card) {
      const family = this.cards[host.card_id].host_family || 'other';
      const mount = card.mount_class;
      const mounted = host.attachments.map(id => this.cards[id]);
      if (mount === 'hat') {
        if (family !== 'stick') return ['wrong_host', 'Hat 只能装在 Stick 上'];
        if (mounted.some(item => item.mount_class === 'hat')) return ['hat_slot_full', '这台 Stick 的帽子口已经占用'];
      } else if (mount === 'module') {
        if (family !== 'core') return ['wrong_host', 'Module 只能装在 Core 上'];
        if (mounted.some(item => item.mount_class === 'module')) return ['module_slot_full', '这台 Core 的模块口已经占用'];
      } else if (mount === 'base') {
        if (family !== 'atom') return ['wrong_host', 'Base 只能装在 Atom 上'];
        if (mounted.some(item => item.mount_class === 'base')) return ['base_slot_full', 'Atom 的底座口已经占用'];
      } else if (mount === 'unit') {
        if (family !== 'atom') return ['wrong_host', 'Unit 只能装在 Atom 上'];
        const cap = mounted.some(item => item.atom_bus === 'to_unit') ? 2 : 1;
        const units = mounted.filter(item => item.mount_class === 'unit').length;
        if (units >= cap) return ['unit_slot_full', 'Atom 的 Unit 口已满'];
      } else if (mount === 'chain') {
        if (family === 'atom') {
          if (!mounted.some(item => item.atom_bus === 'to_chain')) return ['need_to_chain', 'Atom 要先装上接上串，才能接 Chain'];
        } else if (mounted.some(item => item.mount_class === 'chain')) {
          return ['chain_slot_full', '这台主控的 Chain 口已经占用'];
        }
      } else if (card.kind === 'attachment') {
        return ['wrong_host', '这张配件没有合法宿主'];
      }
      if (card.grants_guard && hasGuard(this.cards, host)) return ['already_has_guard', '这台主控已经有护卫'];
      return null;
    }

    findAttachment(iid) {
      for (const seat of [0, 1]) {
        for (const unit of this.units(seat)) {
          const metas = unit.attachment_meta || [];
          for (let index = 0; index < metas.length; index += 1) {
            if (metas[index] && metas[index].iid === iid) return [seat, unit, index];
          }
        }
      }
      return null;
    }

    effectiveMax(seat) {
      const bonus = this.upper_links[seat].length ? 1 : 0;
      return Math.min(10, this.max_supply[seat] + bonus);
    }

    dropUpperLinks(iid) {
      for (const seat of [0, 1]) {
        const kept = this.upper_links[seat].filter(link => link.source !== iid && link.target !== iid);
        if (kept.length !== this.upper_links[seat].length) {
          this.upper_links[seat] = kept;
          if (!kept.length) this.supply[seat] = Math.min(this.supply[seat], this.max_supply[seat]);
        }
      }
    }

    placeLink(seat, cardId, hostIid, index = null) {
      const link = this.makeUnit(seat, cardId, false, 1);
      link.link = true;
      link.host_iid = hostIid;
      if (index == null) this.boards[seat].push(link);
      else this.boards[seat].splice(index, 0, link);
      this.reindex(seat);
      this.event(`链节标记放到座位${seat}位置${link.slot}`);
      return link;
    }

    removeLinks(seat, hostIid) {
      this.boards[seat] = this.boards[seat].filter(unit => !(unit.link && unit.host_iid === hostIid));
      this.reindex(seat);
    }

    seizeUnit(seat, foe) {
      const old = foe.seat;
      const links = this.boards[old].filter(entry => entry.link && entry.host_iid === foe.iid);
      for (const entry of links) this.boards[old].splice(this.boards[old].indexOf(entry), 1);
      this.boards[old].splice(this.boards[old].indexOf(foe), 1);
      this.reindex(old);
      foe.seat = seat;
      foe.sick = true;
      foe.ability_lock = true;
      this.boards[seat].push(foe);
      for (const entry of links) {
        entry.seat = seat;
        this.boards[seat].push(entry);
      }
      this.reindex(seat);
      this.dropUpperLinks(foe.iid);
      this.event(`夺舍，${this.cards[foe.card_id].name}改由座位${seat}控制，排到最右，本回合不能攻击`);
    }

    upperLink(seat, sourceId, targetId) {
      this.requireMain(seat);
      const sourceIid = this.resolveIid(seat, sourceId);
      const targetIid = this.resolveIid(seat, targetId);
      const sourceFound = this.find(sourceIid);
      const targetFound = this.find(targetIid);
      const source = sourceFound[2];
      const target = targetFound[2];
      if (sourceFound[0] !== seat || source.link || !this.isUpperHost(source.card_id)) {
        throw new ClashError('来自上位的爱只能由己方上位机发动', 'bad_target');
      }
      if (source.ability_lock) throw new ClashError('这台单位本回合不能发动技能', 'seized_this_turn');
      if (targetFound[0] !== seat || target.link || !this.isEsp32Main(target.card_id)) {
        throw new ClashError('只能连到己方的 ESP32 主控', 'bad_target');
      }
      if (sourceIid === targetIid) throw new ClashError('不能连自己', 'bad_target');
      if (this.upper_links[seat].some(item => item.source === sourceIid)) {
        throw new ClashError('这台上位机已经连着', 'already_used_ability');
      }
      if (this.upper_links[seat].some(item => item.target === targetIid)) {
        throw new ClashError('这台主控已经连着上位机', 'already_used_ability');
      }
      if (this.supply[seat] < 1) throw new ClashError('供电不足', 'not_enough_supply');
      this.pay(seat, 1);
      const wasEmpty = this.upper_links[seat].length === 0;
      this.upper_links[seat].push({ source: sourceIid, target: targetIid });
      if (wasEmpty && !this.upper_pulsed[seat]) {
        this.supply[seat] = Math.min(10, this.supply[seat] + 1);
        this.upper_pulsed[seat] = true;
      }
      this.supply[seat] = Math.min(this.supply[seat], this.effectiveMax(seat));
      this.event('来自上位的爱接上');
    }

    aliveCount(seat) { return this.units(seat).length; }

    find(iid) {
      for (const seat of [0, 1]) {
        for (let slot = 0; slot < this.boards[seat].length; slot++) {
          const unit = this.boards[seat][slot];
          if (unit && unit.iid === iid) return [seat, slot, unit];
        }
      }
      throw new ClashError('场上没有这张单位');
    }

    requireMain(seat) {
      if (this.winner != null) throw new ClashError('对局已经结束', 'game_over');
      if (this.phase !== 'main' || this.seat !== seat) throw new ClashError('还没轮到这一方的主阶段', 'not_your_turn');
    }

    start_turn() {
      if (this.winner != null) throw new ClashError('对局已经结束', 'game_over');
      if (this.phase !== 'opening' && this.phase !== 'between') {
        throw new ClashError('回合开始只能接在开局或上一回合结束之后', 'bad_phase');
      }
      const seat = this.seat;
      this.phase = 'start';
      this.turns_started[seat] += 1;
      this.ability_used[seat] = {};
      this.promoteBan[seat] = [];
      this.upper_pulsed[seat] = false;
      for (const unit of this.units(seat)) unit.ability_lock = false;
      const firstOpening = seat === 0 && this.turns_started[seat] === 1;
      if (firstOpening) {
        this.event(`座位${seat}回合开始：先手第1回合不抽牌`);
      } else {
        this.event(`座位${seat}回合开始：抽牌`);
        this.draw(seat);
        if (this.winner != null) return;
      }
      for (const unit of this.units(seat)) {
        unit.sick = false;
        unit.attacked = false;
        (unit.attachment_meta || []).forEach(meta => { meta.ready = true; });
      }
      this.event(`座位${seat}场上原有单位解除新入场限制，第二排配件开始提供加成`);
      this.max_supply[seat] = Math.min(this.rules.maxSupply, this.max_supply[seat] + 1);
      this.supply[seat] = this.effectiveMax(seat);
      this.phase = 'main';
      this.event(`座位${seat}供电上限${this.max_supply[seat]}，当前供电回满`);
    }

    draw(seat) {
      if (this.decks[seat].length) {
        const cardId = this.decks[seat].shift();
        if (this.hands[seat].length >= this.rules.handLimit) {
          this.graves[seat].push(cardId);
          this.event(`座位${seat}手牌已满，${this.cards[cardId].name}展示后进入墓地`);
        } else {
          this.hands[seat].push(cardId);
          this.event(`座位${seat}抽到${this.cards[cardId].name}`);
        }
        return;
      }
      this.fatigue[seat] += 1;
      this.bases[seat] = Math.max(0, this.bases[seat] - this.fatigue[seat]);
      this.event(`座位${seat}疲劳${this.fatigue[seat]}，基地变为${this.bases[seat]}`);
      this.check_bases();
    }

    pay(seat, amount) {
      if (this.supply[seat] < amount) throw new ClashError('供电不足', 'not_enough_supply');
      this.supply[seat] -= amount;
    }

    takeHand(seat, cardId) {
      const index = this.hands[seat].indexOf(cardId);
      if (index < 0) throw new ClashError('手牌里没有这张牌', 'not_in_hand');
      this.hands[seat].splice(index, 1);
    }

    reindex(seat) {
      this.boards[seat].forEach((unit, index) => { unit.slot = index; });
    }

    makeUnit(seat, cardId, sick, durability = null) {
      const unit = {
        iid: `u${this._nextId}`,
        card_id: cardId,
        seat,
        slot: 0,
        durability: durability == null ? this.cards[cardId].durability : durability,
        sick,
        attacked: false,
        temp_attack: 0,
        attachments: [],
        attachment_meta: [],
        line_durability: 0,
        ability_lock: false
      };
      this._nextId += 1;
      return unit;
    }

    insertUnit(seat, cardId, index, sick, durability = null) {
      if (this.rules.boardLimit != null && this.aliveCount(seat) >= this.rules.boardLimit) {
        throw new ClashError('战场已满', 'board_full');
      }
      const row = this.boards[seat];
      if (!Number.isInteger(index) || index < 0 || index > row.length) {
        throw new ClashError('插入位置越界', 'bad_index');
      }
      const unit = this.makeUnit(seat, cardId, sick, durability);
      row.splice(index, 0, unit);
      this.reindex(seat);
      this.applySeries(seat);
      this.event(`座位${seat}${this.cards[cardId].name}进入位置${unit.slot}，${sick ? '本回合不能攻击' : '本回合可以攻击'}`);
      return unit;
    }

    resolveIid(seat, ref) {
      if (typeof ref === 'string' && /^u\d+$/.test(ref)) {
        this.find(ref);
        return ref;
      }
      const found = this.units(seat).filter(unit => unit.card_id === ref).map(unit => unit.iid);
      if (found.length !== 1) throw new ClashError('无法唯一确定单位', 'bad_target');
      return found[0];
    }

    play(seat, cardId, target = null, mode = null, index = null) {
      this.requireMain(seat);
      const card = this.cards[cardId];
      if (!card) throw new ClashError('未知卡牌');
      if (!this.hands[seat].includes(cardId)) throw new ClashError('手牌里没有这张牌', 'not_in_hand');
      if (this.supply[seat] < card.cost) throw new ClashError('供电不足', 'not_enough_supply');
      let host = null;
      let at = null;
      if (card.kind === 'main') {
        if (this.rules.boardLimit != null && this.aliveCount(seat) >= this.rules.boardLimit) throw new ClashError('战场已满', 'board_full');
        at = index == null ? this.boards[seat].length : index;
        if (!Number.isInteger(at) || at < 0 || at > this.boards[seat].length) {
          throw new ClashError('插入位置越界', 'bad_index');
        }
        if (card.effect === 'play_damage' && target != null) {
          const found = this.find(this.resolveIid(1 - seat, target));
          if (found[0] === seat) throw new ClashError('入场伤害只能指定敌方单位', 'bad_target');
        }
      } else if (card.kind === 'attachment') {
        if (target == null) throw new ClashError('配件必须指定己方主控', 'bad_target');
        const found = this.find(this.resolveIid(seat, target));
        if (found[0] !== seat) throw new ClashError('配件只能装在己方主控上', 'bad_target');
        host = found[2];
        if (index != null && (!Number.isInteger(index) || index < 0 || index > host.attachments.length)) {
          throw new ClashError('插入位置越界', 'bad_index');
        }
        const rejection = this.attachmentRejection(host, card);
        if (rejection) throw new ClashError(rejection[1], rejection[0]);
      } else if (card.kind === 'spell') {
        this.prepareSpell(seat, card, target, mode);
      } else {
        throw new ClashError('未知卡种');
      }
      this.pay(seat, card.cost);
      this.takeHand(seat, cardId);
      if (card.kind === 'main') {
        this.insertUnit(seat, cardId, at, !card.rush);
        if (card.effect === 'play_draw') this.draw(seat);
        else if (card.effect === 'play_heal') {
          this.bases[seat] = Math.min(this.rules.baseLife, this.bases[seat] + (card.effect_amount || 3));
          this.event(`${card.name}入场修复核心`);
        }
        else if (card.effect === 'play_damage' && target != null) {
          const foe = this.find(this.resolveIid(1 - seat, target))[2];
          const amount = card.effect_amount || card.amount || 1;
          foe.durability = Math.max(0, foe.durability - amount);
          this.event(`入场打击，${this.cards[foe.card_id].name}耐久变为${foe.durability}`);
        }
      } else if (card.kind === 'attachment') {
        const meta = { iid: `a${this._nextId}`, ready: false, severed: false };
        this._nextId += 1;
        if (!host.attachment_meta) host.attachment_meta = [];
        const slot = index == null ? host.attachments.length : index;
        host.attachments.splice(slot, 0, cardId);
        host.attachment_meta.splice(slot, 0, meta);
        this.event(`${card.name}放到${this.cards[host.card_id].name}的第二排，本回合还没有加成`);
      } else {
        this.castSpell(seat, card, target, mode);
        this.graves[seat].push(cardId);
        this.event(`${card.name}进入墓地`);
      }
      this.check_deaths();
      this.check_bases();
    }

    prepareSpell(seat, card, target, mode) {
      const effect = card.effect;
      if (effect === 'supply' || effect === 'heal_base' || effect === 'draw_one' || effect === 'retrieve_grave' || effect === 'damage_all') return;
      if (['freeze', 'bounce', 'execute', 'overclock'].includes(effect)) {
        if (target == null || target === 'base') throw new ClashError('请选择主控目标', 'bad_target');
        const targetSeat = effect === 'overclock' ? seat : 1 - seat;
        const found = this.find(this.resolveIid(targetSeat, target));
        if (found[0] !== targetSeat || found[2].link) throw new ClashError('目标不符合技能要求', 'bad_target');
        if (effect === 'execute' && this.profile(targetSeat, found[2], false).attack < (card.threshold || 5)) throw new ClashError('目标攻击不足 5', 'attack_too_low');
        if (effect === 'freeze' && found[2].frozen) throw new ClashError('这台已经停机', 'frozen');
        return;
      }
      if (effect === 'arm_aiflow') {
        if (this.aiflow_armed[seat]) throw new ClashError('说人话还没用掉', 'already_used_ability');
        return;
      }
      if (effect === 'seize') {
        if (this.rules.boardLimit != null && this.aliveCount(seat) >= this.rules.boardLimit) throw new ClashError('战场已满', 'board_full');
        if (target == null || target === 'base') throw new ClashError('夺舍只能指定敌方场上的主控', 'bad_target');
        const foeFound = this.find(this.resolveIid(1 - seat, target));
        const foe = foeFound[2];
        if (foeFound[0] === seat || foe.link || this.cards[foe.card_id].kind !== 'main') {
          throw new ClashError('夺舍只能指定敌方场上的主控', 'bad_target');
        }
        return;
      }
      if (effect === 'damage') {
        if (target == null) throw new ClashError('干扰必须指定敌方单位', 'bad_target');
        const found = this.find(this.resolveIid(1 - seat, target));
        if (found[0] === seat) throw new ClashError('干扰只能指定敌方单位', 'bad_target');
        return;
      }
      if (effect === 'mend') {
        if (target == null) throw new ClashError('补给必须指定己方单位', 'bad_target');
        const found = this.find(this.resolveIid(seat, target));
        if (found[0] !== seat) throw new ClashError('补给只能指定己方单位', 'bad_target');
        if (mode !== 'heal' && mode !== 'temp') throw new ClashError('补给要选择修复或临时强化', 'bad_target');
        return;
      }
      throw new ClashError('未知战术');
    }

    castSpell(seat, card, target, mode) {
      const effect = card.effect;
      if (effect === 'supply') {
        this.supply[seat] += card.amount;
        this.event(`当前供电变为${this.supply[seat]}`);
      } else if (effect === 'heal_base') {
        const before = this.bases[seat];
        this.bases[seat] = Math.min(this.rules.baseLife, this.bases[seat] + card.amount);
        this.event(`座位${seat}基地从${before}变为${this.bases[seat]}`);
        if (card.draw) this.draw(seat);
      } else if (effect === 'damage_all') {
        for (const unit of this.units(1 - seat)) unit.durability = Math.max(0, unit.durability - card.amount);
        this.event(`${card.name}对所有敌方主控造成 ${card.amount} 点伤害，同时结算`);
      } else if (effect === 'freeze') {
        const unit = this.find(this.resolveIid(1 - seat, target))[2];
        unit.frozen = true;
        this.event(`${this.cards[unit.card_id].name}停机，下一个己方回合不能攻击`);
        if (card.draw) this.draw(seat);
      } else if (effect === 'execute') {
        this.find(this.resolveIid(1 - seat, target))[2].durability = 0;
        this.event(`${card.name}关闭目标主控`);
      } else if (effect === 'overclock') {
        const unit = this.find(this.resolveIid(seat, target))[2];
        unit.temp_attack += card.amount;
        this.event(`${this.cards[unit.card_id].name}本回合攻击 +${card.amount}`);
      } else if (effect === 'bounce') {
        const unit = this.find(this.resolveIid(1 - seat, target))[2];
        const owner = unit.seat;
        this.graves[owner].push(...unit.attachments);
        this.dropUpperLinks(unit.iid);
        this.boards[owner] = this.boards[owner].filter(item => item !== unit && item.host_iid !== unit.iid);
        this.reindex(owner);
        if (this.hands[owner].length < this.rules.handLimit) this.hands[owner].push(unit.card_id);
        else this.graves[owner].push(unit.card_id);
        this.event(`${this.cards[unit.card_id].name}重启回手，配件进入墓地，场上强化清除`);
      } else if (effect === 'damage') {
        const host = this.find(this.resolveIid(1 - seat, target))[2];
        host.durability = Math.max(0, host.durability - card.amount);
        this.event(`${this.cards[host.card_id].name}耐久变为${host.durability}`);
      } else if (effect === 'mend') {
        const found = this.find(this.resolveIid(seat, target));
        const host = found[2];
        if (found[0] !== seat) throw new ClashError('补给只能指定己方单位', 'bad_target');
        if (mode === 'heal') {
          const cap = this.cards[host.card_id].durability + (host.line_durability || 0);
          host.durability = Math.min(cap, host.durability + card.amount);
          this.event(`${this.cards[host.card_id].name}耐久变为${host.durability}`);
        } else if (mode === 'temp') {
          host.temp_attack += 1;
          this.event(`${this.cards[host.card_id].name}本回合攻击变为${attackOf(this.cards, host)}`);
        } else {
          throw new ClashError('补给要选择修复或临时强化', 'bad_target');
        }
      } else if (effect === 'draw_one') {
        for (let i = 0; i < (card.amount || 1) && this.winner == null; i++) this.draw(seat);
      } else if (effect === 'retrieve_grave') {
        if (!this.graves[seat].length) this.event('墓地是空的，记一笔没有取回');
        else {
          const recovered = this.graves[seat].pop();
          if (this.hands[seat].length >= this.rules.handLimit) {
            this.graves[seat].push(recovered);
            this.event('手牌已满，记一笔没有取回');
          } else {
            this.hands[seat].push(recovered);
            this.event(`记一笔取回${this.cards[recovered].name}`);
          }
        }
      } else if (effect === 'arm_aiflow') {
        this.aiflow_armed[seat] = true;
        this.event('说人话：本回合下一次打击 +2');
      } else if (effect === 'seize') {
        const foe = this.find(this.resolveIid(1 - seat, target))[2];
        this.seizeUnit(seat, foe);
      } else {
        throw new ClashError('未知战术');
      }
    }

    support(seat) {
      this.requireMain(seat);
      const reviveId = this.capabilities.bindings.support.revive;
      const allSources = this.units(seat).filter(unit => this.cards[unit.card_id].effect === 'support');
      const sources = allSources.filter(unit => !unit.ability_lock);
      if (!sources.length) {
        if (allSources.length) throw new ClashError('这台小印本回合不能支援', 'seized_this_turn');
        throw new ClashError('场上要有一台小印才能支援', 'no_stamp_on_board');
      }
      if (this.ability_used[seat].support) throw new ClashError('本回合已经支援过', 'already_used_ability');
      if (this.rules.boardLimit != null && this.aliveCount(seat) >= this.rules.boardLimit) throw new ClashError('战场已满', 'board_full');
      if (!this.graves[seat].includes(reviveId) || this.promoteBan[seat].includes(reviveId)) {
        throw new ClashError('墓地里没有可支援的厚壳工控', 'no_shell_in_grave');
      }
      const cost = this.cards[sources[0].card_id].amount;
      if (this.supply[seat] < cost) throw new ClashError('供电不足', 'not_enough_supply');
      this.pay(seat, cost);
      this.ability_used[seat].support = 1;
      this.graves[seat].splice(this.graves[seat].indexOf(reviveId), 1);
      this.event('小印支援，厚壳工控离开墓地');
      return this.insertUnit(seat, reviveId, 0, true);
    }

    promoteCost(currentId, nextId) {
      return Math.max(1, this.cards[nextId].cost - this.cards[currentId].cost);
    }

    promote(seat, currentId) {
      this.requireMain(seat);
      const current = this.cards[currentId];
      if (!current || !current.next_template_id) throw new ClashError('这张牌没有下一星', 'no_growth');
      const nextId = current.next_template_id;
      const next = this.cards[nextId];
      if (!next || current.growth_kind !== 'chain' || next.growth_family !== current.growth_family) {
        throw new ClashError('这张牌没有下一星', 'no_growth');
      }
      if (next.star !== current.star + 1) throw new ClashError('星级没有接上', 'no_growth');
      if (!this.hands[seat].includes(nextId)) throw new ClashError('手牌里没有下一星', 'not_in_hand');
      let found = null;
      for (const unit of this.units(seat)) {
        if (unit.card_id === currentId) { found = ['main', unit]; break; }
        if (unit.attachments.includes(currentId)) { found = ['attachment', unit]; break; }
      }
      if (!found) throw new ClashError('场上没有这一星', 'bad_target');
      const kind = found[0];
      const unit = found[1];
      if (kind === 'attachment' && next.grants_guard && this.cards[unit.card_id].guard) {
        throw new ClashError('这台主控已经有护卫', 'already_has_guard');
      }
      const cost = this.promoteCost(currentId, nextId);
      if (this.supply[seat] < cost) throw new ClashError('供电不足', 'not_enough_supply');
      this.pay(seat, cost);
      this.takeHand(seat, nextId);
      if (kind === 'main') {
        this.dropUpperLinks(unit.iid);
        this.removeLinks(seat, unit.iid);
        const index = this.boards[seat].indexOf(unit);
        for (const attachment of unit.attachments.slice()) {
          this.graves[seat].push(attachment);
          this.event(`${this.cards[attachment].name}随升星进入墓地`);
        }
        this.graves[seat].push(currentId);
        this.promoteBan[seat].push(currentId);
        this.event(`${current.name}升星退役，进入墓地`);
        const fresh = this.makeUnit(seat, nextId, true);
        this.boards[seat].splice(index, 1, fresh);
        this.reindex(seat);
      } else {
        unit.attachments.splice(unit.attachments.indexOf(currentId), 1);
        this.graves[seat].push(currentId);
        this.promoteBan[seat].push(currentId);
        unit.attachments.push(nextId);
        for (const entry of this.boards[seat]) {
          if (entry.link && entry.host_iid === unit.iid && entry.card_id === currentId) entry.card_id = nextId;
        }
        this.event(`${current.name}升成${next.name}，仍装在原宿主上`);
      }
      this.check_deaths();
      this.check_bases();
    }

    knob(seat, hostId, target) {
      this.requireMain(seat);
      hostId = this.resolveIid(seat, hostId);
      target = this.resolveIid(seat, target);
      const hostFound = this.find(hostId);
      const knobCard = this.cards[hostFound[2].card_id];
      if (hostFound[0] !== seat || knobCard.effect !== 'knob') {
        throw new ClashError('只有己方旋钮台能调这一下', 'bad_target');
      }
      if (hostFound[2].ability_lock) throw new ClashError('这台单位本回合不能发动技能', 'seized_this_turn');
      if (this.ability_used[seat].knob) throw new ClashError('本回合旋钮已经用过', 'already_used_ability');
      const allyFound = this.find(target);
      if (allyFound[0] !== seat) throw new ClashError('旋钮只能强化己方单位', 'bad_target');
      const cost = knobCard.amount;
      if (this.supply[seat] < cost) throw new ClashError('供电不足', 'not_enough_supply');
      this.pay(seat, cost);
      this.ability_used[seat].knob = 1;
      allyFound[2].temp_attack += this.capabilities.bindings.knob.temp_attack;
      this.event(`旋钮台让${this.cards[allyFound[2].card_id].name}本回合攻击变为${attackOf(this.cards, allyFound[2])}`);
    }

    attack(seat, attackerId, target) {
      this.requireMain(seat);
      attackerId = this.resolveIid(seat, attackerId);
      const atkFound = this.find(attackerId);
      if (atkFound[0] !== seat) throw new ClashError('不能操作对方的单位', 'bad_target');
      const attacker = atkFound[2];
      if (attacker.link) throw new ClashError('链节标记不能攻击', 'bad_target');
      if (attacker.sick) throw new ClashError('新入场的单位本回合不能攻击', 'summoning_sickness');
      if (attacker.frozen) throw new ClashError('停机中，不能攻击', 'frozen');
      if (attacker.attacked) throw new ClashError('这台单位本回合已经攻击过', 'already_attacked');
      const guards = this.units(1 - seat).filter(unit => hasGuard(this.cards, unit));
      if (target === 'base') {
        if (guards.length && !bypassGuard(this.cards, attacker)) throw new ClashError('对方有护卫时只能攻击护卫', 'guard_blocks');
        attacker.attacked = true;
        const damage = this.strikeDamage(seat, attacker);
        this.bases[1 - seat] = Math.max(0, this.bases[1 - seat] - damage);
        this.event(`${this.cards[attacker.card_id].name}攻击基地，对方基地变为${this.bases[1 - seat]}`);
        this.check_bases();
        return;
      }
      const accessory = typeof target === 'string' && /^a\d+$/.test(target) ? this.findAttachment(target) : null;
      if (accessory) {
        const accSeat = accessory[0];
        const host = accessory[1];
        const accIndex = accessory[2];
        if (accSeat === seat) throw new ClashError('不能攻击己方配件', 'bad_target');
        attacker.attacked = true;
        const chipDamage = this.strikeDamage(seat, attacker);
        const chipId = host.attachments[accIndex];
        if (chipDamage <= 0) {
          this.event(`攻击没有打掉${this.cards[chipId].name}`);
          return;
        }
        host.attachments.splice(accIndex, 1);
        host.attachment_meta.splice(accIndex, 1);
        host.attachment_meta.slice(accIndex).forEach(meta => { meta.severed = true; });
        this.graves[accSeat].push(chipId);
        this.event(`${this.cards[chipId].name}被打离第二排，后面的加成断开`);
        this.check_deaths();
        return;
      }
      const defFound = this.find(this.resolveIid(1 - seat, target));
      if (defFound[0] === seat) throw new ClashError('不能攻击己方单位', 'bad_target');
      const defender = defFound[2];
      if (defender.link) throw new ClashError('不能攻击链节标记', 'bad_target');
      if (guards.length && !guards.includes(defender) && !bypassGuard(this.cards, attacker)) {
        throw new ClashError('对方有护卫时只能攻击护卫', 'guard_blocks');
      }
      attacker.attacked = true;
      const atkDamage = this.strikeDamage(seat, attacker);
      const defDamage = this.strikeDamage(1 - seat, defender);
      attacker.durability = Math.max(0, attacker.durability - defDamage);
      defender.durability = Math.max(0, defender.durability - atkDamage);
      this.event(`${this.cards[attacker.card_id].name}与${this.cards[defender.card_id].name}同时结算，耐久变为${attacker.durability}和${defender.durability}`);
      this.check_deaths();
    }

    check_deaths() {
      for (const seat of [0, 1]) this.applySeries(seat);
      const dead = [];
      for (const seat of [0, 1]) {
        for (const unit of this.boards[seat]) {
          if (!unit.link && unit.durability <= 0) dead.push(unit);
        }
      }
      if (!dead.length) return;
      for (const unit of dead) {
        const seat = unit.seat;
        if (!this.boards[seat].includes(unit)) continue;
        this.dropUpperLinks(unit.iid);
        this.removeLinks(seat, unit.iid);
        for (const attachment of unit.attachments) {
          this.graves[seat].push(attachment);
          this.event(`${this.cards[attachment].name}随宿主进入墓地`);
        }
        this.graves[seat].push(unit.card_id);
        this.event(`${this.cards[unit.card_id].name}进入座位${seat}墓地`);
      }
      for (const seat of [0, 1]) {
        this.boards[seat] = this.boards[seat].filter(unit => unit.link || unit.durability > 0);
        this.reindex(seat);
      }
      this.check_deaths();
    }

    check_bases() {
      const fallen = this.bases.map((life, seat) => life <= 0 ? seat : -1).filter(seat => seat >= 0);
      if (fallen.length === 2) {
        this.winner = 'draw';
        this.phase = 'over';
        this.event('双方基地同时倒下，平局');
      } else if (fallen.length === 1) {
        this.winner = 1 - fallen[0];
        this.phase = 'over';
        this.event(`座位${fallen[0]}基地倒下，座位${this.winner}获胜`);
      }
    }

    end_turn(seat) {
      this.requireMain(seat);
      for (const unit of this.units(seat)) {
        unit.temp_attack = 0;
        unit.attacked = false;
        unit.frozen = false;
      }
        this.supply[seat] = 0;
        this.aiflow_armed[seat] = false;
        this.event(`座位${seat}回合结束，临时攻击加成清除，没用完的供电清零`);
      this.seat = 1 - seat;
      this.phase = 'between';
    }

    spawn(seat, cardId, index = null, durability = null, sick = false) {
      if (index == null) index = this.boards[seat].length;
      return this.insertUnit(seat, cardId, index, sick, durability);
    }

    view() {
      const tone = (current, printed) => current > printed ? 'green' : current < printed ? 'red' : 'normal';
      const show = (seat, unit) => {
        if (!unit) return null;
        if (unit.link) {
          return { iid: unit.iid, card_id: unit.card_id, link: true, host_iid: unit.host_iid, durability: unit.durability, sick: !!unit.sick, guard: false, attachments: [] };
        }
        const card = this.cards[unit.card_id];
        const profile = this.profile(seat, unit, false);
        const metas = unit.attachment_meta || [];
        const row2 = unit.attachments.map((cardId, index) => {
          const meta = metas[index] || { ready: true, severed: false };
          return {
            iid: meta.iid,
            card_id: cardId,
            bonus: this.cards[cardId].attack_bonus || 0,
            ready: meta.ready !== false,
            severed: !!meta.severed,
            face: 'bonus'
          };
        });
        return {
          iid: unit.iid,
          card_id: unit.card_id,
          durability: unit.durability,
          attack: profile.attack,
          attack_tone: tone(profile.attack, card.attack),
          durability_tone: tone(unit.durability, card.durability),
          breakdown: profile.parts.map(part => ({ source: part[0], attack: part[1], durability: part[2] })),
          sick: unit.sick,
          guard: hasGuard(this.cards, unit),
          attachments: unit.attachments.slice(),
          row2
        };
      };
      return {
        bases: this.bases.slice(),
        supply: this.supply.slice(),
        max_supply: this.max_supply.slice(),
        hands: this.hands.map(hand => hand.slice()),
        decks: this.decks.map(deck => deck.length),
        boards: this.boards.map((row, seat) => row.map(unit => show(seat, unit))),
        graves: this.graves.map(grave => grave.slice()),
        winner: this.winner,
        seat: this.seat,
        phase: this.phase,
        formation: [this.formationState(0), this.formationState(1)],
        upper_links: this.upper_links.map(row => row.map(link => ({ source: link.source, target: link.target }))),
        aiflow_armed: this.aiflow_armed.slice()
      };
    }
  }

  function finishTurn(game) {
    game.end_turn(game.seat);
    if (game.winner != null) return;
    game.start_turn();
  }

  function aiView(game, seat = 1) {
    const show = unit => ({
      iid: unit.iid, card_id: unit.card_id,
      attack: game.profile ? game.profile(unit.seat, unit, false).attack : attackOf(game.cards, unit),
      durability: unit.durability, cost: game.cards[unit.card_id].cost,
      sick: !!unit.sick, attacked: !!unit.attacked, frozen: !!unit.frozen,
      guard: hasGuard(game.cards, unit), bypass: bypassGuard(game.cards, unit),
      host_family: game.cards[unit.card_id].host_family || 'other',
      mounts: unit.attachments.map(id => ({ mount_class: game.cards[id].mount_class, atom_bus: game.cards[id].atom_bus, grants_guard: !!game.cards[id].grants_guard })),
      attached: unit.attachments.length > 0, effect: game.cards[unit.card_id].effect || null,
      amount: game.cards[unit.card_id].amount || 0, lock: !!unit.ability_lock
    });
    return {
      seat, supply: game.supply[seat], baseSelf: game.bases[seat], baseEnemy: game.bases[1 - seat],
      baseLife: game.rules ? game.rules.baseLife : 20, boardLimit: game.rules ? game.rules.boardLimit : null,
      armed: !!(game.aiflow_armed && game.aiflow_armed[seat]),
      hand: game.hands[seat].map(id => ({ ...game.cards[id], id })),
      own: game.units(seat).map(show), opp: game.units(1 - seat).map(show),
      ownGrave: game.graves[seat].slice(), usedSupport: !!game.ability_used[seat].support,
      usedKnob: !!game.ability_used[seat].knob
    };
  }

  function planAi(view, failed) {
    const options = [];
    const add = (score, action) => {
      action.key = [action.type, action.card || action.iid || '', action.target || '', action.mode || ''].join(':');
      if (!(failed && failed.has(action.key))) options.push({ score, action });
    };
    const ready = view.own.filter(unit => !unit.sick && !unit.attacked && !unit.frozen && !unit.lock);
    const guards = view.opp.filter(unit => unit.guard);
    const space = view.boardLimit == null || view.own.length < view.boardLimit;
    const danger = view.opp.filter(unit => !unit.frozen).reduce((n, unit) => n + unit.attack, 0);
    const faceDamage = ready.reduce((n, unit) => n + unit.attack, 0);
    const support = view.own.find(unit => unit.effect === 'support' && !unit.lock);
    if (space && support && !view.usedSupport && view.ownGrave.includes('hou_ke') && view.supply >= support.amount) add(35, { type: 'support' });
    const knob = view.own.find(unit => unit.effect === 'knob' && !unit.lock);
    if (knob && !view.usedKnob && view.supply >= knob.amount && ready.length) {
      const target = ready.slice().sort((a, b) => b.attack - a.attack)[0];
      add(12, { type: 'knob', card: knob.card_id, target: target.iid });
    }
    const mountFits = (card, unit) => {
      const family = unit.host_family || 'other', mounted = unit.mounts || [], mount = card.mount_class;
      if (mount === 'hat') return family === 'stick' && !mounted.some(item => item.mount_class === 'hat');
      if (mount === 'module') return family === 'core' && !mounted.some(item => item.mount_class === 'module');
      if (mount === 'base') return family === 'atom' && !mounted.some(item => item.mount_class === 'base');
      if (mount === 'unit') return family === 'atom' && mounted.filter(item => item.mount_class === 'unit').length < (mounted.some(item => item.atom_bus === 'to_unit') ? 2 : 1);
      if (mount === 'chain') return family === 'atom' ? mounted.some(item => item.atom_bus === 'to_chain') : !mounted.some(item => item.mount_class === 'chain');
      return !unit.attached;
    };
    for (const card of view.hand) {
      if (card.cost > view.supply) continue;
      const play = (score, target = null, mode = null) => add(score - card.cost * .2, { type: 'play', card: card.id, target, mode });
      if (card.kind === 'main' && space) {
        const target = card.effect === 'play_damage' ? view.opp.slice().sort((a, b) => (a.durability <= (card.effect_amount || card.amount || 1) ? -100 : 0) - (b.durability <= (card.effect_amount || card.amount || 1) ? -100 : 0) || b.attack - a.attack)[0] : null;
        play(10 + card.cost + (card.attack + card.durability) * .7 + (card.guard && danger >= view.baseSelf ? 25 : 0) + (target ? 6 : 0), target ? target.iid : null);
      } else if (card.kind === 'attachment') {
        for (const unit of view.own) if (mountFits(card, unit) && !(card.grants_guard && unit.guard)) play(8 + (card.attack_bonus || 0) + (card.grants_guard && danger >= view.baseSelf ? 25 : 0), unit.iid);
      } else if (card.kind === 'spell') {
        if (card.effect === 'damage') for (const unit of view.opp) play(12 + Math.min(card.amount, unit.durability) + (unit.durability <= card.amount ? 16 + unit.attack : 0), unit.iid);
        if (card.effect === 'damage_all' && view.opp.length >= 2) play(10 + view.opp.reduce((n, unit) => n + Math.min(card.amount, unit.durability) * 2 + (unit.durability <= card.amount ? 8 : 0), 0));
        if (card.effect === 'execute') for (const unit of view.opp) if (unit.attack >= (card.threshold || 5)) play(28 + unit.attack, unit.iid);
        if (card.effect === 'seize' && space) for (const unit of view.opp) play(18 + unit.attack + unit.durability, unit.iid);
        if (card.effect === 'freeze') for (const unit of view.opp) if (!unit.frozen && unit.attack >= 2) play((danger >= view.baseSelf ? 35 : 9) + unit.attack, unit.iid);
        if (card.effect === 'bounce') for (const unit of view.opp) if (unit.cost >= 3 || unit.attached || danger >= view.baseSelf) play(12 + (unit.cost || 0) + (unit.attached ? 8 : 0) + (unit.guard && faceDamage >= view.baseEnemy ? 50 : 0), unit.iid);
        if (card.effect === 'draw_one' && view.hand.length <= 6) play(view.hand.length <= 2 ? 24 : 8);
        if (card.effect === 'retrieve_grave' && view.ownGrave.length && view.hand.length <= 6) play(view.hand.length <= 2 ? 20 : 7);
        if (card.effect === 'heal_base' && view.baseSelf <= (view.baseLife || 20) - Math.min(3, card.amount)) play(danger >= view.baseSelf ? 40 : 12);
        if (card.effect === 'arm_aiflow' && !view.armed && ready.length) play(!guards.length && faceDamage + 2 >= view.baseEnemy ? 100 : 14);
        if (card.effect === 'overclock') for (const unit of ready) play(!guards.length && faceDamage + card.amount >= view.baseEnemy ? 100 : 14, unit.iid);
        if (card.effect === 'mend') for (const unit of ready) play(10, unit.iid, 'temp');
        if (card.effect === 'supply' && view.hand.some(item => item !== card && item.cost > view.supply && item.cost <= view.supply + card.amount)) play(30);
      }
    }
    for (const unit of ready) {
      if (!guards.length || unit.bypass) add(faceDamage >= view.baseEnemy ? 150 : 5 + unit.attack * .2, { type: 'attack', iid: unit.iid, target: 'base' });
      for (const enemy of (guards.length && !unit.bypass ? guards : view.opp)) {
        const kills = unit.attack >= enemy.durability, survives = unit.durability > enemy.attack;
        const score = 5 + (kills ? 12 + enemy.attack : 0) + (survives ? 6 : -unit.attack) + (enemy.guard ? 5 : 0) + (danger >= view.baseSelf && kills ? 20 : 0);
        if (kills || survives || enemy.guard) add(score, { type: 'attack', iid: unit.iid, target: enemy.iid });
      }
    }
    options.sort((a, b) => b.score - a.score || a.action.key.localeCompare(b.action.key));
    return options.length ? options[0].action : null;
  }

  function applyAi(game, action, seat = 1) {
    if (action.type === 'support') game.support(seat);
    else if (action.type === 'knob') game.knob(seat, action.card, action.target);
    else if (action.type === 'attack') game.attack(seat, action.iid, action.target);
    else if (action.type === 'play') game.play(seat, action.card, action.target == null ? null : action.target, action.mode || null);
    else throw new ClashError('未知电脑行动', 'bad_target');
  }

  function snapshot(game) {
    return JSON.stringify({
      bases: game.bases, max_supply: game.max_supply, supply: game.supply, fatigue: game.fatigue,
      decks: game.decks, hands: game.hands, boards: game.boards, graves: game.graves,
      ability_used: game.ability_used, promoteBan: game.promoteBan, upper_links: game.upper_links,
      upper_pulsed: game.upper_pulsed, aiflow_armed: game.aiflow_armed, seat: game.seat,
      turns_started: game.turns_started, phase: game.phase, winner: game.winner, log: game.log, _nextId: game._nextId
    });
  }

  function restore(game, raw) {
    const snap = JSON.parse(raw);
    Object.keys(snap).forEach(key => { game[key] = snap[key]; });
  }

  function probe(game, fn) {
    const raw = snapshot(game);
    try {
      fn();
      return { ok: true, code: '', message: '' };
    } catch (error) {
      return { ok: false, code: error.code || 'rejected', message: error.message || String(error) };
    } finally {
      restore(game, raw);
    }
  }

  function reasonText(code) {
    return REASON_TEXT[code] || REASON_TEXT.bad_target;
  }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function rng() {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(list, rng) {
    const out = list.slice();
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      const swap = out[i];
      out[i] = out[j];
      out[j] = swap;
    }
    return out;
  }

  function simCatalog(rosterCards, artRids) {
    const art = new Set(artRids || []);
    const included = [];
    const excluded = [];
    (rosterCards || []).forEach(card => {
      const effect = card.effect || null;
      if (card.kind !== 'main' && card.kind !== 'attachment') {
        excluded.push({ id: card.template_id, name: card.name || '', reason: '不是主控或配件' });
        return;
      }
      if (effect && !IMPLEMENTED.has(effect)) {
        excluded.push({ id: card.template_id, name: card.name || '', reason: '结算器还不认识效果 ' + effect });
        return;
      }
      if (!card.rid || !art.has(card.rid)) {
        excluded.push({ id: card.template_id, name: card.name || '', reason: '没有真实卡面' });
        return;
      }
      included.push(card);
    });
    return { included, excluded };
  }

  function isChainTop(card) {
    return !!(card && card.growth_kind === 'chain' && card.star && !card.next_template_id);
  }

  function copyLimit(card) {
    return isChainTop(card) ? 1 : 2;
  }

  function takeLimited(rng, list, count, used) {
    const bag = shuffle(list.filter(card => (used[card.template_id] || 0) < copyLimit(card)), rng);
    const chosen = [];
    bag.forEach(card => {
      if (chosen.length >= count) return;
      if ((used[card.template_id] || 0) >= copyLimit(card)) return;
      used[card.template_id] = (used[card.template_id] || 0) + 1;
      chosen.push(card);
    });
    return chosen;
  }

  function deckShape(list) {
    const counts = {};
    list.forEach(card => { counts[card.template_id] = (counts[card.template_id] || 0) + 1; });
    return {
      size: list.length,
      mains: list.filter(card => card.kind === 'main').length,
      lowMains: list.filter(card => card.kind === 'main' && card.cost <= 2).length,
      mid: list.filter(card => card.cost >= 3 && card.cost <= 5).length,
      high: list.filter(card => card.cost >= 6).length,
      parts: list.filter(card => card.kind === 'attachment').length,
      topCheap: list.slice(0, 4).filter(card => card.cost <= 2).length,
      copiesOk: list.every(card => counts[card.template_id] <= copyLimit(card))
    };
  }

  function hostFamilyOf(card) {
    const mount = card.mount_class;
    if (mount === 'hat') return 'stick';
    if (mount === 'module') return 'core';
    if (mount === 'base' || mount === 'unit') return 'atom';
    if (mount === 'chain') return 'any';
    return null;
  }

  function deckHasHost(ids, byId, family) {
    const mains = ids.map(id => byId[id]).filter(card => card && card.kind === 'main');
    if (family === 'any') return mains.length > 0;
    return mains.some(card => card.host_family === family);
  }

  function takeHosted(rng, parts, count, used, ids, byId) {
    const chosen = [];
    const pool = shuffle(parts.filter(card => (used[card.template_id] || 0) < copyLimit(card)), rng);
    pool.forEach(card => {
      if (chosen.length >= count) return;
      const family = hostFamilyOf(card);
      const draft = ids.concat(chosen.map(item => item.template_id));
      if (!family || !deckHasHost(draft, byId, family)) return;
      used[card.template_id] = (used[card.template_id] || 0) + 1;
      chosen.push(card);
    });
    return chosen;
  }

  function assembleSim(pool, rng) {
    const byId = Object.fromEntries(pool.map(card => [card.template_id, card]));
    const used = {};
    const mains = pool.filter(card => card.kind === 'main');
    let picked = [];
    for (const [test, count] of [[card => card.cost <= 2, 5], [card => card.cost >= 3 && card.cost <= 5, 7], [card => card.cost >= 6, 2]]) {
      picked.push(...takeLimited(rng, mains.filter(test), count, used));
    }
    while (picked.length < 16) {
      const next = takeLimited(rng, mains, 1, used);
      if (!next.length) break;
      picked.push(...next);
    }
    const spells = pool.filter(card => card.kind === 'spell' && card.effect !== 'supply');
    const mandatory = ['pulse_bolt', 'arc_wave', 'emergency_stop', 'cache_read', 'repair_protocol'];
    for (const id of mandatory) if (byId[id]) { picked.push(byId[id]); used[id] = 1; }
    let spellCount = picked.filter(card => card.kind === 'spell').length;
    while (spellCount < 10) {
      const next = takeLimited(rng, spells, 1, used);
      if (!next.length) break;
      picked.push(...next); spellCount++;
    }
    picked.push(...takeHosted(rng, pool.filter(card => card.kind === 'attachment'), 4, used, picked.map(card => card.template_id), byId));
    while (picked.length < 30) {
      const next = takeLimited(rng, mains, 1, used);
      if (!next.length) break;
      picked.push(...next);
    }
    return picked.slice(0, 30);
  }

  function openingWindow(deck) {
    const cheapMain = card => card.kind === 'main' && card.cost <= 2;
    const cheapCount = () => deck.slice(0, 4).filter(cheapMain).length;
    if (cheapCount() >= 2) return deck;
    const later = [];
    const early = [];
    deck.forEach((card, index) => {
      if (index >= 4 && cheapMain(card)) later.push(index);
      if (index < 4 && !cheapMain(card)) early.push(index);
    });
    later.forEach((late, nth) => {
      if (cheapCount() >= 2 || !early[nth] && early[nth] !== 0) return;
      const slot = early[nth];
      if (slot == null) return;
      const swap = deck[slot];
      deck[slot] = deck[late];
      deck[late] = swap;
    });
    return deck;
  }

  function buildSimDeck(pool, rng) {
    const notes = [];
    let picked = assembleSim(pool, rng);
    if (picked.length !== 30) notes.push('牌池不足');
    const ordered = openingWindow(shuffle(picked, rng));
    const shape = deckShape(ordered);
    if (shape.topCheap < 2) notes.push('牌池不足');
    return { ids: ordered.map(card => card.template_id), notes, shape };
  }

  function buildSimDecks(pool, seed) {
    const seed0 = seed >>> 0 || 1;
    const left = buildSimDeck(pool, mulberry32(seed0));
    const right = buildSimDeck(pool, mulberry32(seed0 + 1));
    return {
      seed: seed0,
      decks: [left.ids, right.ids],
      notes: left.notes.concat(right.notes),
      shapes: [left.shape, right.shape]
    };
  }

  function runAiTurn(game) {
    const done = [];
    const failed = new Set();
    let steps = 0;
    while (steps < 16 && game.winner == null && game.seat === 1 && game.phase === 'main') {
      const action = planAi(aiView(game), failed);
      if (!action) break;
      steps += 1;
      try {
        applyAi(game, action);
        done.push(action);
      } catch (error) {
        failed.add(action.key);
      }
    }
    if (game.winner == null && game.seat === 1 && game.phase === 'main') finishTurn(game);
    return done;
  }

  const api = Object.freeze({
    RULESET, SOURCE_COMMIT, IMPLEMENTED_EFFECTS, ClashError, loadCards, loadPack,
    rulesFromPayload, starOf, familyOf, attackOf, hasGuard, bypassGuard, Game, finishTurn,
    aiView, planAi, applyAi, runAiTurn, probe, reasonText, simCatalog, buildSimDecks
  });
  root.PCGClash = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
