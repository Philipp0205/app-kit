import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEnv } from './helpers/fake-dom.mjs';

var ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loaded(files, options) {
  var env = createEnv(options);
  files.forEach(function (f) { env.load(f); });
  return env;
}

// ---------- AppKit.h ----------

test('h: builds an element with class, children and a click handler', function () {
  var env = loaded(['ak-dom.js']);
  var clicks = 0;
  var el = env.window.AppKit.h('button', { class: 'ak-btn', onclick: function () { clicks += 1; } }, 'Go');
  assert.equal(el.tagName, 'BUTTON');
  assert.equal(el.className, 'ak-btn');
  assert.equal(el.textContent, 'Go');
  el.click();
  assert.equal(clicks, 1);
});

test('h: onClick (camel case) also listens for click', function () {
  var env = loaded(['ak-dom.js']);
  var clicks = 0;
  var el = env.window.AppKit.h('button', { onClick: function () { clicks += 1; } });
  el.click();
  assert.equal(clicks, 1);
});

test('h: text is a text node, never parsed as HTML', function () {
  var env = loaded(['ak-dom.js']);
  var el = env.window.AppKit.h('div', null, '<b>x</b>');
  assert.equal(el.textContent, '<b>x</b>');
  assert.equal(el.children.length, 0);
  assert.equal(el.childNodes[0].nodeType, 3);
});

test('h: an html attribute is a plain attribute, not markup', function () {
  var env = loaded(['ak-dom.js']);
  var el = env.window.AppKit.h('div', { html: '<i>y</i>' });
  assert.equal(el.children.length, 0);
  assert.equal(el.innerHTML, '');
});

test('h: value, checked and disabled are properties', function () {
  var env = loaded(['ak-dom.js']);
  var el = env.window.AppKit.h('input', { value: 'v', checked: true, disabled: true });
  assert.equal(el.value, 'v');
  assert.equal(el.checked, true);
  assert.equal(el.disabled, true);
  assert.equal(el.getAttribute('value'), null);
});

test('h: true is an empty attribute, false, null and undefined are skipped', function () {
  var env = loaded(['ak-dom.js']);
  var el = env.window.AppKit.h('div', { hidden: true, a: false, b: null, c: undefined, 'data-x': 3 });
  assert.equal(el.getAttribute('hidden'), '');
  assert.equal(el.getAttribute('a'), null);
  assert.equal(el.getAttribute('b'), null);
  assert.equal(el.getAttribute('c'), null);
  assert.equal(el.getAttribute('data-x'), '3');
});

test('h: flattens arrays, skips null, undefined and false, appends nodes as they are', function () {
  var env = loaded(['ak-dom.js']);
  var h = env.window.AppKit.h;
  var inner = h('span', null, 'in');
  var el = h('div', null, ['a', ['b', null, [inner]]], null, undefined, false, 0);
  assert.equal(el.textContent, 'abin0');
  assert.equal(el.children.length, 1);
  assert.equal(el.children[0], inner);
});

test('copyText: uses the clipboard API when it works', async function () {
  var written = [];
  var env = loaded(['ak-dom.js'], {
    clipboard: { writeText: function (t) { written.push(t); return Promise.resolve(); } }
  });
  var ok = await env.window.AppKit.copyText('hello');
  assert.equal(ok, true);
  assert.deepEqual(written, ['hello']);
  assert.deepEqual(env.document.commands, []);
});

test('copyText: falls back to a textarea and execCommand when the clipboard rejects', async function () {
  var env = loaded(['ak-dom.js'], {
    clipboard: { writeText: function () { return Promise.reject(new Error('blocked')); } }
  });
  var ok = await env.window.AppKit.copyText('hello');
  assert.equal(ok, true);
  assert.deepEqual(env.document.commands, ['copy']);
  assert.equal(env.body.querySelectorAll('textarea').length, 0);
});

test('copyText: answers false and does not throw when nothing can copy', async function () {
  var env = loaded(['ak-dom.js'], { execCommand: false });
  assert.equal(await env.window.AppKit.copyText('x'), false);
});

// ---------- AppKit.toast ----------

test('toast: creates #ak-toasts and writes a status toast', function () {
  var env = loaded(['ak-toast.js']);
  env.window.AppKit.toast('Saved');
  var box = env.document.getElementById('ak-toasts');
  assert.ok(box);
  var el = box.children[0];
  assert.equal(el.textContent, 'Saved');
  assert.equal(el.getAttribute('role'), 'status');
  assert.match(el.className, /\bak-toast\b/);
  assert.match(el.className, /\bak-toast-info\b/);
});

