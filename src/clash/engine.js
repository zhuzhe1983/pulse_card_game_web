/* pcg.clash.v0 table rules.
 * Bound to prompt commit ead309b68815998a49e58b3d2823b94d692e11d2.
 * Card numbers come from the playtest JSON. Combat reads kind, cost, attack,
 * durability, guard, bonuses and the closed effect list only.
 * star, family and version are stored when a pack supplies them and are not read here. */
(function (root) {
  'use strict';
  const RULESET = 'pcg.clash.v0';
  const SOURCE_COMMIT = 'ead309b68815998a49e58b3d2823b94d692e11d2';
  const IMPLEMENTED_EFFECTS = Object.freeze(['support', 'knob', 'mend', 'damage', 'heal_base', 'supply', 'play_draw', 'play_damage', 'draw_one', 'retrieve_grave', 'arm_aiflow', 'seize']);
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
    bad_index: '插入位置不对',
    game_over: '终局已锁定'
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

  function attackOf(cards, unit) {
    const bonus = unit.attachments.reduce((sum, id) => sum + cards[id].attack_bonus, 0);
    return cards[unit.card_id].attack + bonus + unit.temp_attack;
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
      const line = this.boards[seat];
      if (!line.length || line[0].link || this.cards[line[0].card_id].kind !== 'main') {
        return { leader: false, chain_run: 0, percent: 0 };
      }
      let run = 0;
      for (const entry of line.slice(1)) {
        if (entry.link && this.isChain(entry.card_id)) run += 1;
        else break;
      }
      return { leader: true, chain_run: run, percent: 10 + 5 * run };
    }

    strikePreview(seat, attackValue) {
      if (attackValue <= 0) return 0;
      let boosted = attackValue;
      if (this.upper_links[seat].length) boosted += 1;
      if (this.aiflow_armed[seat]) boosted += 2;
      const percent = this.formationState(seat).percent;
      return Math.floor((boosted * (100 + percent) + 99) / 100);
    }

    strikeDamage(seat, attackValue) {
      if (attackValue <= 0) return 0;
      let boosted = attackValue;
      if (this.upper_links[seat].length) boosted += 1;
      if (this.aiflow_armed[seat]) {
        boosted += 2;
        this.aiflow_armed[seat] = false;
      }
      const percent = this.formationState(seat).percent;
      return Math.floor((boosted * (100 + percent) + 99) / 100);
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
      }
      this.event(`座位${seat}场上原有单位解除新入场限制`);
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
        ability_lock: false
      };
      this._nextId += 1;
      return unit;
    }

    insertUnit(seat, cardId, index, sick, durability = null) {
      const row = this.boards[seat];
      if (!Number.isInteger(index) || index < 0 || index > row.length) {
        throw new ClashError('插入位置越界', 'bad_index');
      }
      const unit = this.makeUnit(seat, cardId, sick, durability);
      row.splice(index, 0, unit);
      this.reindex(seat);
      this.event(`座位${seat}${this.cards[cardId].name}进入位置${index}，${sick ? '本回合不能攻击' : '本回合可以攻击'}`);
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
        at = index == null ? this.boards[seat].length : index;
        if (!Number.isInteger(at) || at < 0 || at > this.boards[seat].length) {
          throw new ClashError('插入位置越界', 'bad_index');
        }
        if (card.effect === 'play_damage' && target != null) {
          const found = this.find(this.resolveIid(1 - seat, target));
          if (found[0] === seat) throw new ClashError('入场伤害只能指定敌方单位', 'bad_target');
        }
      } else if (card.kind === 'attachment') {
        if (card.chain_piece && index != null && (!Number.isInteger(index) || index < 0 || index > this.boards[seat].length)) {
          throw new ClashError('插入位置越界', 'bad_index');
        }
        if (target == null) throw new ClashError('配件必须指定己方主控', 'bad_target');
        const found = this.find(this.resolveIid(seat, target));
        if (found[0] !== seat) throw new ClashError('配件只能装在己方主控上', 'bad_target');
        host = found[2];
        if (host.attachments.length >= 1) throw new ClashError('这台主控已经有配件', 'already_has_attachment');
        if (card.grants_guard && hasGuard(this.cards, host)) throw new ClashError('这台主控已经有护卫', 'already_has_guard');
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
        else if (card.effect === 'play_damage' && target != null) {
          const foe = this.find(this.resolveIid(1 - seat, target))[2];
          const amount = card.effect_amount || card.amount || 1;
          foe.durability = Math.max(0, foe.durability - amount);
          this.event(`入场打击，${this.cards[foe.card_id].name}耐久变为${foe.durability}`);
        }
      } else if (card.kind === 'attachment') {
        host.attachments.push(cardId);
        this.event(`${card.name}装到${this.cards[host.card_id].name}上`);
        if (card.chain_piece) this.placeLink(seat, cardId, host.iid, index);
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
      if (effect === 'supply' || effect === 'heal_base' || effect === 'draw_one' || effect === 'retrieve_grave') return;
      if (effect === 'arm_aiflow') {
        if (this.aiflow_armed[seat]) throw new ClashError('说人话还没用掉', 'already_used_ability');
        return;
      }
      if (effect === 'seize') {
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
      } else if (effect === 'damage') {
        const host = this.find(this.resolveIid(1 - seat, target))[2];
        host.durability = Math.max(0, host.durability - card.amount);
        this.event(`${this.cards[host.card_id].name}耐久变为${host.durability}`);
      } else if (effect === 'mend') {
        const found = this.find(this.resolveIid(seat, target));
        const host = found[2];
        if (found[0] !== seat) throw new ClashError('补给只能指定己方单位', 'bad_target');
        if (mode === 'heal') {
          const cap = this.cards[host.card_id].durability;
          host.durability = Math.min(cap, host.durability + card.amount);
          this.event(`${this.cards[host.card_id].name}耐久变为${host.durability}`);
        } else if (mode === 'temp') {
          host.temp_attack += 1;
          this.event(`${this.cards[host.card_id].name}本回合攻击变为${attackOf(this.cards, host)}`);
        } else {
          throw new ClashError('补给要选择修复或临时强化', 'bad_target');
        }
      } else if (effect === 'draw_one') {
        this.draw(seat);
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
        this.event('说人话：本回合下一次打击在百分比之前攻击+2');
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
      if (attacker.attacked) throw new ClashError('这台单位本回合已经攻击过', 'already_attacked');
      const guards = this.units(1 - seat).filter(unit => hasGuard(this.cards, unit));
      if (target === 'base') {
        if (guards.length && !bypassGuard(this.cards, attacker)) throw new ClashError('对方有护卫时只能攻击护卫', 'guard_blocks');
        attacker.attacked = true;
        const damage = this.strikeDamage(seat, attackOf(this.cards, attacker));
        this.bases[1 - seat] = Math.max(0, this.bases[1 - seat] - damage);
        this.event(`${this.cards[attacker.card_id].name}攻击基地，对方基地变为${this.bases[1 - seat]}`);
        this.check_bases();
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
      const atkDamage = this.strikeDamage(seat, attackOf(this.cards, attacker));
      const defDamage = this.strikeDamage(1 - seat, attackOf(this.cards, defender));
      attacker.durability = Math.max(0, attacker.durability - defDamage);
      defender.durability = Math.max(0, defender.durability - atkDamage);
      this.event(`${this.cards[attacker.card_id].name}与${this.cards[defender.card_id].name}同时结算，耐久变为${attacker.durability}和${defender.durability}`);
      this.check_deaths();
    }

    check_deaths() {
      const dead = [];
      for (const seat of [0, 1]) {
        for (const unit of this.boards[seat]) {
          if (!unit.link && unit.durability <= 0) dead.push(unit);
        }
      }
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
        this.boards[seat] = this.boards[seat].filter(unit => unit.durability > 0);
        this.reindex(seat);
      }
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
      const show = unit => {
        if (!unit) return null;
        const shown = {
          iid: unit.iid,
          card_id: unit.card_id,
          durability: unit.durability,
          attack: attackOf(this.cards, unit),
          sick: unit.sick,
          guard: hasGuard(this.cards, unit),
          attachments: unit.attachments.slice()
        };
        if (unit.link) {
          shown.link = true;
          shown.host_iid = unit.host_iid;
        }
        return shown;
      };
      return {
        bases: this.bases.slice(),
        supply: this.supply.slice(),
        max_supply: this.max_supply.slice(),
        hands: this.hands.map(hand => hand.slice()),
        decks: this.decks.map(deck => deck.length),
        boards: this.boards.map(row => row.map(show)),
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

  function aiView(game) {
    const seat = 1;
    const show = unit => ({
      iid: unit.iid,
      card_id: unit.card_id,
      attack: attackOf(game.cards, unit),
      durability: unit.durability,
      sick: !!unit.sick,
      attacked: !!unit.attacked,
      guard: hasGuard(game.cards, unit),
      attached: unit.attachments.length > 0,
      effect: game.cards[unit.card_id].effect || null,
      amount: game.cards[unit.card_id].amount || 0,
      lock: !!unit.ability_lock
    });
    return {
      supply: game.supply[seat],
      baseSelf: game.bases[seat],
      hand: game.hands[seat].map(id => {
        const card = game.cards[id];
        return {
          id, cost: card.cost, kind: card.kind, effect: card.effect || null,
          amount: card.amount || 0, grants_guard: !!card.grants_guard
        };
      }),
      own: game.units(seat).map(show),
      opp: game.units(0).map(show),
      ownGrave: game.graves[seat].slice(),
      usedSupport: !!game.ability_used[seat].support
    };
  }

  function planAi(view, failed) {
    const blocked = key => failed && failed.has(key);
    const support = view.own.find(unit => unit.effect === 'support' && !unit.lock);
    if (support && !view.usedSupport && view.ownGrave.includes('hou_ke') && view.supply >= support.amount) {
      const key = 'support';
      if (!blocked(key)) return { type: 'support', key };
    }
    const mains = view.hand.filter(card => card.kind === 'main' && card.cost <= view.supply);
    mains.sort((a, b) => b.cost - a.cost || a.id.localeCompare(b.id));
    for (const card of mains) {
      const key = 'play:' + card.id;
      if (!blocked(key)) return { type: 'play', card: card.id, target: null, key };
    }
    const seize = view.hand.find(card => card.effect === 'seize' && card.cost <= view.supply);
    if (seize && view.opp.length) {
      const target = view.opp.slice().sort((a, b) => b.durability - a.durability || a.iid.localeCompare(b.iid))[0];
      const key = 'play:' + seize.id + ':' + target.iid;
      if (!blocked(key)) return { type: 'play', card: seize.id, target: target.iid, key };
    }
    const damage = view.hand.find(card => card.effect === 'damage' && card.cost <= view.supply);
    if (damage && view.opp.length) {
      const target = view.opp.slice().sort((a, b) => a.durability - b.durability || a.iid.localeCompare(b.iid))[0];
      const key = 'play:' + damage.id + ':' + target.iid;
      if (!blocked(key)) return { type: 'play', card: damage.id, target: target.iid, key };
    }
    const coin = view.hand.find(card => card.effect === 'supply' && card.cost <= view.supply);
    if (coin && !blocked('play:' + coin.id)) return { type: 'play', card: coin.id, target: null, key: 'play:' + coin.id };
    const heal = view.hand.find(card => card.effect === 'heal_base' && card.cost <= view.supply);
    if (heal && view.baseSelf < 20 && !blocked('play:' + heal.id)) return { type: 'play', card: heal.id, target: null, key: 'play:' + heal.id };
    const part = view.hand.find(card => card.kind === 'attachment' && card.cost <= view.supply);
    const host = part && view.own.find(unit => !unit.attached && !(part.grants_guard && unit.guard));
    if (part && host) {
      const key = 'play:' + part.id + ':' + host.iid;
      if (!blocked(key)) return { type: 'play', card: part.id, target: host.iid, key };
    }
    const ready = view.own.filter(unit => !unit.sick && !unit.attacked && !unit.lock);
    for (const unit of ready) {
      const guards = view.opp.filter(enemy => enemy.guard);
      const target = guards.length
        ? guards.slice().sort((a, b) => a.durability - b.durability || a.iid.localeCompare(b.iid))[0].iid
        : 'base';
      const key = 'attack:' + unit.iid + ':' + target;
      if (!blocked(key)) return { type: 'attack', iid: unit.iid, target, key };
    }
    return null;
  }

  function applyAi(game, action) {
    if (action.type === 'support') game.support(1);
    else if (action.type === 'attack') game.attack(1, action.iid, action.target);
    else if (action.type === 'play') game.play(1, action.card, action.target == null ? null : action.target, null);
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

  function assembleSim(pool, rng, wantHigh, wantMid) {
    const used = {};
    const low = pool.filter(card => card.kind === 'main' && card.cost <= 2);
    const mid = pool.filter(card => card.cost >= 3 && card.cost <= 5);
    const high = pool.filter(card => card.cost >= 6);
    const parts = pool.filter(card => card.kind === 'attachment');
    const mains = pool.filter(card => card.kind === 'main');
    let picked = [];
    picked = picked.concat(takeLimited(rng, low, 5, used));
    picked = picked.concat(takeLimited(rng, mid, wantMid, used));
    picked = picked.concat(takeLimited(rng, high, wantHigh, used));
    picked = picked.concat(takeLimited(rng, parts, 5, used));
    const haveMains = picked.filter(card => card.kind === 'main').length;
    if (haveMains < 10) picked = picked.concat(takeLimited(rng, mains, 10 - haveMains, used));
    const rest = [];
    pool.forEach(card => {
      const room = copyLimit(card) - (used[card.template_id] || 0);
      for (let n = 0; n < room; n += 1) rest.push(card);
    });
    shuffle(rest, rng).forEach(card => {
      if (picked.length >= 30) return;
      if ((used[card.template_id] || 0) >= copyLimit(card)) return;
      used[card.template_id] = (used[card.template_id] || 0) + 1;
      picked.push(card);
    });
    return picked.slice(0, 30);
  }

  function openingWindow(deck) {
    const byId = {};
    deck.forEach(card => { byId[card.template_id] = card; });
    const cheapCount = () => deck.slice(0, 4).filter(card => card.cost <= 2).length;
    if (cheapCount() >= 2) return deck;
    const later = [];
    const early = [];
    deck.forEach((card, index) => {
      if (index >= 4 && card.cost <= 2) later.push(index);
      if (index < 4 && card.cost > 2) early.push(index);
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
    let wantHigh = 3;
    let wantMid = 5;
    let picked = assembleSim(pool, rng, wantHigh, wantMid);
    let shape = deckShape(picked);
    if (picked.length !== 30 || shape.high < 3) {
      wantHigh = 1;
      notes.push('放宽高费');
      picked = assembleSim(pool, rng, wantHigh, wantMid);
      shape = deckShape(picked);
    }
    if (picked.length !== 30 || shape.mid < 5) {
      wantMid = 2;
      notes.push('减少中费');
      picked = assembleSim(pool, rng, wantHigh, wantMid);
      shape = deckShape(picked);
    }
    if (picked.length !== 30 || shape.lowMains < 1) notes.push('牌池不足');
    const ordered = openingWindow(picked);
    shape = deckShape(ordered);
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
