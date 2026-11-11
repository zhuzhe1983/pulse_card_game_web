(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PULSEWiki = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Browse prefixes only. StamPLC matches Stamp because the model string starts that way.
  // These groups are not growth families and not an official taxonomy.
  const NAV_PREFIXES = [
    ['Cardputer', /^cardputer/i],
    ['Stamp', /^stamp/i],
    ['Stick', /^stick/i],
    ['Atom', /^atom/i],
    ['DinMeter', /^dinmeter/i],
    ['Air Quality', /^air quality/i],
    ['PowerHub', /^powerhub/i],
    ['Core', /^core/i],
    ['Tough', /^tough/i],
    ['Dial', /^dial/i],
    ['Fire', /^fire/i],
    ['M5GO', /^m5go/i],
    ['Module', /^module/i],
    ['Display', /^display/i],
    ['Chain', /^chain/i],
    ['Unit', /^unit/i],
    ['Hat', /^hat/i],
    ['Tab', /^tab/i]
  ];

  function deriveNavGroup(officialName) {
    const name = String(officialName || '').trim().replace(/^m5stack\s+/i, '');
    for (const [label, pattern] of NAV_PREFIXES) {
      if (pattern.test(name)) return label;
    }
    return '';
  }

  function mergeCatalog(catalog, pack) {
    const entries = pack && pack.cards && typeof pack.cards === 'object' ? pack.cards : {};
    const cards = (catalog.cards || []).map(card => Object.assign({}, card, {
      nav_group: deriveNavGroup(card.official_product_name_en),
      design: entries[card.rid] || null
    }));
    return {catalog, pack: pack || {status: 'pending_integration', cards: {}}, cards};
  }

  function textOf(value) {
    return value === undefined || value === null ? '' : String(value);
  }

  function searchText(card) {
    const design = card.design || {};
    const identity = design.identity || {};
    const growth = design.growth || {};
    const draft = card.game_card_v8 || {};
    return [
      card.rid,
      card.official_product_name_en,
      card.precise_model_or_revision,
      card.filename_stem,
      identity.game_name_zh,
      identity.faction,
      identity.v8_game_name_zh,
      growth.family,
      growth.kind,
      card.game_name_zh,
      card.game_name_en,
      draft.game_name_zh,
      draft.game_name_en
    ].map(textOf).join('\n').toLowerCase();
  }

  function matches(card, state) {
    const query = textOf(state.q).trim().toLowerCase();
    if (query && !searchText(card).includes(query)) return false;
    if (state.type && card.type !== state.type) return false;
    if (state.series === '_none') {
      if (card.product_series) return false;
    } else if (state.series && card.product_series !== state.series) return false;
    if (state.group === '_none') {
      if (card.nav_group) return false;
    } else if (state.group && card.nav_group !== state.group) return false;
    const growth = card.design && card.design.growth;
    if (state.family && (!growth || growth.family !== state.family)) return false;
    if (state.growth && (!growth || growth.kind !== state.growth)) return false;
    if (state.star === 'none') {
      if (growth && growth.star != null) return false;
    } else if (state.star && (!growth || String(growth.star) !== String(state.star))) return false;
    return true;
  }

  function filterCards(cards, state) {
    return cards.filter(card => matches(card, state || {}));
  }

  function growthView(cards, card) {
    const growth = card && card.design && card.design.growth;
    if (!growth) return {mode: 'missing'};
    if (growth.kind === 'chain') {
      const byRid = new Map(cards.map(item => [item.rid, item]));
      return {
        mode: 'chain',
        family: growth.family,
        star: growth.star,
        prev: growth.prev_rid ? byRid.get(growth.prev_rid) || null : null,
        next: growth.next_rid ? byRid.get(growth.next_rid) || null : null,
        members: cards.filter(item => item.design && item.design.growth.family === growth.family && item.design.growth.kind === 'chain')
      };
    }
    if (growth.kind === 'lateral') {
      return {
        mode: 'lateral',
        family: growth.family,
        members: cards.filter(item => item.design && item.design.growth.family === growth.family && item.design.growth.kind === 'lateral')
      };
    }
    return {mode: 'solo', basis: growth.basis};
  }

  function promoteCost(current, next) {
    if (!current || !next) return null;
    const delta = next.design.gameplay.cost - current.design.gameplay.cost;
    return Math.max(1, delta);
  }

  function tally(cards, read) {
    const map = new Map();
    cards.forEach(card => {
      const key = read(card);
      map.set(key, (map.get(key) || 0) + 1);
    });
    return map;
  }

  return {NAV_PREFIXES, deriveNavGroup, mergeCatalog, filterCards, growthView, promoteCost, searchText, tally};
});