test('toast: an error is role=alert and lasts 5000ms, others 2800ms', function () {
  var env = loaded(['ak-toast.js']);
  env.window.AppKit.toast('Bad', { kind: 'error' });
  env.window.AppKit.toast('Fine');
  var box = env.document.getElementById('ak-toasts');
  assert.equal(box.children.length, 2);
  assert.equal(box.children[0].getAttribute('role'), 'alert');
  assert.equal(box.children[1].getAttribute('role'), 'status');
  assert.deepEqual(env.timers.map(function (t) { return t.ms; }), [5000, 2800]);
});

test('toast: opts.ms overrides, and the toast is removed after it', function () {
  var env = loaded(['ak-toast.js']);
  env.window.AppKit.toast('Quick', { ms: 100 });
  assert.equal(env.timers[0].ms, 100);
  env.runTimers();
  assert.equal(env.document.getElementById('ak-toasts').children.length, 0);
});

test('toast: reuses the container', function () {
  var env = loaded(['ak-toast.js']);
  env.window.AppKit.toast('a');
  env.window.AppKit.toast('b');
  assert.equal(env.document.querySelectorAll('#ak-toasts').length, 1);
});

test('toast: does nothing when there is no body', function () {
  var env = loaded(['ak-toast.js'], { bodyless: true });
  assert.equal(env.window.AppKit.toast('x'), null);
});

// ---------- AppKit.tabbar ----------

var TABS = [
  { id: 'now', label: 'Now' },
  { id: 'plans', label: 'Plans', icon: '#' },
  { id: 'alerts', label: 'Alerts' }
];

test('tabbar: renders a nav with one button per tab and marks the active one', function () {
  var env = loaded(['ak-tabbar.js']);
  var bar = env.window.AppKit.tabbar({ tabs: TABS, active: 'plans' });
  assert.equal(bar.el.tagName, 'NAV');
  assert.equal(bar.el.className, 'ak-tabbar');
  assert.equal(bar.el.getAttribute('aria-label'), 'Main');
  var buttons = bar.el.querySelectorAll('.ak-tab');
  assert.equal(buttons.length, 3);
  assert.equal(buttons[1].getAttribute('aria-current'), 'page');
  assert.equal(buttons[0].getAttribute('aria-current'), null);
  assert.equal(buttons[0].querySelector('.ak-tab-label').textContent, 'Now');
});

test('tabbar: a click calls onSelect with the id and does not route', function () {
  var env = loaded(['ak-tabbar.js']);
  var picked = [];
  var bar = env.window.AppKit.tabbar({ tabs: TABS, active: 'now', onSelect: function (id) { picked.push(id); } });
  bar.el.querySelectorAll('.ak-tab')[2].click();
  assert.deepEqual(picked, ['alerts']);
  assert.equal(bar.el.querySelectorAll('.ak-tab')[0].getAttribute('aria-current'), 'page');
});

test('tabbar: badge from a map, 99+ for large numbers', function () {
  var env = loaded(['ak-tabbar.js']);
  var bar = env.window.AppKit.tabbar({ tabs: TABS, active: 'now', badge: { alerts: 3 } });
  var tabs = bar.el.querySelectorAll('.ak-tab');
  assert.equal(tabs[2].querySelector('.ak-badge').textContent, '3');
  assert.equal(tabs[0].querySelector('.ak-badge'), null);
  bar.update({ badge: { alerts: 120 } });
  assert.equal(tabs[2].querySelector('.ak-badge').textContent, '99+');
});

test('tabbar: badge from a function', function () {
  var env = loaded(['ak-tabbar.js']);
  var bar = env.window.AppKit.tabbar({
    tabs: TABS,
    active: 'now',
    badge: function (id) { return id === 'plans' ? 'new' : null; }
  });
  assert.equal(bar.el.querySelectorAll('.ak-badge').length, 1);
  assert.equal(bar.el.querySelectorAll('.ak-tab')[1].querySelector('.ak-badge').textContent, 'new');
});

test('tabbar: update changes the active tab and clears a badge in place', function () {
  var env = loaded(['ak-tabbar.js']);
  var bar = env.window.AppKit.tabbar({ tabs: TABS, active: 'now', badge: { alerts: 2 } });
  var before = bar.el.querySelectorAll('.ak-tab')[0];
  bar.update({ active: 'alerts', badge: { alerts: 0 } });
  var tabs = bar.el.querySelectorAll('.ak-tab');
  assert.equal(tabs[0], before);
  assert.equal(tabs[0].getAttribute('aria-current'), null);
  assert.equal(tabs[2].getAttribute('aria-current'), 'page');
  assert.equal(bar.el.querySelectorAll('.ak-badge').length, 0);
});

// ---------- AppKit.sheet ----------

function sheetEnv(options) {
  var env = loaded(['ak-dom.js', 'ak-sheet.js'], options);
  env.makeSheet = function () {
    var h = env.window.AppKit.h;
    return h('div', { class: 'ak-sheet' }, h('div', { class: 'ak-grabber' }), h('p', null, 'Hi'));
  };
  return env;
}

