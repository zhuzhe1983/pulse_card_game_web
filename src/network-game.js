/* PULSE · host-authoritative game session over the pcg.web.v1 transport. */
(function (g) {
  'use strict';
  const E = g.PCGEngine, R = g.PCGRtc;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const HASH = /^[a-f0-9]{64}$/;
  const INSTANCE = /^p([01]):0[0-9]$/;
  const clone = value => JSON.parse(JSON.stringify(value));
  const obj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const own = (v, k) => Object.prototype.hasOwnProperty.call(v, k);
  class NetworkError extends Error { constructor(code, message) { super(message || code); this.name = 'NetworkError'; this.code = code; } }
  const fail = (code, message) => { throw new NetworkError(code, message); };
  function exact(value, fields, code = 'MESSAGE_FIELDS') {
    if (!obj(value) || Object.keys(value).sort().join('|') !== fields.slice().sort().join('|')) fail(code, '网络消息字段不符合当前版本。');
  }
  function integer(v, min, max) { return Number.isSafeInteger(v) && v >= min && v <= max; }
  function publicIdentity(value) {
    exact(value, ['player_id', 'name', 'skin'], 'PLAYER_FIELDS');
    if (typeof value.player_id !== 'string' || !UUID.test(value.player_id) || typeof value.name !== 'string' || !value.name.trim() || Array.from(value.name).length > 24 || /[\x00-\x1f\x7f]/.test(value.name) || !/^0[1-9]$/.test(value.skin)) fail('PLAYER_IDENTITY', '玩家身份格式不符合当前版本。');
    E.validateJSON(value); return clone(value);
  }
  function validDeck(deck, catalog) {
    if (!Array.isArray(deck) || deck.length !== 10 || new Set(deck).size !== 10 || deck.some(id => typeof id !== 'string' || !own(catalog, id)) || deck.filter(id => catalog[id].kind === 'unit').length < 6) fail('DECK_INVALID', '牌组需要 10 张不同卡片，并至少包含 6 个角色。');
    return deck.slice();
  }
  function validateCommand(command) {
    exact(command, ['match_id', 'action_id', 'expected_revision', 'kind', 'card_instance_id', 'row', 'target_instance_id'], 'COMMAND_FIELDS');
    if (!UUID.test(command.match_id) || typeof command.action_id !== 'string' || !/^[\x21-\x7e]{1,64}$/.test(command.action_id) || !integer(command.expected_revision, 0, 256) || !['play', 'pass'].includes(command.kind)) fail('COMMAND_FORMAT', '出牌动作格式无效。');
    if (command.card_instance_id !== null && (typeof command.card_instance_id !== 'string' || !INSTANCE.test(command.card_instance_id))) fail('COMMAND_CARD', '出牌编号无效。');
    if (command.target_instance_id !== null && (typeof command.target_instance_id !== 'string' || !INSTANCE.test(command.target_instance_id))) fail('COMMAND_TARGET', '目标编号无效。');
    if (![null, 'front', 'rear'].includes(command.row)) fail('COMMAND_ROW', '战场位置无效。');
    return command;
  }
  function uuid() {
    if (g.crypto.randomUUID) return g.crypto.randomUUID();
    const bytes = new Uint8Array(16); g.crypto.getRandomValues(bytes); bytes[6] = bytes[6] & 15 | 64; bytes[8] = bytes[8] & 63 | 128;
    return Array.from(bytes, (v, i) => ([4, 6, 8, 10].includes(i) ? '-' : '') + v.toString(16).padStart(2, '0')).join('');
  }

  class GameSession {
    constructor(options) {
      options = options || {};
      if (!E || !R) fail('DEPENDENCY', '游戏引擎和 WebRTC 模块尚未加载。');
      this.pack = clone(options.pack);
      this.catalog = E.validatePack(this.pack);
      this.hash = E.digest(this.pack);
      const local = options.local || {};
      this.local = publicIdentity({ player_id: local.player_id, name: local.name, skin: local.skin });
      this.deck = validDeck(local.deck, this.catalog);
      this.onUpdate = options.onUpdate || function () {};
      this.onState = options.onState || function () {};
      this.onError = options.onError || function () {};
      this.view = null; this.identities = null; this.seat = null;
      this._remote = null; this._remoteDeck = null; this._authority = null;
      this._helloSent = false; this._closed = false; this._pendingCommand = null;
      this.peer = new R.PeerSession({
        iceServers: options.iceServers,
        onOpen: () => this._opened(),
        onMessage: packet => this._receive(packet),
        onState: status => this.onState(status),
        onError: error => this.onError(error)
      });
    }
    get isOpen() { return !this._closed && this.peer.isOpen; }
    get role() { return this.peer.role; }
    get pendingActionId() { return this._pendingCommand ? this._pendingCommand.action_id : null; }
    createOffer() { return this.peer.createOffer(); }
    acceptOffer(code) { return this.peer.acceptOffer(code); }
    acceptAnswer(code) { return this.peer.acceptAnswer(code); }
    close() { this._closed = true; this._pendingCommand = null; this.peer.close(); }
    _send(type, data) { return this.peer.send(R.makeEnvelope(type, data)); }
    _opened() {
      try {
        this.seat = this.role === 'host' ? 0 : 1;
        const hello = { ruleset_id: this.pack.ruleset_id, content_hash: this.hash, identity: this.local };
        // Sending the host's ten-card deck would disclose its whole initial hand.
        if (this.role === 'guest') hello.deck = this.deck;
        this._helloSent = true;
        this._send('HELLO', hello);
        this.onState({ state: 'handshake', message: '通道已连接，正在校验玩家和卡包…', role: this.role });
        this._maybeStart();
      } catch (error) { this._fatal(error); }
    }
    _fatal(error) {
      if (this._closed) return;
      if (!(error instanceof Error)) error = new NetworkError('NETWORK_GAME', String(error));
      this.onError(error);
      try { if (this.isOpen) this._send('ERROR', { code: error.code || 'NETWORK_GAME', message: error.message.slice(0, 200) }); } catch (_) {}
      this.close();
    }
    _receive(packet) {
      if (this._closed) return;
      try {
        R.validateEnvelope(packet);
        switch (packet.type) {
          case 'HELLO': this._hello(packet); break;
          case 'START': this._start(packet); break;
          case 'ACTION':
            exact(packet, ['protocol', 'type', 'command']);
            if (this.role !== 'host' || !this._authority) fail('AUTHORITY_REQUIRED', '当前连接不能接收玩家动作。');
            this._submit(1, validateCommand(packet.command)); break;
          case 'RESULT':
            exact(packet, ['protocol', 'type', 'result']);
            if (this.role !== 'guest' || !this.view) fail('RESULT_STATE', '对局尚未开始或消息来源错误。');
            this._validateResult(packet.result, this.view.match_id);
            if (this._pendingCommand && this._pendingCommand.action_id === packet.result.action_id) this._pendingCommand = null;
            break;
          case 'VIEW': this._receiveView(packet); break;
          case 'RESYNC':
            exact(packet, ['protocol', 'type', 'match_id', 'revision']);
            if (this.role !== 'host' || !this._authority || packet.match_id !== this._authority.state.match_id || !integer(packet.revision, 0, 256)) fail('RESYNC_STATE', '同步请求不属于当前对局。');
            this._sendView([], null); break;
          case 'ERROR':
            exact(packet, ['protocol', 'type', 'code', 'message']);
            if (typeof packet.code !== 'string' || packet.code.length > 64 || typeof packet.message !== 'string' || packet.message.length > 200) fail('ERROR_FORMAT', '错误消息格式无效。');
            this.onError(new NetworkError(packet.code, packet.message)); this.close(); break;
          case 'PING':
            exact(packet, ['protocol', 'type', 'sequence']);
            if (!integer(packet.sequence, 0, Number.MAX_SAFE_INTEGER)) fail('PING_FORMAT');
            this._send('PONG', { sequence: packet.sequence }); break;
          case 'PONG':
            exact(packet, ['protocol', 'type', 'sequence']);
            if (!integer(packet.sequence, 0, Number.MAX_SAFE_INTEGER)) fail('PING_FORMAT'); break;
          default: fail('UNEXPECTED_MESSAGE', '当前游戏阶段不接受这类消息。');
        }
      } catch (error) { this._fatal(error); }
    }
    _hello(packet) {
      const fromGuest = this.role === 'host';
      exact(packet, ['protocol', 'type', 'ruleset_id', 'content_hash', 'identity'].concat(fromGuest ? ['deck'] : []));
      if (this._remote) fail('HELLO_DUPLICATE', '同一连接不能重复变更玩家身份。');
      if (packet.ruleset_id !== this.pack.ruleset_id || packet.content_hash !== this.hash) fail('CONTENT_MISMATCH', '双方规则或卡包版本不同，请打开同一个版本后再对战。');
      const identity = publicIdentity(packet.identity);
      if (identity.player_id === this.local.player_id) fail('SAME_PLAYER', '两名玩家不能使用同一张玩家卡。');
      this._remote = identity;
      if (fromGuest) this._remoteDeck = validDeck(packet.deck, this.catalog);
      this.identities = fromGuest ? [this.local, identity] : [identity, this.local];
      this._maybeStart();
    }
    _maybeStart() {
      if (this.role !== 'host' || !this._helloSent || !this._remote || this._authority || this._closed) return;
      const seed = new Uint32Array(1); g.crypto.getRandomValues(seed);
      const state = E.newMatch(this.pack, uuid(), this.identities.map(p => p.player_id), [this.deck, this._remoteDeck], seed[0]);
      this._authority = new E.Authority(this.pack, state);
      const view = E.projectView(state, 1);
      this._send('START', { view, view_hash: E.digest(view), identities: this.identities });
      this._update(E.projectView(state, 0), [], null);
      this.onState({ state: 'playing', message: '版本与身份校验通过，对局已开始。', role: this.role });
    }
    _start(packet) {
      exact(packet, ['protocol', 'type', 'view', 'view_hash', 'identities']);
      if (this.role !== 'guest' || !this._remote || this.view) fail('START_STATE', '开局消息不符合当前连接状态。');
      if (!Array.isArray(packet.identities) || packet.identities.length !== 2 || E.digest(packet.identities.map(publicIdentity)) !== E.digest(this.identities)) fail('START_IDENTITIES', '开局玩家与握手身份不一致。');
      this._validateView(packet.view, packet.view_hash);
      if (packet.view.revision !== 0 || packet.view.round_index !== 1 || packet.view.phase !== 'playing') fail('START_REVISION', '初始对局状态无效。');
      this._update(packet.view, [], null);
      this.onState({ state: 'playing', message: '版本与身份校验通过，对局已开始。', role: this.role });
    }
    _cardRef(card, seat, board) {
      exact(card, board ? ['instance_id', 'template_id', 'row', 'base_power', 'power', 'shield', 'stable', 'deploy_order'] : ['instance_id', 'template_id'], 'VIEW_CARD_FIELDS');
      if (typeof card.instance_id !== 'string' || !INSTANCE.test(card.instance_id) || card.instance_id[1] !== String(seat) || typeof card.template_id !== 'string' || !own(this.catalog, card.template_id)) fail('VIEW_CARD', '对局包含未知卡片或无效实例。');
      if (seat === this.seat && this.deck[Number(card.instance_id.slice(3))] !== card.template_id) fail('VIEW_OWN_DECK', '本方牌组与开局时不一致。');
      const def = this.catalog[card.template_id];
      if (board && (def.kind !== 'unit' || !def.allowed_rows.includes(card.row) || card.base_power !== def.base_power || !integer(card.power, 0, def.base_power + 10) || typeof card.shield !== 'boolean' || typeof card.stable !== 'boolean' || card.stable !== def.traits.includes('stable') || card.shield && !def.traits.includes('shield_once') || card.stable && card.power !== card.base_power || !integer(card.deploy_order, 1, 5))) fail('VIEW_UNIT', '战场角色数据无效。');
      return card;
    }
    _validateRound(result) {
      exact(result, ['round_index', 'scores', 'winner', 'awards'], 'VIEW_ROUND_FIELDS');
      if (!integer(result.round_index, 1, 3) || !Array.isArray(result.scores) || result.scores.length !== 2 || result.scores.some(n => !integer(n, 0, 1000))) fail('VIEW_ROUND', '回合结果无效。');
      const winner = result.scores[0] === result.scores[1] ? null : result.scores[0] > result.scores[1] ? 0 : 1;
      const awards = winner === null ? [1, 1] : winner === 0 ? [2, 0] : [0, 2];
      if (result.winner !== winner || E.digest(result.awards) !== E.digest(awards)) fail('VIEW_AWARDS', '回合积分不一致。');
    }
    _validateView(view, hash) {
      if (typeof hash !== 'string' || !HASH.test(hash) || E.digest(view) !== hash) fail('VIEW_HASH', '收到的对局视图校验失败。');
      exact(view, ['ruleset_id', 'content_hash', 'match_id', 'revision', 'round_index', 'phase', 'round_starter', 'turn_player', 'players', 'round_results', 'winner', 'result_reason', 'viewer_seat', 'scores'], 'VIEW_FIELDS');
      if (view.ruleset_id !== this.pack.ruleset_id || view.content_hash !== this.hash || !UUID.test(view.match_id) || !integer(view.revision, 0, 256) || !integer(view.round_index, 1, 3) || !['playing', 'finished'].includes(view.phase) || ![0, 1].includes(view.round_starter) || view.viewer_seat !== this.seat || !Array.isArray(view.players) || view.players.length !== 2) fail('VIEW_HEADER', '对局视图的版本或阶段无效。');
      if (this.view && view.match_id !== this.view.match_id) fail('MATCH_MISMATCH', '消息不属于当前对局。');
      const visible = new Set();
      view.players.forEach((player, seat) => {
        exact(player, ['player_id', 'board', 'discard', 'played_count', 'passed', 'match_points', 'hand_count'].concat(seat === this.seat ? ['hand'] : []), 'VIEW_PRIVATE_HAND');
        if (player.player_id !== this.identities[seat].player_id || !integer(player.hand_count, 0, 10) || !integer(player.played_count, 0, 5) || typeof player.passed !== 'boolean' || !integer(player.match_points, 0, 6) || !Array.isArray(player.board) || player.board.length > 5 || !Array.isArray(player.discard) || player.discard.length > 10) fail('VIEW_PLAYER', '对局玩家数据无效。');
        if (seat === this.seat && (!Array.isArray(player.hand) || player.hand.length !== player.hand_count)) fail('VIEW_HAND_COUNT', '本方手牌数量不一致。');
        if (player.hand_count + player.board.length + player.discard.length !== 10) fail('VIEW_CARD_COUNT', '手牌、战场和弃牌总数不一致。');
        const templates = new Set(), deploys = new Set();
        for (const [cards, board] of [[player.hand || [], false], [player.board, true], [player.discard, false]]) {
          for (const card of cards) {
            this._cardRef(card, seat, board);
            if (visible.has(card.instance_id) || templates.has(card.template_id)) fail('VIEW_DUPLICATE_CARD', '对局出现重复卡片。');
            visible.add(card.instance_id); templates.add(card.template_id);
            if (board) { if (deploys.has(card.deploy_order) || card.deploy_order > player.played_count) fail('VIEW_DEPLOY_ORDER', '部署顺序无效。'); deploys.add(card.deploy_order); }
          }
        }
      });
      if (!Array.isArray(view.scores) || E.digest(view.scores) !== E.digest(E.boardScores(view))) fail('VIEW_SCORES', '战场分数与角色战力不一致。');
      if (!Array.isArray(view.round_results) || view.round_results.length > 3 || view.round_results.length !== view.round_index - (view.phase === 'playing' ? 1 : 0)) fail('VIEW_ROUNDS', '回合记录数量不一致。');
      const points = [0, 0];
      view.round_results.forEach((result, i) => { this._validateRound(result); if (result.round_index !== i + 1) fail('VIEW_ROUNDS'); points[0] += result.awards[0]; points[1] += result.awards[1]; });
      if (points.some((n, seat) => n !== view.players[seat].match_points)) fail('VIEW_POINTS', '对局积分与回合结果不一致。');
      if (view.phase === 'playing') {
        if (![0, 1].includes(view.turn_player) || view.players[view.turn_player].passed || view.winner !== null || view.result_reason !== null || Math.max(...points) >= 4) fail('VIEW_TURN', '当前行动方或进行中状态无效。');
      } else {
        const winner = points[0] === points[1] ? null : points[0] > points[1] ? 0 : 1;
        if (view.turn_player !== null || view.winner !== winner || view.result_reason !== 'points' || Math.max(...points) < 4 && view.round_index !== 3 || view.players.some(p => p.board.length)) fail('VIEW_FINISHED', '对局结束状态无效。');
      }
    }
    _validateEvents(events) {
      if (!Array.isArray(events) || events.length > 64) fail('EVENTS_INVALID', '对战事件过多。');
      for (const event of events) {
        if (!obj(event) || typeof event.kind !== 'string') fail('EVENT_INVALID');
        const specs = { pass: ['actor'], auto_pass: ['actor'], played: ['actor', 'card', 'row'], power: ['instance_id', 'delta'], immune: ['instance_id'], shield_consumed: ['instance_id'], effect_skipped: ['source_instance_id'], round_ended: ['round_index', 'scores', 'winner', 'awards', 'final_boards', 'played_counts', 'passed'], match_ended: ['winner', 'match_points'] };
        if (!own(specs, event.kind)) fail('EVENT_KIND', '不支持的对战事件。');
        exact(event, ['kind'].concat(specs[event.kind]), 'EVENT_FIELDS');
        if (own(event, 'actor') && ![0, 1].includes(event.actor)) fail('EVENT_ACTOR');
        if (event.kind === 'played') { this._cardRef(event.card, event.actor, false); if (![null, 'front', 'rear'].includes(event.row)) fail('EVENT_ROW'); }
        for (const field of ['instance_id', 'source_instance_id']) if (own(event, field) && !INSTANCE.test(event[field])) fail('EVENT_INSTANCE');
        if (event.kind === 'power' && !integer(event.delta, -2, 2)) fail('EVENT_POWER');
        if (event.kind === 'round_ended') {
          this._validateRound({ round_index: event.round_index, scores: event.scores, winner: event.winner, awards: event.awards });
          if (!Array.isArray(event.final_boards) || event.final_boards.length !== 2 || !Array.isArray(event.played_counts) || event.played_counts.length !== 2 || event.played_counts.some(n => !integer(n, 0, 5)) || !Array.isArray(event.passed) || event.passed.length !== 2 || event.passed.some(p => typeof p !== 'boolean')) fail('EVENT_ROUND');
          event.final_boards.forEach((board, seat) => { if (!Array.isArray(board) || board.length > 5) fail('EVENT_BOARD'); board.forEach(c => this._cardRef(c, seat, true)); if (board.reduce((sum, c) => sum + c.power, 0) !== event.scores[seat]) fail('EVENT_SCORE'); });
        }
        if (event.kind === 'match_ended' && (![null, 0, 1].includes(event.winner) || !Array.isArray(event.match_points) || event.match_points.length !== 2 || event.match_points.some(n => !integer(n, 0, 6)))) fail('EVENT_MATCH');
      }
      return events;
    }
    _validateResult(result, matchId) {
      exact(result, ['match_id', 'action_id', 'status', 'revision', 'error_code', 'events', 'snapshot_required'], 'RESULT_FIELDS');
      if (result.match_id !== matchId || typeof result.action_id !== 'string' || !/^[\x21-\x7e]{1,64}$/.test(result.action_id) || !['accepted', 'rejected'].includes(result.status) || !integer(result.revision, 0, 256) || result.snapshot_required !== true || (result.status === 'accepted' ? result.error_code !== null : typeof result.error_code !== 'string' || !/^[A-Z0-9_]{1,64}$/.test(result.error_code))) fail('RESULT_FORMAT', '动作确认消息无效。');
      this._validateEvents(result.events);
      if (result.status === 'rejected' && result.events.length) fail('RESULT_EVENTS');
      return result;
    }
    _update(view, events, result) {
      this.view = clone(view);
      this._pendingCommand = null;
      this.onUpdate({ view: clone(view), identities: clone(this.identities), events: clone(events || []), result: result ? clone(result) : null, seat: this.seat });
    }
    _sendView(events, result) {
      const view = E.projectView(this._authority.state, 1);
      this._send('VIEW', { view, view_hash: E.digest(view), events: events || [], result: result || null });
    }
    _receiveView(packet) {
      exact(packet, ['protocol', 'type', 'view', 'view_hash', 'events', 'result']);
      if (this.role !== 'guest' || !this.view) fail('VIEW_STATE', '只有客机可以接收主机视图。');
      this._validateView(packet.view, packet.view_hash);
      this._validateEvents(packet.events);
      if (packet.result !== null) { this._validateResult(packet.result, this.view.match_id); if (packet.result.revision > packet.view.revision) fail('RESULT_REVISION'); }
      if (packet.view.revision < this.view.revision) return;
      if (packet.view.revision === this.view.revision && E.digest(packet.view) !== E.digest(this.view)) fail('VIEW_CONFLICT', '同一版本出现不同对局状态。');
      this._update(packet.view, packet.view.revision === this.view.revision ? [] : packet.events, packet.result);
    }
    _submit(actor, command) {
      const previous = this._authority.state.revision;
      let result;
      try { result = this._authority.submit(actor, command); }
      catch (error) {
        if (error.code !== 'ACTION_ID_CONFLICT') throw error;
        result = { match_id: this._authority.state.match_id, action_id: command.action_id, status: 'rejected', revision: previous, error_code: error.code, events: [], snapshot_required: true };
      }
      const changed = this._authority.state.revision !== previous;
      const events = changed ? result.events : [];
      this._update(E.projectView(this._authority.state, 0), events, result);
      this._send('RESULT', { result });
      this._sendView(events, result);
      return clone(result);
    }
    sendAction(command) {
      if (!this.isOpen || !this.view) fail('NOT_CONNECTED', '对局尚未连接。');
      validateCommand(command);
      if (command.match_id !== this.view.match_id) fail('MATCH_MISMATCH', '动作不属于当前对局。');
      if (this.role === 'host') return this._submit(0, command);
      if (this._pendingCommand && E.canonical(command) !== E.canonical(this._pendingCommand)) fail('ACTION_PENDING', '正在等待上一条动作确认。');
      this._pendingCommand = clone(command);
      try { this._send('ACTION', { command }); }
      catch (error) { this._pendingCommand = null; throw error; }
      return { status: 'pending', action_id: command.action_id };
    }
    requestResync() {
      if (!this.isOpen || !this.view) fail('NOT_CONNECTED', '对局尚未连接。');
      if (this.role === 'host') {
        this._sendView([], null); this._update(E.projectView(this._authority.state, 0), [], null);
      } else this._send('RESYNC', { match_id: this.view.match_id, revision: this.view.revision });
    }
  }
  g.PCGNet = Object.freeze({ GameSession, NetworkError, validateCommand });
})(globalThis);
