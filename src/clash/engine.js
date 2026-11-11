/* pcg.clash.v0 table rules.
 * Bound to prompt commit 5b85cc15305d3fcb1585d1096aa03b7c1766e3fe.
 * Card numbers come from the playtest JSON. Combat reads kind, cost, attack,
 * durability, guard, bonuses and the closed effect list only.
 * star, family and version are stored when a pack supplies them and are not read here. */
(function (root) {
  'use strict';
  const RULESET = 'pcg.clash.v0';
  const SOURCE_COMMIT = '5b85cc15305d3fcb1585d1096aa03b7c1766e3fe';
  const IMPLEMENTED_EFFECTS = Object.freeze(['support', 'knob', 'mend', 'damage', 'heal_base', 'supply']);
  const IMPLEMENTED = new Set(IMPLEMENTED_EFFECTS);

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
    if (!card || typeof card.family !== 'string') return null;
    const family = card.family.trim();
    return family ? family : null;
  }

  function validateCard(card) {
    if (card.effect != null && !IMPLEMENTED.has(card.effect)) {
      throw new ClashError('还没有这个效果：' + card.effect, 'unsupported_effect');
    }
    if (Object.prototype.hasOwnProperty.call(card, 'star') && starOf(card) == null) {
      throw new ClashError('星级只能是卡数据里的 1、2 或 3', 'bad_star');
    }
    if (Object.prototype.hasOwnProperty.call(card, 'family') && familyOf(card) == null) {
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
    if (!support || supportCards.length !== 1 || supportCards[0].template_id !== support.source || supportCards[0].kind !== 'main') {
      throw new ClashError('支援绑定和卡表不一致', 'binding_mismatch');
    }
    const knobCards = payload.cards.filter(card => card.effect === 'knob');
    const knob = capabilities.bindings.knob;
    if (!knob || knobCards.length !== 1 || knobCards[0].template_id !== knob.source || knobCards[0].kind !== 'main' || knob.temp_attack !== 1) {
      throw new ClashError('旋钮绑定和卡表不一致', 'binding_mismatch');
    }
    const cards = loadCards(payload);
    if (!cards[support.revive]) throw new ClashError('支援目标不在卡表里', 'binding_mismatch');
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
      game.boards = [Array(rules.boardLimit).fill(null), Array(rules.boardLimit).fill(null)];
      game.graves = [[], []];
      game.ability_used = [{}, {}];
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
      this.boards = [Array(rules.boardLimit).fill(null), Array(rules.boardLimit).fill(null)];
      this.graves = [[], []];
      this.ability_used = [{}, {}];
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

    units(seat) { return this.boards[seat].filter(unit => unit != null); }

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
      this.supply[seat] = this.max_supply[seat];
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

    emptySlot(seat) {
      const slot = this.boards[seat].indexOf(null);
      return slot < 0 ? null : slot;
    }

    placeNew(seat, cardId) {
      const slot = this.emptySlot(seat);
      if (slot == null) throw new ClashError('场上没有空位', 'board_full');
      const unit = {
        iid: `u${this._nextId}`,
        card_id: cardId,
        seat,
        slot,
        durability: this.cards[cardId].durability,
        sick: true,
        attacked: false,
        temp_attack: 0,
        attachments: []
      };
      this._nextId += 1;
      this.boards[seat][slot] = unit;
      this.event(`座位${seat}${this.cards[cardId].name}进入位置${slot}，新入场不能攻击`);
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

    play(seat, cardId, target = null, mode = null) {
      this.requireMain(seat);
      const card = this.cards[cardId];
      if (!card) throw new ClashError('未知卡牌');
      if (!this.hands[seat].includes(cardId)) throw new ClashError('手牌里没有这张牌', 'not_in_hand');
      if (this.supply[seat] < card.cost) throw new ClashError('供电不足', 'not_enough_supply');
      let host = null;
      if (card.kind === 'main') {
        if (this.aliveCount(seat) >= this.rules.boardLimit) throw new ClashError('场位已满', 'board_full');
      } else if (card.kind === 'attachment') {
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
        this.placeNew(seat, cardId);
      } else if (card.kind === 'attachment') {
        host.attachments.push(cardId);
        this.event(`${card.name}装到${this.cards[host.card_id].name}上`);
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
      if (effect === 'supply' || effect === 'heal_base') return;
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
      } else {
        throw new ClashError('未知战术');
      }
    }

    support(seat) {
      this.requireMain(seat);
      const binding = this.capabilities.bindings.support;
      const source = this.cards[binding.source];
      const revived = this.cards[binding.revive];
      const sources = this.units(seat).filter(unit => unit.card_id === binding.source);
      if (sources.length !== 1) throw new ClashError(`场上要有一台${source.name}才能支援`, 'no_stamp_on_board');
      if (this.ability_used[seat][binding.source]) throw new ClashError('本回合已经支援过', 'already_used_ability');
      if (!this.graves[seat].includes(binding.revive)) throw new ClashError(`墓地里没有${revived.name}`, 'no_shell_in_grave');
      if (this.aliveCount(seat) >= this.rules.boardLimit) throw new ClashError('场上没有空位', 'board_full');
      const cost = source.amount;
      if (this.supply[seat] < cost) throw new ClashError('供电不足', 'not_enough_supply');
      this.pay(seat, cost);
      this.ability_used[seat][binding.source] = 1;
      this.graves[seat].splice(this.graves[seat].indexOf(binding.revive), 1);
      this.event(`${source.name}支援，${revived.name}离开墓地`);
      return this.placeNew(seat, binding.revive);
    }

    knob(seat, hostId, target) {
      this.requireMain(seat);
      const binding = this.capabilities.bindings.knob;
      hostId = this.resolveIid(seat, hostId);
      target = this.resolveIid(seat, target);
      const hostFound = this.find(hostId);
      const knobCard = this.cards[binding.source];
      if (hostFound[0] !== seat || hostFound[2].card_id !== binding.source) {
        throw new ClashError(`只有己方${knobCard.name}能调这一下`, 'bad_target');
      }
      if (this.ability_used[seat][binding.source]) throw new ClashError('本回合旋钮已经用过', 'already_used_ability');
      const allyFound = this.find(target);
      if (allyFound[0] !== seat) throw new ClashError(`${knobCard.name}只能强化己方单位`, 'bad_target');
      const cost = knobCard.amount;
      if (this.supply[seat] < cost) throw new ClashError('供电不足', 'not_enough_supply');
      this.pay(seat, cost);
      this.ability_used[seat][binding.source] = 1;
      allyFound[2].temp_attack += binding.temp_attack;
      this.event(`${knobCard.name}让${this.cards[allyFound[2].card_id].name}本回合攻击变为${attackOf(this.cards, allyFound[2])}`);
    }

    attack(seat, attackerId, target) {
      this.requireMain(seat);
      attackerId = this.resolveIid(seat, attackerId);
      const atkFound = this.find(attackerId);
      if (atkFound[0] !== seat) throw new ClashError('不能操作对方的单位', 'bad_target');
      const attacker = atkFound[2];
      if (attacker.sick) throw new ClashError('新入场的单位本回合不能攻击', 'summoning_sickness');
      if (attacker.attacked) throw new ClashError('这台单位本回合已经攻击过', 'already_attacked');
      const guards = this.units(1 - seat).filter(unit => hasGuard(this.cards, unit));
      if (target === 'base') {
        if (guards.length && !bypassGuard(this.cards, attacker)) throw new ClashError('对方有护卫时只能攻击护卫', 'guard_blocks');
        attacker.attacked = true;
        const damage = attackOf(this.cards, attacker);
        this.bases[1 - seat] = Math.max(0, this.bases[1 - seat] - damage);
        this.event(`${this.cards[attacker.card_id].name}攻击基地，对方基地变为${this.bases[1 - seat]}`);
        this.check_bases();
        return;
      }
      const defFound = this.find(this.resolveIid(1 - seat, target));
      if (defFound[0] === seat) throw new ClashError('不能攻击己方单位', 'bad_target');
      const defender = defFound[2];
      if (guards.length && !guards.includes(defender) && !bypassGuard(this.cards, attacker)) {
        throw new ClashError('对方有护卫时只能攻击护卫', 'guard_blocks');
      }
      attacker.attacked = true;
      const atkDamage = attackOf(this.cards, attacker);
      const defDamage = attackOf(this.cards, defender);
      attacker.durability = Math.max(0, attacker.durability - defDamage);
      defender.durability = Math.max(0, defender.durability - atkDamage);
      this.event(`${this.cards[attacker.card_id].name}与${this.cards[defender.card_id].name}同时结算，耐久变为${attacker.durability}和${defender.durability}`);
      this.check_deaths();
    }

    check_deaths() {
      const dead = [];
      for (const seat of [0, 1]) {
        this.boards[seat].forEach((unit, slot) => {
          if (unit && unit.durability <= 0) dead.push([seat, slot, unit]);
        });
      }
      for (const [seat, slot, unit] of dead) {
        for (const attachment of unit.attachments) {
          this.graves[seat].push(attachment);
          this.event(`${this.cards[attachment].name}随宿主进入墓地`);
        }
        this.graves[seat].push(unit.card_id);
        this.boards[seat][slot] = null;
        this.event(`${this.cards[unit.card_id].name}进入座位${seat}墓地`);
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
      this.event(`座位${seat}回合结束，临时攻击加成清除，没用完的供电清零`);
      this.seat = 1 - seat;
      this.phase = 'between';
    }

    spawn(seat, cardId, slot, durability = null, sick = false) {
      const card = this.cards[cardId];
      const unit = {
        iid: `u${this._nextId}`,
        card_id: cardId,
        seat,
        slot,
        durability: durability == null ? card.durability : durability,
        sick,
        attacked: false,
        temp_attack: 0,
        attachments: []
      };
      this._nextId += 1;
      if (this.boards[seat][slot] != null) throw new ClashError('位置已有单位');
      this.boards[seat][slot] = unit;
      return unit;
    }

    view() {
      const show = unit => {
        if (!unit) return null;
        return {
          iid: unit.iid,
          card_id: unit.card_id,
          durability: unit.durability,
          attack: attackOf(this.cards, unit),
          sick: unit.sick,
          guard: hasGuard(this.cards, unit),
          attachments: unit.attachments.slice()
        };
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
        phase: this.phase
      };
    }
  }

  function finishTurn(game) {
    game.end_turn(game.seat);
    if (game.winner != null) return;
    game.start_turn();
  }

  const api = Object.freeze({
    RULESET, SOURCE_COMMIT, IMPLEMENTED_EFFECTS, ClashError, loadCards, loadPack,
    rulesFromPayload, starOf, familyOf, attackOf, hasGuard, bypassGuard, Game, finishTurn
  });
  root.PCGClash = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