test('sheet: show adds the scrim, the sheet and html.ak-sheet-open', function () {
  var env = sheetEnv();
  var node = env.makeSheet();
  var handle = env.window.AppKit.sheet.show(node);
  assert.equal(typeof handle.close, 'function');
  assert.match(env.html.className, /\bak-sheet-open\b/);
  var scrim = env.document.querySelector('.ak-scrim');
  assert.ok(scrim);
  assert.equal(scrim.getAttribute('aria-label'), 'Close');
  assert.equal(scrim.tagName, 'BUTTON');
  assert.ok(env.document.querySelector('.ak-sheet'));
});

test('sheet: adds the ak-sheet class when it is missing', function () {
  var env = sheetEnv();
  var node = env.window.AppKit.h('div', null, 'x');
  env.window.AppKit.sheet.show(node);
  assert.match(node.className, /\bak-sheet\b/);
});

test('sheet: close removes it, calls onClose once, and is idempotent', function () {
  var env = sheetEnv({ media: { '(prefers-reduced-motion: reduce)': true } });
  var closed = 0;
  var handle = env.window.AppKit.sheet.show(env.makeSheet(), { onClose: function () { closed += 1; } });
  handle.close();
  handle.close();
  assert.equal(closed, 1);
  assert.doesNotMatch(env.html.className, /ak-sheet-open/);
  assert.equal(env.document.querySelector('.ak-sheet'), null);
  assert.equal(env.document.querySelector('.ak-scrim'), null);
  assert.equal(env.docHandlerCount('keydown'), 0);
});

test('sheet: without reduced motion it animates out, then removes after the timeout', function () {
  var env = sheetEnv();
  env.window.AppKit.sheet.show(env.makeSheet()).close();
  assert.ok(env.document.querySelector('.ak-sheet-layer.ak-closing'));
  assert.equal(env.timers[0].ms, 220);
  env.runTimers();
  assert.equal(env.document.querySelector('.ak-sheet-layer'), null);
});

test('sheet: Escape closes', function () {
  var env = sheetEnv({ media: { '(prefers-reduced-motion: reduce)': true } });
  var closed = 0;
  env.window.AppKit.sheet.show(env.makeSheet(), { onClose: function () { closed += 1; } });
  env.fireKey('a');
  assert.equal(closed, 0);
  env.fireKey('Escape');
  assert.equal(closed, 1);
  assert.equal(env.document.querySelector('.ak-sheet'), null);
});

test('sheet: a click on the scrim closes', function () {
  var env = sheetEnv({ media: { '(prefers-reduced-motion: reduce)': true } });
  var closed = 0;
  env.window.AppKit.sheet.show(env.makeSheet(), { onClose: function () { closed += 1; } });
  env.document.querySelector('.ak-scrim').click();
  assert.equal(closed, 1);
});

test('sheet: a second show while one is open returns null, and works again after close', function () {
  var env = sheetEnv({ media: { '(prefers-reduced-motion: reduce)': true } });
  var first = env.window.AppKit.sheet.show(env.makeSheet());
  assert.equal(env.window.AppKit.sheet.show(env.makeSheet()), null);
  assert.equal(env.document.querySelectorAll('.ak-sheet').length, 1);
  first.close();
  assert.ok(env.window.AppKit.sheet.show(env.makeSheet()));
});

test('sheet: focus option gets focus without scrolling', function () {
  var env = sheetEnv();
  var input = env.window.AppKit.h('input');
  env.window.AppKit.sheet.show(env.makeSheet(), { focus: input });
  assert.equal(input.focused, true);
  assert.equal(input.focusOptions.preventScroll, true);
});

function drag(head, toY) {
  head.dispatch('pointerdown', { pointerId: 1, button: 0, clientY: 100 });
  head.dispatch('pointermove', { pointerId: 1, clientY: toY });
  head.dispatch('pointerup', { pointerId: 1, clientY: toY });
}

test('sheet: a swipe down of more than 72px on the head closes', function () {
  var env = sheetEnv({ media: { '(prefers-reduced-motion: reduce)': true } });
  var closed = 0;
  var node = env.makeSheet();
  env.window.AppKit.sheet.show(node, { onClose: function () { closed += 1; } });
  drag(node.querySelector('.ak-grabber'), 100 + 80);
  assert.equal(closed, 1);
});

