/* PULSE presentation localization. Chinese source messages are stable catalog keys.
 * Translation happens at DOM write boundaries; engine data and logs stay canonical. */
(function (root) {
  'use strict';
  const dictionary = root.PULSE_EN || (typeof module === 'object' ? require('./locales/en.json') : {});
  const normalize = value => /^en(?:-|$)/i.test(value || '') ? 'en' : /^zh(?:-|$)/i.test(value || '') ? 'zh-CN' : null;
  const storageKey = 'pulse.locale';
  const cjk = /[\u3400-\u9fff]/;
  const missing = new Set();
  const doc = root.document;
  let stored;
  try { stored = root.localStorage && root.localStorage.getItem(storageKey); } catch (_) { /* Storage can be unavailable. */ }
  const query = root.location && new URLSearchParams(root.location.search).get('lang');
  let locale = normalize(query) || normalize(stored) || normalize(root.navigator && root.navigator.language) || 'zh-CN';
  const escapePattern = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = Object.entries(dictionary).filter(([key]) => /\{\d+\}/.test(key)).map(([key, value]) => {
    const ids = [];
    const pieces = key.split(/(\{\d+\})/);
    const expression = pieces.map(piece => {
      if (/^\{\d+\}$/.test(piece)) { ids.push(piece.slice(1, -1)); return '(.*?)'; }
      return escapePattern(piece).replace(/\s+/g, '\\s+');
    }).join('');
    return { regex: new RegExp('^' + expression + '$', 's'), ids, value, weight: key.replace(/\{\d+\}/g, '').length };
  }).sort((a, b) => b.weight - a.weight);

  function translate(value, depth = 0) {
    if (!cjk.test(value) || depth > 12) return value;
    const source = value.trim().replace(/\s+/g, ' ');
    let result = dictionary[source];
    if (result === undefined) {
      for (const pattern of patterns) {
        const match = source.match(pattern.regex);
        if (!match) continue;
        const args = Object.fromEntries(pattern.ids.map((id, i) => [id, translate(match[i + 1], depth + 1)]));
        result = pattern.value.replace(/\{(\d+)\}/g, (_, id) => args[id] ?? '');
        break;
      }
    }
    if (result === undefined) {
      const pieces = source.includes('·') ? source.split(/(\s*·\s*)/) : source.split(/([。；、，])/);
      if (pieces.length > 1) result = pieces.map(piece => ({'。':'. ', '；':'; ', '、':', ', '，':', '}[piece] || (piece.trim() === '·' ? ' · ' : translate(piece, depth + 1)))).join('').trim();
    }
    if (result === undefined) { missing.add(source); return value; }
    return value.slice(0, value.length - value.trimStart().length) + result + value.slice(value.trimEnd().length);
  }
  function text(value, language = locale) {
    const source = String(value ?? '');
    return normalize(language) === 'en' ? translate(source) : source;
  }

  const originals = new WeakMap();
  const attributes = new WeakMap();
  function localizedNode(node) {
    const prior = originals.get(node);
    const source = prior && node.nodeValue === prior.rendered ? prior.source : node.nodeValue;
    const rendered = text(source);
    originals.set(node, { source, rendered });
    if (node.nodeValue !== rendered) node.nodeValue = rendered;
  }
  function apply(element = doc) {
    if (!doc || !element) return;
    const walk = doc.createTreeWalker(element, 4);
    let node;
    while ((node = walk.nextNode())) {
      if (!node.parentElement || node.parentElement.closest('script,style,code,pre,[data-i18n-ignore]')) continue;
      localizedNode(node);
    }
    const nodes = element.querySelectorAll ? [...element.querySelectorAll('[title],[aria-label],[placeholder],[alt],meta[name="description"]')] : [];
    if (element.nodeType === 1) nodes.unshift(element);
    for (const el of nodes) {
      if (el.closest('[data-i18n-ignore]')) continue;
      const saved = attributes.get(el) || {};
      for (const key of ['title','aria-label','placeholder','alt', ...(el.matches('meta[name="description"]') ? ['content'] : [])]) {
        if (!el.hasAttribute(key)) continue;
        const current = el.getAttribute(key);
        const source = saved[key] && current === saved[key].rendered ? saved[key].source : current;
        const rendered = text(source);
        saved[key] = {source, rendered};
        if (current !== rendered) el.setAttribute(key, rendered);
      }
      attributes.set(el, saved);
    }
    for (const a of element.querySelectorAll ? element.querySelectorAll('a[href]:not([download])') : []) {
      const href = a.getAttribute('href');
      if (!href || href.startsWith('#')) continue;
      const url = new URL(href, doc.baseURI);
      if (url.origin !== root.location.origin || !/(?:\/|\.html)$/.test(url.pathname)) continue;
      url.searchParams.set('lang', locale);
      a.setAttribute('href', url.pathname + url.search + url.hash);
    }
  }
  function setHTML(element, source) { element.innerHTML = source; apply(element); return source; }
  function setText(element, source) { element.textContent = source; apply(element); return source; }
  function setAttr(element, key, source) { element.setAttribute(key, source); apply(element); return source; }
  function source(element) {
    return [...element.childNodes].map(node => node.nodeType === 3 ? (originals.get(node)?.source ?? node.nodeValue) : source(node)).join('');
  }
  function control() {
    return `<button type="button" class="language-toggle" data-language-toggle data-i18n-ignore aria-label="${locale === 'en' ? 'Switch language to Simplified Chinese' : '切换到英语'}">${locale === 'en' ? '中文' : 'English'}</button>`;
  }
  function mount() {
    const header = doc.querySelector('.pulse-top, header.top');
    if (header && !header.querySelector('[data-language-toggle]')) header.insertAdjacentHTML('beforeend', control());
    doc.querySelectorAll('[data-language-toggle]').forEach(button => {
      button.textContent = locale === 'en' ? '中文' : 'English';
      button.setAttribute('aria-label', locale === 'en' ? 'Switch language to Simplified Chinese' : '切换到英语');
    });
  }
  function setLocale(value) {
    const next = normalize(value);
    if (!next || next === locale) return;
    locale = next;
    try { root.localStorage.setItem(storageKey, locale); } catch (_) { /* URL carries the preference too. */ }
    if (doc) {
      doc.documentElement.lang = locale;
      const url = new URL(root.location.href); url.searchParams.set('lang', locale);
      root.history.replaceState(root.history.state, '', url);
      root.dispatchEvent(new CustomEvent('pulse:language', {detail:{locale}}));
      mount(); apply(doc);
    }
  }
  const api = {text, apply, setHTML, setText, setAttr, source, control, setLocale, normalize, missing, get locale() {return locale;}};
  root.PULSEI18n = api;
  if (typeof module === 'object') module.exports = api;
  if (doc) {
    doc.documentElement.lang = locale;
    if (normalize(query)) { try { root.localStorage.setItem(storageKey, locale); } catch (_) {} }
    doc.addEventListener('click', event => {
      if (!event.target.closest('[data-language-toggle]')) return;
      setLocale(locale === 'en' ? 'zh-CN' : 'en');
      (doc.querySelector('dialog[open] [data-language-toggle]') || doc.querySelector('[data-language-toggle]'))?.focus();
    });
    const init = () => { mount(); apply(doc); };
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init, {once:true}); else init();
  }
})(typeof globalThis === 'object' ? globalThis : this);
