'use strict';

/* Vidget translations.
 *
 * English is the source language: the page is written in English and every
 * dictionary maps an English string to its translation. Missing entries just
 * stay in English, so a partial translation never breaks anything.
 *
 * - Static page text is translated by walking the DOM (translateDocument).
 *   Plain text nodes are looked up by their whitespace-normalized text; short
 *   elements with inline formatting (<strong>, <code>, <a>, …) are looked up by
 *   their normalized innerHTML so the formatting survives translation.
 * - Strings built in JavaScript use t('…', { vars }) and tn(n, one, many).
 *
 * This file picks the language, loads only that dictionary, then loads app.js.
 */
(function () {
  const SUPPORTED = ['en', 'es', 'fr', 'de', 'pt'];
  const dictionaries = {};

  function preferredLanguage() {
    let chosen = 'auto';
    try {
      chosen = JSON.parse(localStorage.getItem('vidget:settings') || '{}').language || 'auto';
    } catch { /* ignore */ }
    if (SUPPORTED.includes(chosen)) return chosen;
    for (const tag of navigator.languages || [navigator.language || 'en']) {
      const base = String(tag).toLowerCase().split('-')[0];
      if (SUPPORTED.includes(base)) return base;
    }
    return 'en';
  }

  const lang = preferredLanguage();
  document.documentElement.lang = lang;

  const normalize = (s) => s.replace(/\s+/g, ' ').trim();
  const dict = () => dictionaries[lang] || {};

  function format(str, vars) {
    if (!vars) return str;
    return str.replace(/\{(\w+)\}/g, (m, key) => (vars[key] !== undefined ? String(vars[key]) : m));
  }

  function t(str, vars) {
    const translated = dict()[str];
    return format(typeof translated === 'string' ? translated : str, vars);
  }

  // Plural-aware: picks the singular or plural English source, then translates it.
  // French treats 0 as singular.
  function tn(n, one, many, vars) {
    const singular = lang === 'fr' ? n < 2 : n === 1;
    return t(singular ? one : many, { n, ...(vars || {}) });
  }

  const INLINE_TAGS = new Set(['STRONG', 'EM', 'B', 'I', 'CODE', 'KBD', 'A', 'BR', 'SPAN', 'SMALL']);
  // Never look inside these at all…
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'SVG']);
  // …and for these, translate attributes (e.g. a textarea's placeholder) but not the content.
  const NO_CONTENT_TAGS = new Set(['TEXTAREA', 'CODE', 'KBD']);
  const ATTRIBUTES = ['placeholder', 'title', 'aria-label', 'alt', 'data-title'];

  // An element whose content is text plus inline formatting only (no ids, icons
  // or controls) is translated as one unit, keeping its markup.
  function isRichLeaf(el) {
    let hasText = false;
    let hasInline = false;
    for (const node of el.childNodes) {
      if (node.nodeType === 3) {
        if (node.textContent.trim()) hasText = true;
      } else if (node.nodeType === 1) {
        if (!INLINE_TAGS.has(node.tagName) || node.id || node.querySelector('[id], svg, input, select, button')) return false;
        hasInline = true;
      }
    }
    return hasText && hasInline;
  }

  // Walks translatable content. Callbacks get the lookup key; returning true
  // from onRich means "handled, don't descend".
  function visit(root, { onAttr, onRich, onText }) {
    const walk = (el) => {
      if (SKIP_TAGS.has(el.tagName) || el.hasAttribute('data-no-i18n')) return;
      for (const attr of ATTRIBUTES) {
        const value = el.getAttribute(attr);
        if (value && /[A-Za-z]/.test(value)) onAttr(normalize(value), el, attr);
      }
      if (NO_CONTENT_TAGS.has(el.tagName)) return;
      if (isRichLeaf(el) && onRich(normalize(el.innerHTML), el)) return;
      for (const node of [...el.childNodes]) {
        if (node.nodeType === 3) {
          const key = normalize(node.textContent);
          if (key && /[A-Za-z]/.test(key)) onText(key, node);
        } else if (node.nodeType === 1) {
          walk(node);
        }
      }
    };
    walk(root);
  }

  function translateTree(root) {
    if (lang === 'en') return;
    const d = dict();
    visit(root, {
      onAttr(key, el, attr) {
        if (typeof d[key] === 'string') el.setAttribute(attr, d[key]);
      },
      onRich(key, el) {
        if (typeof d[key] !== 'string') return false;
        el.innerHTML = d[key];
        return true;
      },
      onText(key, node) {
        if (typeof d[key] !== 'string') return;
        const lead = node.textContent.match(/^\s*/)[0];
        const trail = node.textContent.match(/\s*$/)[0];
        node.textContent = `${lead}${d[key]}${trail}`;
      },
    });
  }

  // Every key the page would look up (used to build and check dictionaries).
  function collectKeys(root = document.body) {
    const keys = new Set();
    const add = (key) => { keys.add(key); };
    visit(root, { onAttr: add, onRich: (key) => { add(key); return true; }, onText: add });
    return [...keys];
  }

  function translateDocument() {
    translateTree(document.body);
    const meta = document.querySelector('meta[name="description"]');
    if (meta) meta.content = t(meta.content);
  }

  window.I18N = {
    lang,
    supported: SUPPORTED,
    register(code, entries) { dictionaries[code] = entries; },
    translateDocument,
    translateTree,
    collectKeys,
    normalize,
  };
  window.t = t;
  window.tn = tn;

  // Load the dictionary (if needed) and then the app, in order.
  const current = document.currentScript;
  const base = current ? current.src.replace(/i18n\.js(\?.*)?$/, '') : '/js/';
  const scripts = lang === 'en' ? [] : [`${base}i18n/${lang}.js`];
  scripts.push(`${base}app.js`);
  for (const src of scripts) {
    const s = document.createElement('script');
    s.src = src;
    s.async = false; // execute in insertion order
    document.body.appendChild(s);
  }
})();