test('sheet: a short drag springs back and does not close', function () {
  var env = sheetEnv();
  var closed = 0;
  var node = env.makeSheet();
  env.window.AppKit.sheet.show(node, { onClose: function () { closed += 1; } });
  var head = node.querySelector('.ak-grabber');
  head.dispatch('pointerdown', { pointerId: 1, button: 0, clientY: 100 });
  head.dispatch('pointermove', { pointerId: 1, clientY: 130 });
  assert.equal(node.style.transform, 'translateY(30px)');
  assert.match(node.className, /\bak-dragging\b/);
  head.dispatch('pointerup', { pointerId: 1, clientY: 130 });
  assert.equal(closed, 0);
  assert.equal(node.style.transform, '');
  assert.doesNotMatch(node.className, /ak-dragging/);
});

test('sheet: opts.head picks the drag handle', function () {
  var env = sheetEnv({ media: { '(prefers-reduced-motion: reduce)': true } });
  var h = env.window.AppKit.h;
  var head = h('div', { class: 'mine' });
  var closed = 0;
  env.window.AppKit.sheet.show(h('div', null, head), { head: head, onClose: function () { closed += 1; } });
  drag(head, 200);
  assert.equal(closed, 1);
});

// ---------- AppKit.nav.syncOverlayHistory ----------

function navEnv() {
  var env = loaded(['ak-nav.js']);
  var layers = [];
  var pops = 0;
  var api = {
    env: env,
    layers: layers,
    pops: function () { return pops; },
    sync: function () {
      env.window.AppKit.nav.syncOverlayHistory({
        depth: function () { return layers.length; },
        onPop: function () { pops += 1; layers.pop(); }
      });
    },
    open: function () { layers.push('x'); api.sync(); },
    // The app closes a layer by itself, not through Back.
    closeByApp: function () { layers.pop(); api.sync(); }
  };
  return api;
}

test('nav: opening layers pushes one history entry each', function () {
  var n = navEnv();
  n.sync();
  assert.equal(n.env.history.length, 1);
  n.open();
  assert.equal(n.env.history.length, 2);
  assert.equal(n.env.history.state.akOverlay, 1);
  n.open();
  assert.equal(n.env.history.length, 3);
  assert.equal(n.env.history.state.akOverlay, 2);
  n.sync();
  assert.equal(n.env.history.length, 3);
});

test('nav: a depth number works as well as a function', function () {
  var env = loaded(['ak-nav.js']);
  env.window.AppKit.nav.syncOverlayHistory({ depth: 2, onPop: function () {} });
  assert.equal(env.history.length, 3);
});

test('nav: the app closing a layer calls history.go(-1) and never onPop', function () {
  var n = navEnv();
  n.open();
  n.open();
  n.closeByApp();
  assert.deepEqual(n.env.pendingGo(), [-1]);
  n.env.landGo();
  assert.equal(n.pops(), 0);
  assert.equal(n.env.historyPosition(), 1);
});

test('nav: several layers closed at once use one go(-n)', function () {
  var n = navEnv();
  n.open();
  n.open();
  n.open();
  n.layers.length = 0;
  n.sync();
  assert.deepEqual(n.env.pendingGo(), [-3]);
  n.env.landGo();
  assert.equal(n.pops(), 0);
  assert.equal(n.env.historyPosition(), 0);
});

test('nav: Back while a layer is open calls onPop once', function () {
  var n = navEnv();
  n.open();
  n.env.pressBack();
  assert.equal(n.pops(), 1);
  assert.equal(n.layers.length, 0);
  assert.deepEqual(n.env.pendingGo(), []);
});

test('nav: Back with two layers closes the top one and keeps the other entry', function () {
  var n = navEnv();
  n.open();
  n.open();
  n.env.pressBack();
  assert.equal(n.pops(), 1);
  assert.equal(n.layers.length, 1);
  assert.deepEqual(n.env.pendingGo(), []);
  assert.equal(n.env.historyPosition(), 1);
  n.env.pressBack();
  assert.equal(n.pops(), 2);
  assert.equal(n.env.historyPosition(), 0);
});

test('nav: a sync during a pending go() does not push', function () {
  var n = navEnv();
  n.open();
  n.closeByApp();
  assert.equal(n.env.pendingGo().length, 1);
  var length = n.env.history.length;
  n.open();
  assert.equal(n.env.history.length, length);
  n.env.landGo();
  assert.equal(n.pops(), 0);
  // The popstate caught up: the layer opened meanwhile now has an entry.
  assert.equal(n.layers.length, 1);
  assert.equal(n.env.history.length, 2);
});

test('nav: Back with no layer open does nothing', function () {
  var n = navEnv();
  n.sync();
  n.env.pressBack();
  assert.equal(n.pops(), 0);
});

test('nav: one popstate listener, however often it is called', function () {
  var n = navEnv();
  n.sync();
  n.sync();
  n.open();
  assert.equal(n.env.windowHandlerCount('popstate'), 1);
});

test('nav: a plain number depth drops by one after Back', function () {
  var env = loaded(['ak-nav.js']);
  var pops = 0;
  env.window.AppKit.nav.syncOverlayHistory({ depth: 2, onPop: function () { pops += 1; } });
  env.pressBack();
  assert.equal(pops, 1);
  assert.equal(env.pendingGo().length, 0);
  assert.equal(env.history.length, 3);
});

test('nav: no history API means no throw', function () {
  var env = loaded(['ak-nav.js'], { noHistory: true });
  env.window.AppKit.nav.syncOverlayHistory({ depth: 1, onPop: function () {} });
  assert.equal(env.windowHandlerCount('popstate'), 0);
});

// ---------- CSS lint ----------

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

// Returns the selector lists of every rule, with @media-style blocks unwrapped.
function selectorsOf(css) {
  var out = [];
  var text = stripComments(css);
  var buffer = '';
  var stack = [];
  for (var i = 0; i < text.length; i++) {
    var ch = text[i];
    if (ch === '{') {
      var head = buffer.trim();
      buffer = '';
      var isAt = head.charAt(0) === '@';
      stack.push(isAt ? 'at' : 'rule');
      if (!isAt && stack.indexOf('keyframes') < 0 && stack.filter(function (s) { return s === 'keyframes'; }).length === 0) {
        out.push(head);
      }
      if (isAt && /^@(-\w+-)?keyframes/.test(head)) stack[stack.length - 1] = 'keyframes';
    } else if (ch === '}') {
      stack.pop();
      buffer = '';
    } else if (ch === ';') {
      buffer = '';
    } else {
      buffer += ch;
    }
  }
  // Rules inside @keyframes (from, to, 50%) are not selectors we care about.
  return out.filter(function (s) { return !/^(from|to|[\d.]+%)(\s*,\s*(from|to|[\d.]+%))*$/.test(s); });
}

// Splits "a, b" at top-level commas, not those inside (), [].
function splitList(list) {
  var parts = [];
  var depth = 0;
  var cur = '';
  for (var i = 0; i < list.length; i++) {
    var ch = list[i];
    if (ch === '(' || ch === '[') depth += 1;
    if (ch === ')' || ch === ']') depth -= 1;
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else { cur += ch; }
  }
  parts.push(cur);
  return parts.map(function (p) { return p.trim(); }).filter(Boolean);
}

// Removes (…) groups after pseudo-classes and […] groups, to look at the plain compounds.
function simplify(selector) {
  var s = selector;
  var prev;
  do {
    prev = s;
    s = s.replace(/\[[^\[\]]*\]/g, '').replace(/:[\w-]+\([^()]*\)/g, '');
  } while (s !== prev);
  return s.replace(/::?[\w-]+/g, '');
}

var ELEMENT_ROOTS = ['html'];

function lint(css) {
  var problems = [];
  selectorsOf(css).forEach(function (list) {
    splitList(list).forEach(function (selector) {
      // Classes anywhere, including inside :where(...) and :not(...).
      (selector.match(/\.-?[A-Za-z_][\w-]*/g) || []).forEach(function (cls) {
        var name = cls.slice(1);
        if (name.indexOf('ak-') !== 0 && name !== 'eink') problems.push('class ' + cls + ' in "' + selector + '"');
      });
      // Bare element types as a compound's type selector.
      var plain = simplify(selector);
      plain.split(/[\s>+~]+/).filter(Boolean).forEach(function (compound, index) {
        var m = /^([A-Za-z][\w-]*)/.exec(compound);
        if (!m) return;
        var tag = m[1].toLowerCase();
        var firstOfSelector = index === 0;
        if (firstOfSelector && ELEMENT_ROOTS.indexOf(tag) >= 0 && /\.(eink|ak-sheet-open)\b/.test(compound)) return;
        // "html.eink .ak-x" and "html.ak-sheet-open body" are the two allowed roots.
        var root = plain.trim().split(/[\s>+~]+/)[0];
        if (/^html\.(eink|ak-sheet-open)\b/.test(root)) {
          if (tag === 'html') return;
          if (tag === 'body' && /^html\.ak-sheet-open/.test(root)) return;
        }
        // A tag that carries an ak- class is fine: textarea.ak-input style qualifiers are not.
        problems.push('element selector "' + tag + '" in "' + selector + '"');
      });
    });
  });
  return problems;
}

test('css lint: ak-components.css has no non-ak class and no bare element selector', function () {
  var css = fs.readFileSync(path.join(ROOT, 'frontend', 'ak-components.css'), 'utf8');
  assert.deepEqual(lint(css), []);
});

test('css lint: the checker catches the mistakes it is for', function () {
  assert.ok(lint('button { color: red; }').length > 0);
  assert.ok(lint('.ak-segment button { color: red; }').length > 0);
  assert.ok(lint('.row { color: red; }').length > 0);
  assert.ok(lint('textarea.ak-input { color: red; }').length > 0);
  assert.ok(lint('.ak-a:where(.other) { color: red; }').length > 0);
  assert.ok(lint('html.eink p { color: red; }').length > 0);
  assert.deepEqual(lint('/* button { } */ .ak-a:hover::before { color: red; }'), []);
  assert.deepEqual(lint('@media (x) { :where(.ak-a, .ak-b):where(:active) { top: 0; } }'), []);
  assert.deepEqual(lint('html.eink .ak-a { top: 0; } html.ak-sheet-open body { top: 0; }'), []);
});

test('css lint: no frontend css other than ak-base.css scopes under html.ak-base', function () {
  var css = fs.readFileSync(path.join(ROOT, 'frontend', 'ak-components.css'), 'utf8');
  assert.doesNotMatch(stripComments(css), /html\.ak-base/);
});

test('css: ak-base.css scopes every rule under html.ak-base', function () {
  var css = fs.readFileSync(path.join(ROOT, 'frontend', 'ak-base.css'), 'utf8');
  selectorsOf(css).forEach(function (list) {
    splitList(list).forEach(function (selector) {
      assert.match(selector, /^html\.ak-base\b/, selector);
    });
  });
});

test('css: the tokens file defines the contract names', function () {
  var css = fs.readFileSync(path.join(ROOT, 'frontend', 'ak-tokens.css'), 'utf8');
  ['--ak-accent', '--ak-accent-2', '--ak-accent-strong', '--ak-accent-ink', '--ak-font',
    '--ak-font-article', '--ak-ink', '--ak-line', '--ak-safe-top', '--ak-safe-right',
    '--ak-safe-bottom', '--ak-safe-left', '--ak-tab', '--ak-s35', '--ak-radius-hero',
    '--ak-ease-spring'].forEach(function (name) {
    assert.match(css, new RegExp(name + ':'), name);
  });
  assert.match(css, /html\[data-ak-scheme="dark"\]/);
  assert.match(css, /html\[data-ak-scheme="light"\]/);
  // Forced schemes come after the media query, so they win.
  assert.ok(css.indexOf('html[data-ak-scheme="light"]') > css.indexOf('prefers-color-scheme: light'));
});

// ---------- Contrast (WCAG 2.x) ----------

function readFrontend(name) {
  return stripComments(fs.readFileSync(path.join(ROOT, 'frontend', name), 'utf8'));
}

// The text between the first "{" at or after "from" and its matching "}".
function blockFrom(css, from) {
  var open = css.indexOf('{', from);
  assert.ok(open >= 0, 'no block after index ' + from);
  var depth = 0;
  for (var i = open; i < css.length; i++) {
    if (css[i] === '{') depth += 1;
    if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  throw new Error('unbalanced block');
}

function blockAfter(css, marker, afterMarker) {
  var start = css.indexOf(marker);
  assert.ok(start >= 0, 'missing ' + marker);
  if (afterMarker) {
    start = css.indexOf(afterMarker, start);
    assert.ok(start >= 0, 'missing ' + afterMarker);
  }
  return blockFrom(css, start);
}

// Hex colour declarations of a block: { '--ak-muted': '#636366', ... }.
function hexTokens(block) {
  var out = {};
  var re = /(--ak-[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g;
  var m;
  while ((m = re.exec(block))) out[m[1]] = m[2].toLowerCase();
  return out;
}

function channel(v) {
  var c = v / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function luminance(hex) {
  var n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

function contrast(a, b) {
  var x = luminance(a);
  var y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

var TOKENS_CSS = readFrontend('ak-tokens.css');
var SCHEMES = {
  'dark (:root)': hexTokens(blockAfter(TOKENS_CSS, ':root {')),
  'dark (data-ak-scheme)': hexTokens(blockAfter(TOKENS_CSS, 'html[data-ak-scheme="dark"]')),
  'light (media)': hexTokens(blockAfter(TOKENS_CSS, '@media (prefers-color-scheme: light)', ':root')),
  'light (data-ak-scheme)': hexTokens(blockAfter(TOKENS_CSS, 'html[data-ak-scheme="light"]'))
};

test('contrast: the helper matches known WCAG values', function () {
  assert.equal(contrast('#000000', '#ffffff').toFixed(2), '21.00');
  assert.equal(contrast('#8e8e93', '#ffffff').toFixed(2), '3.26');
  assert.equal(contrast('#ffffff', '#ff2d78').toFixed(2), '3.56');
});

test('contrast: all four colour blocks were parsed', function () {
  Object.keys(SCHEMES).forEach(function (name) {
    ['--ak-bg', '--ak-text', '--ak-muted', '--ak-danger', '--ak-accent', '--ak-accent-strong',
      '--ak-accent-ink', '--ak-surface', '--ak-surface-2', '--ak-surface-3', '--ak-panel'].forEach(function (token) {
      assert.match(SCHEMES[name][token] || '', /^#[0-9a-f]{6}$/, name + ' ' + token);
    });
  });
});

test('contrast: the two copies of each scheme hold the same colours', function () {
  assert.deepEqual(SCHEMES['dark (data-ak-scheme)'], SCHEMES['dark (:root)']);
  assert.deepEqual(SCHEMES['light (data-ak-scheme)'], SCHEMES['light (media)']);
});

test('contrast: text, muted and danger reach 4.5:1 on every surface, in every colour block', function () {
  Object.keys(SCHEMES).forEach(function (name) {
    var t = SCHEMES[name];
    ['--ak-text', '--ak-muted', '--ak-danger'].forEach(function (fg) {
      ['--ak-bg', '--ak-surface', '--ak-surface-2', '--ak-surface-3', '--ak-panel'].forEach(function (bg) {
        var ratio = contrast(t[fg], t[bg]);
        assert.ok(ratio >= 4.5, name + ': ' + fg + ' ' + t[fg] + ' on ' + bg + ' ' + t[bg] + ' is ' + ratio.toFixed(2));
      });
    });
  });
});

test('contrast: accent ink reaches 4.5:1 on the accent fills, in every colour block', function () {
  Object.keys(SCHEMES).forEach(function (name) {
    var t = SCHEMES[name];
    ['--ak-accent', '--ak-accent-strong'].forEach(function (fill) {
      var ratio = contrast(t['--ak-accent-ink'], t[fill]);
      assert.ok(ratio >= 4.5, name + ': accent-ink on ' + fill + ' ' + t[fill] + ' is ' + ratio.toFixed(2));
    });
  });
});

// The declaration block of a rule with exactly this selector list.
function ruleBody(css, selector) {
  var escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/,\s*/g, ',\\s*');
  var m = new RegExp('(?:^|})\\s*' + escaped + '\\s*\\{([^}]*)\\}').exec(css);
  assert.ok(m, 'no rule for ' + selector);
  return m[1];
}

// The token a property points at, e.g. "background: var(--ak-surface-2)".
function tokenOf(body, property, selector) {
  var m = new RegExp('(?:^|[;\\s])' + property + '\\s*:\\s*var\\((--ak-[\\w-]+)\\)').exec(body);
  assert.ok(m, selector + ' has no ' + property + ' token');
  return m[1];
}

test('contrast: toast text, default and error, reaches 4.5:1 on the toast background', function () {
  var css = readFrontend('ak-components.css');
  var bgToken = tokenOf(ruleBody(css, '.ak-toast'), 'background', '.ak-toast');
  var plainToken = tokenOf(ruleBody(css, '.ak-toast'), 'color', '.ak-toast');
  var errorSelector = '.ak-toast-error, .ak-toast-danger';
  var errorToken = tokenOf(ruleBody(css, errorSelector), 'color', errorSelector);
  Object.keys(SCHEMES).forEach(function (name) {
    var t = SCHEMES[name];
    var bg = t[bgToken];
    assert.ok(bg, name + ': ' + bgToken + ' is not a hex token');
    [plainToken, errorToken].forEach(function (token) {
      var ratio = contrast(t[token], bg);
      assert.ok(ratio >= 4.5, name + ': toast ' + token + ' ' + t[token] + ' on ' + bg + ' is ' + ratio.toFixed(2));
    });
  });
});

// ---------- Z-order ----------

// The z-index of a rule. A var(--ak-z-x, n) is read from the tokens file.
function zOf(css, selector) {
  var body = ruleBody(css, selector);
  var decl = /(?:^|[;\s])z-index\s*:\s*([^;]+?)\s*(?:;|$)/.exec(body);
  assert.ok(decl, selector + ' has no z-index');
  var value = decl[1];
  var v = /^var\((--ak-z-[\w-]+)\s*(?:,\s*(\d+))?\)$/.exec(value);
  if (!v) {
    assert.match(value, /^\d+$/, selector + ' z-index ' + value);
    return Number(value);
  }
  var token = new RegExp(v[1] + '\\s*:\\s*(\\d+)\\s*;').exec(TOKENS_CSS);
  if (token) {
    if (v[2] !== undefined) assert.equal(Number(v[2]), Number(token[1]), v[1] + ' fallback matches the token');
    return Number(token[1]);
  }
  assert.ok(v[2] !== undefined, v[1] + ' is not defined and has no fallback');
  return Number(v[2]);
}

test('z-order: the sheet layer is above the tab bar, and the toast is above both', function () {
  var css = readFrontend('ak-components.css');
  var tabbar = zOf(css, '.ak-tabbar');
  var layer = zOf(css, '.ak-sheet-layer');
  var toast = zOf(css, '.ak-toast');
  assert.ok(layer > tabbar, 'sheet layer ' + layer + ' must be above tab bar ' + tabbar);
  assert.ok(toast > layer, 'toast ' + toast + ' must be above sheet layer ' + layer);
});

test('z-order: inside the layer the scrim is under the sheet', function () {
  var css = readFrontend('ak-components.css');
  assert.ok(zOf(css, '.ak-sheet') > zOf(css, '.ak-scrim'));
  assert.ok(zOf(css, '.ak-scrim') > 0);
});

test('z-order: the z tokens keep the order tab bar < sheet layer < toast', function () {
  function token(name) {
    var m = new RegExp(name + '\\s*:\\s*(\\d+)\\s*;').exec(TOKENS_CSS);
    assert.ok(m, 'missing ' + name);
    return Number(m[1]);
  }
  assert.ok(token('--ak-z-tabbar') < token('--ak-z-sheet-layer'));
  assert.ok(token('--ak-z-sheet-layer') < token('--ak-z-toast'));
  assert.ok(token('--ak-z-scrim') < token('--ak-z-sheet'));
});

// ---------- Tab badge aria ----------

function badgeOf(bar, index) {
  return bar.el.querySelectorAll('.ak-tab')[index].querySelector('.ak-badge');
}

test('tabbar badge: a badge of 3 is named "3 new", and the number is not read twice', function () {
  var env = loaded(['ak-tabbar.js']);
  var bar = env.window.AppKit.tabbar({ tabs: TABS, active: 'now', badge: { alerts: 3 } });
  var badge = badgeOf(bar, 2);
  assert.equal(badge.getAttribute('aria-label'), '3 new');
  assert.equal(badge.getAttribute('role'), 'img');
  assert.equal(badge.textContent, '3');
});

test('tabbar badge: 120 is named "99+ new" and shows 99+', function () {
  var env = loaded(['ak-tabbar.js']);
  var bar = env.window.AppKit.tabbar({ tabs: TABS, active: 'now', badge: { alerts: 120 } });
  assert.equal(badgeOf(bar, 2).getAttribute('aria-label'), '99+ new');
  assert.equal(badgeOf(bar, 2).textContent, '99+');
});

test('tabbar badge: badgeLabel changes the word after the count', function () {
  var env = loaded(['ak-tabbar.js']);
  var bar = env.window.AppKit.tabbar({ tabs: TABS, active: 'now', badge: { alerts: 3, plans: 120 }, badgeLabel: 'unread' });
  assert.equal(badgeOf(bar, 2).getAttribute('aria-label'), '3 unread');
  assert.equal(badgeOf(bar, 1).getAttribute('aria-label'), '99+ unread');
});

test('tabbar badge: an empty badgeLabel leaves just the count', function () {
  var env = loaded(['ak-tabbar.js']);
  var bar = env.window.AppKit.tabbar({ tabs: TABS, active: 'now', badge: { alerts: 3 }, badgeLabel: '' });
  assert.equal(badgeOf(bar, 2).getAttribute('aria-label'), '3');
});

test('tabbar badge: custom text is its own label, and shows as before', function () {
  var env = loaded(['ak-tabbar.js']);
  var bar = env.window.AppKit.tabbar({
    tabs: TABS,
    active: 'now',
    badge: function (id) { return id === 'plans' ? 'new' : null; }
  });
  assert.equal(badgeOf(bar, 1).textContent, 'new');
  assert.equal(badgeOf(bar, 1).getAttribute('aria-label'), 'new');
});

test('tabbar badge: update refreshes the label, and no badge leaves no label', function () {
  var env = loaded(['ak-tabbar.js']);
  var bar = env.window.AppKit.tabbar({ tabs: TABS, active: 'now', badge: { alerts: 3 } });
  assert.equal(badgeOf(bar, 2).getAttribute('aria-label'), '3 new');
  bar.update({ badge: { alerts: 7 } });
  assert.equal(badgeOf(bar, 2).getAttribute('aria-label'), '7 new');
  bar.update({ badge: { alerts: 150 } });
  assert.equal(badgeOf(bar, 2).getAttribute('aria-label'), '99+ new');
  bar.update({ badge: { alerts: 0 } });
  assert.equal(badgeOf(bar, 2), null);
  assert.equal(bar.el.querySelectorAll('[aria-label]').length, 0);
  bar.update({ badge: { alerts: 2 } });
  assert.equal(badgeOf(bar, 2).getAttribute('aria-label'), '2 new');
});

test('tabbar badge: no badge at the start means no label in the tabs', function () {
  var env = loaded(['ak-tabbar.js']);
  var bar = env.window.AppKit.tabbar({ tabs: TABS, active: 'now' });
  assert.equal(bar.el.querySelectorAll('.ak-badge').length, 0);
  assert.equal(bar.el.querySelectorAll('[aria-label]').length, 0);
});
