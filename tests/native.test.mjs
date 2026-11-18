import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEnv } from './helpers/fake-dom.mjs';

var ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
var REDUCED = { '(prefers-reduced-motion: reduce)': true };

function tick() {
  return new Promise(function (resolve) { setImmediate(resolve); });
}

function loaded(files, options) {
  var env = createEnv(options);
  files.forEach(function (f) { env.load(f); });
  return env;
}

function native(options) {
  return loaded(['ak-native.js'], options);
}

// ---------- load ----------

test('native: loading adds one passive no-op touchstart listener and nothing else', function () {
  var env = native();
  assert.equal(env.docHandlerCount('touchstart'), 1);
  assert.equal(env.docHandlerCount('touchmove'), 0);
  assert.equal(env.windowHandlerCount('scroll'), 0);
  assert.equal(env.body.children.length, 0);
  assert.equal(env.html.className, '');
  env.fireDocument('touchstart', { touches: [] });
  assert.equal(typeof env.window.AppKit.scroll.memory, 'function');
  assert.equal(typeof env.window.AppKit.scroll.toTop, 'function');
  assert.equal(typeof env.window.AppKit.largeTitle, 'function');
  assert.equal(typeof env.window.AppKit.pullToRefresh, 'function');
});

test('native: loading twice keeps one listener', function () {
  var env = native();
  env.load('ak-native.js');
  assert.equal(env.docHandlerCount('touchstart'), 1);
});

// ---------- largeTitle ----------

function FakeObserver() {
  var self = { observed: [], disconnected: false, options: null, callback: null };
  function Observer(callback, options) {
    self.callback = callback;
    self.options = options;
    this.observe = function (el) { self.observed.push(el); };
    this.disconnect = function () { self.disconnected = true; };
  }
  Observer.state = self;
  return Observer;
}

function titleEnv(options) {
  var env = native(options);
  var navbar = env.document.createElement('header');
  navbar.className = 'ak-navbar';
  var title = env.document.createElement('h1');
  title.className = 'ak-large-title';
  env.body.appendChild(navbar);
  env.body.appendChild(title);
  return { env: env, navbar: navbar, title: title };
}

test('largeTitle: with IntersectionObserver, ak-collapsed follows the large title', function () {
  var t = titleEnv();
  var Observer = FakeObserver();
  t.env.window.IntersectionObserver = Observer;
  var handle = t.env.window.AppKit.largeTitle(t.title);
  assert.deepEqual(Observer.state.observed, [t.title]);
  assert.match(Observer.state.options.rootMargin, /^-44px /);

  // Scrolled under the navbar: not intersecting, bottom above the root top.
  Observer.state.callback([{ isIntersecting: false, boundingClientRect: { bottom: 10 }, rootBounds: { top: 44 } }]);
  assert.match(t.navbar.className, /\bak-collapsed\b/);
  Observer.state.callback([{ isIntersecting: true, boundingClientRect: { bottom: 100 }, rootBounds: { top: 44 } }]);
  assert.doesNotMatch(t.navbar.className, /ak-collapsed/);

  // Not intersecting because it is below the fold: not collapsed.
  Observer.state.callback([{ isIntersecting: false, boundingClientRect: { bottom: 900 }, rootBounds: { top: 44 } }]);
  assert.doesNotMatch(t.navbar.className, /ak-collapsed/);

  handle.destroy();
  assert.equal(Observer.state.disconnected, true);
});

test('largeTitle: it finds the nearest previous .ak-navbar, and opts.navbar overrides', function () {
  var t = titleEnv();
  var other = t.env.document.createElement('header');
  other.className = 'ak-navbar';
  t.env.body.insertBefore(other, t.env.body.firstChild);
  var Observer = FakeObserver();
  t.env.window.IntersectionObserver = Observer;
  t.env.window.AppKit.largeTitle(t.title);
  Observer.state.callback([{ isIntersecting: false, boundingClientRect: { bottom: 0 }, rootBounds: { top: 44 } }]);
  assert.match(t.navbar.className, /ak-collapsed/);
  assert.doesNotMatch(other.className, /ak-collapsed/);

  var t2 = titleEnv();
  var O2 = FakeObserver();
  t2.env.window.IntersectionObserver = O2;
  var mine = t2.env.document.createElement('div');
  t2.env.window.AppKit.largeTitle(t2.title, { navbar: mine });
  O2.state.callback([{ isIntersecting: false, boundingClientRect: { bottom: 0 }, rootBounds: { top: 44 } }]);
  assert.match(mine.className, /ak-collapsed/);
});

test('largeTitle: falls back to document.querySelector when the navbar is not a sibling', function () {
  var env = native();
  var navbar = env.document.createElement('header');
  navbar.className = 'ak-navbar';
  var wrap = env.document.createElement('main');
  var title = env.document.createElement('h1');
  wrap.appendChild(title);
  env.body.appendChild(navbar);
  env.body.appendChild(wrap);
  var Observer = FakeObserver();
  env.window.IntersectionObserver = Observer;
  env.window.AppKit.largeTitle(title);
  Observer.state.callback([{ isIntersecting: false, boundingClientRect: { bottom: 0 }, rootBounds: { top: 44 } }]);
  assert.match(navbar.className, /ak-collapsed/);
});

test('largeTitle: without IntersectionObserver a passive scroll listener on the window does it', function () {
  var t = titleEnv();
  t.navbar.rect = { top: 0, bottom: 44 };
  t.title.rect = { top: 60, bottom: 100 };
  var handle = t.env.window.AppKit.largeTitle(t.title);
  assert.equal(t.env.windowHandlerCount('scroll'), 1);
  assert.doesNotMatch(t.navbar.className, /ak-collapsed/);

  t.title.rect = { top: -10, bottom: 30 };
  t.env.fireWindow('scroll');
  t.env.fireWindow('scroll');
  assert.equal(t.env.pendingFrames(), 1, 'one measure per frame');
  t.env.flushFrames();
  assert.match(t.navbar.className, /\bak-collapsed\b/);

  t.title.rect = { top: 60, bottom: 100 };
  t.env.fireWindow('scroll');
  t.env.flushFrames();
  assert.doesNotMatch(t.navbar.className, /ak-collapsed/);

  handle.destroy();
  assert.equal(t.env.windowHandlerCount('scroll'), 0);
});

test('largeTitle: the scroll fallback listens on opts.scroller when given', function () {
  var t = titleEnv();
  var scroller = t.env.document.createElement('div');
  t.env.body.appendChild(scroller);
  var handle = t.env.window.AppKit.largeTitle(t.title, { scroller: scroller });
  assert.equal(scroller.listeners.scroll.length, 1);
  assert.equal(t.env.windowHandlerCount('scroll'), 0);
  handle.destroy();
  assert.equal(scroller.listeners.scroll.length, 0);
});

test('largeTitle: no title or no navbar gives an inert handle', function () {
  var env = native();
  var handle = env.window.AppKit.largeTitle(null);
  assert.doesNotThrow(function () { handle.destroy(); });
  var title = env.document.createElement('h1');
  env.body.appendChild(title);
  assert.doesNotThrow(function () { env.window.AppKit.largeTitle(title).destroy(); });
});

// ---------- scroll.memory and toTop ----------

test('scroll.memory: save, restore and forget, in memory and in sessionStorage', function () {
  var env = native();
  var mem = env.window.AppKit.scroll.memory();
  env.html.scrollTop = 320;
  assert.equal(mem.save('home'), 320);
  assert.equal(env.window.sessionStorage.getItem('ak-scroll:home'), '320');
  env.html.scrollTop = 0;
  assert.equal(mem.restore('home'), 320);
  assert.equal(env.html.scrollTop, 320);
  mem.forget('home');
  assert.equal(env.window.sessionStorage.getItem('ak-scroll:home'), null);
  assert.equal(mem.restore('home'), 0);
  assert.equal(env.html.scrollTop, 0);
});

test('scroll.memory: an unknown key restores 0', function () {
  var env = native();
  env.html.scrollTop = 99;
  assert.equal(env.window.AppKit.scroll.memory().restore('nope'), 0);
  assert.equal(env.html.scrollTop, 0);
});

test('scroll.memory: opts.el is the scroller, and keys are kept apart', function () {
  var env = native();
  var list = env.document.createElement('div');
  var mem = env.window.AppKit.scroll.memory({ el: list });
  list.scrollTop = 40;
  mem.save('a');
  list.scrollTop = 90;
  mem.save('b');
  mem.restore('a');
  assert.equal(list.scrollTop, 40);
  mem.restore('b');
  assert.equal(list.scrollTop, 90);
  assert.equal(env.html.scrollTop, 0);
});

test('scroll.memory: a new memory reads what sessionStorage kept', function () {
  var env = native();
  env.html.scrollTop = 75;
  env.window.AppKit.scroll.memory().save('k');
  env.html.scrollTop = 0;
  assert.equal(env.window.AppKit.scroll.memory().restore('k'), 75);
});

test('scroll.memory: a throwing sessionStorage still works from memory', function () {
  var env = native();
  env.window.sessionStorage = {
    getItem: function () { throw new Error('denied'); },
    setItem: function () { throw new Error('denied'); },
    removeItem: function () { throw new Error('denied'); }
  };
  var mem = env.window.AppKit.scroll.memory();
  env.html.scrollTop = 12;
  assert.doesNotThrow(function () { mem.save('x'); });
  env.html.scrollTop = 0;
  assert.equal(mem.restore('x'), 12);
  assert.doesNotThrow(function () { mem.forget('x'); });
  assert.equal(mem.restore('never'), 0);
});

test('scroll.memory: a bad stored value counts as unknown', function () {
  var env = native();
  env.window.sessionStorage.setItem('ak-scroll:bad', 'abc');
  assert.equal(env.window.AppKit.scroll.memory().restore('bad'), 0);
});

test('scroll.toTop: smooth by default, instant with smooth false or reduced motion', function () {
  var env = native();
  var el = env.document.createElement('div');
  el.scrollTop = 500;
  env.window.AppKit.scroll.toTop(el);
  assert.equal(el.scrollCalls[0].top, 0);
  assert.equal(el.scrollCalls[0].behavior, 'smooth');
  env.window.AppKit.scroll.toTop(el, { smooth: false });
  assert.equal(el.scrollCalls[1].behavior, 'auto');

  var reduced = native({ media: REDUCED });
  var box = reduced.document.createElement('div');
  reduced.window.AppKit.scroll.toTop(box);
  assert.equal(box.scrollCalls[0].behavior, 'auto');
});

test('scroll.toTop: no element means the page', function () {
  var env = native();
  env.html.scrollTop = 800;
  env.window.AppKit.scroll.toTop();
  assert.equal(env.html.scrollTop, 0);
  assert.equal(env.html.scrollCalls.length, 1);
});

// ---------- tabbar ----------

var TABS = [
  { id: 'now', label: 'Now' },
  { id: 'plans', label: 'Plans' },
  { id: 'alerts', label: 'Alerts' }
];

function barEnv(files, barOptions, envOptions) {
  var env = loaded(files, envOptions);
  var picked = [];
  var reselected = [];
  var o = { tabs: TABS, active: 'now', onSelect: function (id) { picked.push(id); }, onReselect: function (id) { reselected.push(id); } };
  Object.keys(barOptions || {}).forEach(function (k) { o[k] = barOptions[k]; });
  var bar = env.window.AppKit.tabbar(o);
  env.body.appendChild(bar.el);
  return { env: env, bar: bar, picked: picked, reselected: reselected, tab: function (i) { return bar.el.querySelectorAll('.ak-tab')[i]; } };
}

test('tabbar: onReselect fires only for the active tab, and onSelect still fires for it', function () {
  var t = barEnv(['ak-tabbar.js']);
  t.tab(1).click();
  assert.deepEqual(t.picked, ['plans']);
  assert.deepEqual(t.reselected, []);
  t.tab(0).click();
  assert.deepEqual(t.reselected, ['now']);
  assert.deepEqual(t.picked, ['plans', 'now']);
  t.bar.update({ active: 'plans' });
  t.tab(1).click();
  assert.deepEqual(t.reselected, ['now', 'plans']);
});

test('tabbar: without the new options a tap does nothing extra', function () {
  var env = loaded(['ak-tabbar.js']);
  var picked = [];
  var bar = env.window.AppKit.tabbar({ tabs: TABS, active: 'now', onSelect: function (id) { picked.push(id); } });
  env.body.appendChild(bar.el);
  env.html.scrollTop = 200;
  bar.el.querySelectorAll('.ak-tab')[0].click();
  bar.el.querySelectorAll('.ak-tab')[1].click();
  bar.update({ active: 'plans' });
  assert.deepEqual(picked, ['now', 'plans']);
  assert.equal(env.html.scrollTop, 200);
  assert.equal(env.html.scrollCalls.length, 0);
  assert.equal(env.window.sessionStorage.length, 0);
});

test('tabbar: scrollTopOnReselect scrolls the page to the top without ak-native.js', function () {
  var t = barEnv(['ak-tabbar.js'], { scrollTopOnReselect: true });
  t.env.html.scrollTop = 400;
  t.tab(1).click();
  assert.equal(t.env.html.scrollTop, 400, 'another tab does not scroll');
  t.bar.update({ active: 'plans' });
  t.bar.update({ active: 'now' });
  assert.equal(t.env.html.scrollTop, 400, 'update() alone does not scroll');
  t.tab(0).click();
  assert.equal(t.env.html.scrollTop, 0);
  assert.equal(t.env.html.scrollCalls[0].behavior, 'smooth');
});

test('tabbar: scrollTopOnReselect uses opts.scroller', function () {
  var env = loaded(['ak-tabbar.js']);
  var list = env.document.createElement('div');
  list.scrollTop = 250;
  var bar = env.window.AppKit.tabbar({ tabs: TABS, active: 'now', scrollTopOnReselect: true, scroller: list });
  bar.el.querySelectorAll('.ak-tab')[0].click();
  assert.equal(list.scrollTop, 0);
  assert.equal(env.html.scrollCalls.length, 0);
});

test('tabbar: scrollTopOnReselect uses AppKit.scroll.toTop when ak-native.js is loaded', function () {
  var t = barEnv(['ak-native.js', 'ak-tabbar.js'], { scrollTopOnReselect: true }, { media: REDUCED });
  var calls = 0;
  var original = t.env.window.AppKit.scroll.toTop;
  t.env.window.AppKit.scroll.toTop = function (el, opts) { calls += 1; return original(el, opts); };
  t.env.html.scrollTop = 300;
  t.tab(0).click();
  assert.equal(calls, 1);
  assert.equal(t.env.html.scrollTop, 0);
  assert.equal(t.env.html.scrollCalls[0].behavior, 'auto', 'reduced motion is respected');
});

function rememberRoundTrip(files) {
  var t = barEnv(files, { rememberScroll: true });
  var env = t.env;
  env.html.scrollTop = 300;       // reading "now"
  t.tab(1).click();               // the app switches to "plans"
  env.html.scrollTop = 0;         // the app drew the new tab
  t.bar.update({ active: 'plans' });
  assert.equal(env.html.scrollTop, 0, 'plans was never scrolled');
  env.html.scrollTop = 50;
  t.tab(0).click();
  env.html.scrollTop = 0;
  t.bar.update({ active: 'now' });
  assert.equal(env.html.scrollTop, 300, 'now comes back where it was');
  t.tab(1).click();
  t.bar.update({ active: 'plans' });
  assert.equal(env.html.scrollTop, 50, 'and so does plans');
  return t;
}

test('tabbar: rememberScroll restores each tab (internal map)', function () {
  var t = rememberRoundTrip(['ak-tabbar.js']);
  assert.equal(t.env.window.sessionStorage.length, 0);
});

test('tabbar: rememberScroll restores each tab through AppKit.scroll.memory', function () {
  var t = rememberRoundTrip(['ak-native.js', 'ak-tabbar.js']);
  assert.equal(t.env.window.sessionStorage.getItem('ak-scroll:tab:now'), '300');
});

test('tabbar: rememberScroll saves the old tab when the app changes active without a tap', function () {
  var env = loaded(['ak-tabbar.js']);
  var bar = env.window.AppKit.tabbar({ tabs: TABS, active: 'now', rememberScroll: true });
  env.html.scrollTop = 120;
  bar.update({ active: 'alerts' });
  assert.equal(env.html.scrollTop, 0);
  bar.update({ active: 'now' });
  assert.equal(env.html.scrollTop, 120);
});

test('tabbar: rememberScroll uses opts.scroller', function () {
  var env = loaded(['ak-tabbar.js']);
  var list = env.document.createElement('div');
  var bar = env.window.AppKit.tabbar({ tabs: TABS, active: 'now', rememberScroll: true, scroller: list });
  list.scrollTop = 77;
  bar.update({ active: 'plans' });
  list.scrollTop = 5;
  bar.update({ active: 'now' });
  assert.equal(list.scrollTop, 77);
  assert.equal(env.html.scrollTop, 0);
});

test('tabbar: a badge update does not touch the scroll position', function () {
  var env = loaded(['ak-tabbar.js']);
  var bar = env.window.AppKit.tabbar({ tabs: TABS, active: 'now', rememberScroll: true });
  env.html.scrollTop = 33;
  bar.update({ badge: { alerts: 2 } });
  bar.update({ active: 'now' });
  assert.equal(env.html.scrollTop, 33);
});

// ---------- pullToRefresh ----------

function touch(y, x) {
  return { clientX: x === undefined ? 100 : x, clientY: y };
}

function pull(env, from, to, extra) {
  var prevented = 0;
  env.fireDocument('touchstart', { touches: [touch(from)] });
  var steps = [from + (to - from) / 2, to];
  steps.forEach(function (y) {
    env.fireDocument('touchmove', {
      touches: [touch(y, (extra && extra.x) || 100)],
      cancelable: true,
      preventDefault: function () { prevented += 1; }
    });
  });
  return { prevented: prevented };
}

function release(env) {
  env.fireDocument('touchend', { touches: [] });
}

function ptrEnv(refresh, options) {
  var env = native(options);
  var calls = 0;
  var handle = env.window.AppKit.pullToRefresh({
    threshold: 64,
    onRefresh: function () { calls += 1; return refresh ? refresh() : undefined; }
  });
  return { env: env, handle: handle, calls: function () { return calls; }, ptr: function () { return env.document.querySelector('.ak-ptr'); } };
}

function deferred() {
  var d = {};
  d.promise = new Promise(function (resolve, reject) { d.resolve = resolve; d.reject = reject; });
  return d;
}

test('pullToRefresh: needs onRefresh', function () {
  var env = native();
  assert.throws(function () { env.window.AppKit.pullToRefresh({}); }, /onRefresh must be a function/);
});

test('pullToRefresh: sets overscroll-behavior-y contain while bound, restores it on destroy', function () {
  var env = native();
  env.html.style.overscrollBehaviorY = 'auto';
  var handle = env.window.AppKit.pullToRefresh({ onRefresh: function () {} });
  assert.equal(env.html.style.overscrollBehaviorY, 'contain');
  handle.destroy();
  assert.equal(env.html.style.overscrollBehaviorY, 'auto');

  var el = env.document.createElement('div');
  var h2 = env.window.AppKit.pullToRefresh({ el: el, onRefresh: function () {} });
  assert.equal(el.style.overscrollBehaviorY, 'contain');
  h2.destroy();
  assert.equal(el.style.overscrollBehaviorY, '');
});

test('pullToRefresh: no start when the scroller is scrolled', function () {
  var p = ptrEnv();
  p.env.html.scrollTop = 120;
  var result = pull(p.env, 100, 300);
  release(p.env);
  assert.equal(p.calls(), 0);
  assert.equal(p.ptr(), null);
  assert.equal(result.prevented, 0, 'the page scrolls as usual');
});

test('pullToRefresh: an upward gesture and a sideways one do not start', function () {
  var p = ptrEnv();
  pull(p.env, 300, 100);
  release(p.env);
  assert.equal(p.ptr(), null);
  p.env.fireDocument('touchstart', { touches: [touch(100, 20)] });
  p.env.fireDocument('touchmove', { touches: [touch(110, 200)], cancelable: true, preventDefault: function () {} });
  release(p.env);
  assert.equal(p.ptr(), null);
  assert.equal(p.calls(), 0);
});

test('pullToRefresh: a release under the threshold does not refresh and hides the indicator', function () {
  var p = ptrEnv();
  var result = pull(p.env, 100, 150);
  assert.ok(result.prevented > 0, 'the pull stops the page from scrolling');
  assert.ok(p.ptr());
  assert.match(p.ptr().className, /ak-ptr-pulling/);
  release(p.env);
  assert.equal(p.calls(), 0);
  assert.doesNotMatch(p.ptr().className, /ak-ptr-loading|ak-ptr-pulling/);
  assert.equal(p.ptr().style['--ak-ptr-y'], '0px');
});

test('pullToRefresh: the indicator follows with resistance', function () {
  var p = ptrEnv();
  p.env.fireDocument('touchstart', { touches: [touch(100)] });
  p.env.fireDocument('touchmove', { touches: [touch(140)], cancelable: true, preventDefault: function () {} });
  assert.equal(p.ptr().style['--ak-ptr-y'], '20px');
  assert.equal(p.ptr().style['--ak-ptr-progress'], String(40 / 64));
  p.env.fireDocument('touchmove', { touches: [touch(1000)], cancelable: true, preventDefault: function () {} });
  assert.equal(p.ptr().style['--ak-ptr-y'], '80px', 'capped');
});

test('pullToRefresh: past the threshold, onRefresh runs once and ak-ptr-loading stays until it settles', async function () {
  var d = deferred();
  var p = ptrEnv(function () { return d.promise; });
  pull(p.env, 100, 200);
  release(p.env);
  assert.equal(p.calls(), 1);
  assert.match(p.ptr().className, /\bak-ptr-loading\b/);
  await tick();
  assert.match(p.ptr().className, /\bak-ptr-loading\b/, 'still loading');
  d.resolve();
  await tick();
  assert.doesNotMatch(p.ptr().className, /ak-ptr-loading/);
  assert.equal(p.ptr().style['--ak-ptr-y'], '0px');
});

test('pullToRefresh: a rejected refresh hides the indicator too', async function () {
  var d = deferred();
  var p = ptrEnv(function () { return d.promise; });
  pull(p.env, 100, 200);
  release(p.env);
  d.reject(new Error('offline'));
  await tick();
  assert.doesNotMatch(p.ptr().className, /ak-ptr-loading/);
});

test('pullToRefresh: a throwing onRefresh does not leave it loading', function () {
  var p = ptrEnv(function () { throw new Error('sync'); });
  pull(p.env, 100, 200);
  assert.doesNotThrow(function () { release(p.env); });
  assert.doesNotMatch(p.ptr().className, /ak-ptr-loading/);
});

test('pullToRefresh: a plain return value (no Promise) ends the loading state at once', function () {
  var p = ptrEnv();
  pull(p.env, 100, 200);
  release(p.env);
  assert.equal(p.calls(), 1);
  assert.doesNotMatch(p.ptr().className, /ak-ptr-loading/);
});

test('pullToRefresh: a second refresh cannot start while one runs, and can after', async function () {
  var d = deferred();
  var p = ptrEnv(function () { return d.promise; });
  pull(p.env, 100, 200);
  release(p.env);
  pull(p.env, 100, 220);
  release(p.env);
  assert.equal(p.calls(), 1);
  d.resolve();
  await tick();
  var d2 = deferred();
  p.calls();
  pull(p.env, 100, 200);
  release(p.env);
  assert.equal(p.calls(), 2);
  d2.resolve();
});

test('pullToRefresh: touchcancel hides the indicator without refreshing', function () {
  var p = ptrEnv();
  pull(p.env, 100, 200);
  p.env.fireDocument('touchcancel', { touches: [] });
  assert.equal(p.calls(), 0);
  assert.doesNotMatch(p.ptr().className, /ak-ptr-pulling/);
});

test('pullToRefresh: opts.el is the scroller, and it checks that scrollTop', function () {
  var env = native();
  var list = env.document.createElement('div');
  env.body.appendChild(list);
  var calls = 0;
  env.window.AppKit.pullToRefresh({ el: list, onRefresh: function () { calls += 1; } });
  list.scrollTop = 10;
  list.dispatch('touchstart', { touches: [touch(100)] });
  list.dispatch('touchmove', { touches: [touch(250)], cancelable: true, preventDefault: function () {} });
  list.dispatch('touchend', { touches: [] });
  assert.equal(calls, 0);
  list.scrollTop = 0;
  list.dispatch('touchstart', { touches: [touch(100)] });
  list.dispatch('touchmove', { touches: [touch(250)], cancelable: true, preventDefault: function () {} });
  list.dispatch('touchend', { touches: [] });
  assert.equal(calls, 1);
});

test('pullToRefresh: destroy removes the listeners and the indicator', function () {
  var p = ptrEnv();
  pull(p.env, 100, 150);
  release(p.env);
  assert.ok(p.ptr());
  p.handle.destroy();
  assert.equal(p.ptr(), null);
  ['touchmove', 'touchend', 'touchcancel'].forEach(function (type) {
    assert.equal(p.env.docHandlerCount(type), 0, type);
  });
  assert.equal(p.env.docHandlerCount('touchstart'), 1, 'only the kit no-op is left');
  pull(p.env, 100, 300);
  release(p.env);
  assert.equal(p.calls(), 0);
  assert.doesNotThrow(function () { p.handle.destroy(); });
});

test('pullToRefresh: destroy during a refresh does not bring the indicator back', async function () {
  var d = deferred();
  var p = ptrEnv(function () { return d.promise; });
  pull(p.env, 100, 200);
  release(p.env);
  p.handle.destroy();
  d.resolve();
  await tick();
  assert.equal(p.ptr(), null);
});

// ---------- CSS ----------

function readCss(name) {
  return fs.readFileSync(path.join(ROOT, 'frontend', name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
}

// Every rule as { prelude, body, atrules } with the enclosing at-rule preludes.
function rulesOf(css) {
  var out = [];
  var stack = [];
  var buffer = '';
  var bodyStart = [];
  for (var i = 0; i < css.length; i++) {
    var ch = css[i];
    if (ch === '{') {
      var prelude = buffer.trim();
      buffer = '';
      stack.push(prelude);
      bodyStart.push(i + 1);
    } else if (ch === '}') {
      var p = stack.pop();
      var start = bodyStart.pop();
      var body = css.slice(start, i);
      if (p.charAt(0) !== '@' && body.indexOf('{') < 0) {
        out.push({ prelude: p, body: body, atrules: stack.slice() });
      }
      buffer = '';
    } else if (ch === ';') {
      buffer = '';
    } else {
      buffer += ch;
    }
  }
  return out;
}

function splitTop(prelude) {
  var parts = [];
  var depth = 0;
  var cur = '';
  for (var i = 0; i < prelude.length; i++) {
    var c = prelude[i];
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; } else cur += c;
  }
  parts.push(cur.trim());
  return parts;
}

function selectorsIn(rules) {
  var all = [];
  rules.forEach(function (r) {
    if (/^(from|to|[\d.]+%)/.test(r.prelude)) return;
    splitTop(r.prelude).forEach(function (s) { all.push({ selector: s, body: r.body, atrules: r.atrules }); });
  });
  return all;
}

function bodyOf(rules, selector) {
  var found = rules.filter(function (r) {
    return splitTop(r.prelude).indexOf(selector) >= 0;
  });
  assert.ok(found.length > 0, 'no rule for ' + selector);
  return found.map(function (r) { return r.body; }).join(';');
}

test('css native: ak-native.js and ak-native.css are not pulled in by app-kit.css or ak-components.css', function () {
  assert.doesNotMatch(readCss('app-kit.css'), /ak-native|@import/);
  assert.doesNotMatch(readCss('ak-components.css'), /ak-native|@import/);
});

test('css native: every touch and system rule is scoped under html.ak-native (or is an explicit ak- class)', function () {
  var sels = selectorsIn(rulesOf(readCss('ak-native.css')));
  assert.ok(sels.length > 10);
  sels.forEach(function (s) {
    var ok = /^html\.ak-native\b/.test(s.selector) ||
      /^html\.ak-(system-font|no-bounce)\b/.test(s.selector) ||
      /^html\.eink/.test(s.selector) ||
      /^html\[data-ak-nav/.test(s.selector) ||
      /^\.ak-/.test(s.selector);
    assert.ok(ok, 'unscoped selector: ' + s.selector);
    // A bare element at the start (button { ... }) would change apps that only link the file.
    assert.doesNotMatch(s.selector, /^(button|a|label|body|input|textarea|select|\[)/, s.selector);
  });
});

test('css native: touch rules', function () {
  var rules = rulesOf(readCss('ak-native.css'));
  var tap = bodyOf(rules, 'html.ak-native button');
  assert.match(tap, /-webkit-tap-highlight-color:\s*transparent/);
  assert.match(tap, /touch-action:\s*manipulation/);
  assert.match(tap, /user-select:\s*none/);
  assert.match(tap, /-webkit-touch-callout:\s*none/);
  ['html.ak-native a', 'html.ak-native [role="button"]', 'html.ak-native .ak-tab', 'html.ak-native label'].forEach(function (s) {
    assert.match(bodyOf(rules, s), /touch-action:\s*manipulation/, s);
  });
  ['html.ak-native .ak-tabbar', 'html.ak-native .ak-navbar', 'html.ak-native .ak-sheet-head', 'html.ak-native .ak-grabber'].forEach(function (s) {
    assert.match(bodyOf(rules, s), /user-select:\s*none/, s);
  });
});

test('css native: user-select none is never put on inputs, text areas, selects, editable or general text', function () {
  var sels = selectorsIn(rulesOf(readCss('ak-native.css')));
  sels.filter(function (s) { return /user-select:\s*none/.test(s.body); }).forEach(function (s) {
    assert.doesNotMatch(s.selector, /input|textarea|select|contenteditable|\bp\b|\bbody\b/, s.selector);
  });
});

test('css native: the press state is instant, and the pressable dips', function () {
  var rules = rulesOf(readCss('ak-native.css'));
  assert.match(bodyOf(rules, 'html.ak-native .ak-pressable:active'), /scale\(/);
  assert.match(bodyOf(rules, 'html.ak-native button:not(:disabled, .ak-scrim):active'), /opacity:\s*0\.6/);
  assert.match(bodyOf(rules, 'html.ak-native [role="button"]:active'), /opacity:\s*0\.6/);
  assert.match(bodyOf(rules, 'html.ak-native button:not(:disabled, .ak-scrim):active'), /transition:\s*none/);
});

test('css native: tab bar tabs are not dimmed, the icon dip stays', function () {
  var css = readCss('ak-native.css');
  var rules = rulesOf(css);
  var tab = bodyOf(rules, 'html.ak-native .ak-tabbar .ak-tab:active');
  assert.match(tab, /opacity:\s*1\b/);
  assert.doesNotMatch(tab, /scale\(/, 'the button itself does not scale');
  assert.doesNotMatch(tab, /opacity:\s*0\.6/);
  // It comes after the dim rule and is more specific, so it wins.
  assert.ok(css.indexOf('html.ak-native .ak-tabbar .ak-tab:active') > css.indexOf('html.ak-native .ak-tab:active'));
  // The plain tab selector may still be in the dim list: the override handles it.
  var dim = rules.filter(function (r) { return /opacity:\s*0\.6/.test(r.body); });
  assert.ok(dim.length > 0);
  // ak-native.css leaves the icon alone: it dips from ak-components.css.
  assert.doesNotMatch(css, /\.ak-tab-icon/);
});

test('css native: bounce helpers', function () {
  var rules = rulesOf(readCss('ak-native.css'));
  assert.match(bodyOf(rules, 'html.ak-no-bounce'), /overscroll-behavior:\s*none/);
  assert.match(bodyOf(rules, 'html.ak-no-bounce body'), /overscroll-behavior:\s*none/);
  assert.match(bodyOf(rules, '.ak-contain'), /overscroll-behavior:\s*contain/);
  var any = selectorsIn(rules).filter(function (s) { return /overscroll-behavior-y:\s*none/.test(s.body); });
  assert.deepEqual(any, [], 'no global overscroll-behavior-y: none');
});

test('css native: system font class', function () {
  var body = bodyOf(rulesOf(readCss('ak-native.css')), 'html.ak-system-font');
  assert.match(body, /--ak-font:\s*-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif/);
  assert.match(body, /--ak-font-article:/);
  assert.match(body, /-webkit-font-smoothing:\s*antialiased/);
});

test('css native: navbar and tab bar are glass, with an opaque @supports fallback', function () {
  var css = readCss('ak-native.css');
  var rules = rulesOf(css);
  var navbar = bodyOf(rules, '.ak-navbar');
  assert.match(navbar, /position:\s*sticky/);
  assert.match(navbar, /padding:\s*var\(--ak-safe-top\)/);
  assert.match(navbar, /background:\s*var\(--ak-glass\)/);
  assert.match(navbar, /-webkit-backdrop-filter:\s*saturate\(180%\) blur\(20px\)/);
  assert.match(navbar, /(^|[;\s])backdrop-filter:\s*saturate\(180%\) blur\(20px\)/);
  var bar = { body: rules.filter(function (r) { return r.prelude === 'html.ak-native .ak-tabbar' && r.atrules.length === 0; }).map(function (r) { return r.body; }).join(';') };
  assert.match(bar.body, /background:\s*var\(--ak-glass\)/);
  assert.match(bar.body, /saturate\(180%\) blur\(20px\)/);
  assert.match(css, /@supports not \(\(-webkit-backdrop-filter: blur\(1px\)\) or \(backdrop-filter: blur\(1px\)\)\)/);
  var fallback = rules.filter(function (r) { return r.atrules.some(function (a) { return /^@supports not/.test(a); }); });
  assert.deepEqual(fallback.map(function (r) { return r.prelude; }).sort(), ['.ak-navbar', 'html.ak-native .ak-tabbar']);
  fallback.forEach(function (r) { assert.match(r.body, /background:\s*var\(--ak-bg\)/); });
  assert.match(bodyOf(rules, '.ak-navbar.ak-collapsed'), /border-bottom-color:\s*var\(--ak-hairline\)/);
  assert.match(bodyOf(rules, '.ak-navbar-title'), /opacity:\s*0/);
  assert.match(bodyOf(rules, '.ak-navbar.ak-collapsed .ak-navbar-title'), /opacity:\s*1/);
  assert.ok(bodyOf(rules, '.ak-large-title'));
});

test('css native: ak-components.css tab bar is unchanged outside html.ak-native', function () {
  var rules = rulesOf(readCss('ak-components.css'));
  var bar = bodyOf(rules, '.ak-tabbar');
  assert.match(bar, /background:\s*var\(--ak-tabbar\)/);
  assert.match(bar, /backdrop-filter:\s*blur\(20px\)/);
  assert.doesNotMatch(bar, /saturate|glass/);
});

test('css native: page transition animations, the tab bar name, and reduced motion', function () {
  var css = readCss('ak-native.css');
  var rules = rulesOf(css);
  assert.match(bodyOf(rules, 'html[data-ak-nav="push"]::view-transition-new(root)'), /animation-name:\s*ak-nav-in-right/);
  assert.match(bodyOf(rules, 'html[data-ak-nav="push"]::view-transition-old(root)'), /animation-name:\s*ak-nav-out-left/);
  assert.match(bodyOf(rules, 'html[data-ak-nav="pop"]::view-transition-old(root)'), /animation-name:\s*ak-nav-out-right/);
  assert.match(bodyOf(rules, 'html[data-ak-nav="pop"]::view-transition-new(root)'), /animation-name:\s*ak-nav-in-left/);
  assert.match(css, /translateX\(100%\)/);
  assert.match(css, /translateX\(-30%\)/);
  assert.match(bodyOf(rules, 'html[data-ak-nav]::view-transition-old(root)'), /animation-duration:\s*350ms/);
  assert.match(bodyOf(rules, 'html[data-ak-nav]::view-transition-old(root)'), /cubic-bezier\(0\.2, 0\.8, 0\.2, 1\)/);
  assert.match(bodyOf(rules, 'html.ak-native .ak-tabbar'), /view-transition-name:\s*ak-tabbar/);
  var reduced = rules.filter(function (r) {
    return r.atrules.indexOf('@media (prefers-reduced-motion: reduce)') >= 0 && /view-transition/.test(r.prelude);
  });
  assert.ok(reduced.length > 0);
  reduced.forEach(function (r) { assert.match(r.body, /animation:\s*none/); });
});

test('css native: view-transition-name is only set under html.ak-native', function () {
  readCssRules('ak-native.css').forEach(function (s) {
    if (/view-transition-name/.test(s.body)) assert.match(s.selector, /^html\.ak-native /, s.selector);
  });
  assert.doesNotMatch(readCss('ak-components.css'), /view-transition-name/);
});

function readCssRules(name) {
  return selectorsIn(rulesOf(readCss(name)));
}

test('css native: pull to refresh and skeleton classes exist, and motion is turned off for reduced motion', function () {
  var css = readCss('ak-native.css');
  var rules = rulesOf(css);
  assert.ok(bodyOf(rules, '.ak-ptr'));
  assert.match(bodyOf(rules, '.ak-ptr.ak-ptr-loading::after'), /animation:\s*ak-ptr-spin/);
  ['.ak-skeleton', '.ak-skeleton-line', '.ak-skeleton-circle', '.ak-skeleton-card'].forEach(function (s) {
    assert.match(bodyOf(rules, s), /animation:\s*ak-shimmer/, s);
    assert.match(bodyOf(rules, s), /var\(--ak-surface-2\)/, s);
  });
  assert.match(bodyOf(rules, '.ak-skeleton-line.ak-skeleton-short'), /width:\s*60%/);
  var reducedRules = rules.filter(function (r) { return r.atrules.indexOf('@media (prefers-reduced-motion: reduce)') >= 0; });
  var shimmerOff = reducedRules.filter(function (r) { return /\.ak-skeleton\b/.test(r.prelude); });
  assert.ok(shimmerOff.length > 0);
  shimmerOff.forEach(function (r) { assert.match(r.body, /animation:\s*none/); });
  var spinnerOff = reducedRules.filter(function (r) { return /ak-ptr-loading::after/.test(r.prelude); });
  assert.ok(spinnerOff.length > 0);
});

test('css native: ak-native.css never sets a background on html or body', function () {
  readCssRules('ak-native.css').forEach(function (s) {
    var target = s.selector.replace(/::?[\w-]+(\([^)]*\))?/g, '');
    var last = target.trim().split(/\s+/).pop();
    if (/^(html|body)(\.[\w-]+)*$/.test(last)) {
      assert.doesNotMatch(s.body, /background/, s.selector);
    }
  });
  assert.doesNotMatch(readCss('ak-view-transitions.css'), /background/);
});

test('css native: every colour in ak-native.css is a token', function () {
  var css = readCss('ak-native.css');
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/);
  assert.doesNotMatch(css, /rgba?\(/);
});

test('css native: --ak-glass is defined in all four colour blocks, translucent, and eink makes it opaque', function () {
  var tokens = fs.readFileSync(path.join(ROOT, 'frontend', 'ak-tokens.css'), 'utf8');
  assert.equal(tokens.match(/--ak-glass:\s*rgba\([^)]*0\.72\);/g).length, 4);
  var dark = tokens.match(/--ak-glass:\s*rgba\(0, 0, 0, 0\.72\)/g).length;
  var light = tokens.match(/--ak-glass:\s*rgba\(255, 255, 255, 0\.72\)/g).length;
  assert.equal(dark, 2);
  assert.equal(light, 2);
  assert.match(bodyOf(rulesOf(readCss('ak-components.css')), 'html.eink'), /--ak-glass:\s*#ffffff/);
});

test('css native: existing token values did not change', function () {
  var tokens = readCss('ak-tokens.css');
  assert.match(tokens, /--ak-tabbar: rgba\(0, 0, 0, 0\.92\)/);
  assert.match(tokens, /--ak-tabbar: rgba\(255, 255, 255, 0\.92\)/);
  assert.match(tokens, /--ak-overlay: rgba\(28, 28, 30, 0\.72\)/);
});

test('css view-transitions: the cross-document opt-in, with a reduced-motion guard', function () {
  var raw = fs.readFileSync(path.join(ROOT, 'frontend', 'ak-view-transitions.css'), 'utf8');
  var css = readCss('ak-view-transitions.css');
  assert.match(css, /@view-transition\s*\{\s*navigation:\s*auto;\s*\}/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*@view-transition\s*\{\s*navigation:\s*none;/);
  assert.match(raw, /cannot be scoped to a class/);
});

test('css components: sheet snaps and scaleBackground rules, guarded for reduced motion', function () {
  var css = readCss('ak-components.css');
  var rules = rulesOf(css);
  assert.match(bodyOf(rules, '.ak-sheet.ak-sheet-snaps'), /translateY\(var\(--ak-sheet-y/);
  var scaled = rules.filter(function (r) { return r.prelude === ':root.ak-sheet-scaled .ak-sheet-behind'; })[0];
  assert.ok(scaled, 'scale rule');
  assert.match(scaled.body, /scale\(0\.94\)/);
  assert.match(scaled.body, /border-radius/);
  assert.deepEqual(scaled.atrules, ['@media (prefers-reduced-motion: no-preference)']);
  var off = rules.filter(function (r) { return r.prelude === '.ak-sheet-behind' && r.atrules.length === 1; })[0];
  assert.match(off.body, /transition:\s*none/);
  assert.doesNotMatch(css, /ak-sheet-scaled[^{]*\{[^}]*background/);
});

// The text inside @keyframes name { ... }.
function keyframes(css, name) {
  var start = css.indexOf('@keyframes ' + name + ' ');
  assert.ok(start >= 0, 'no @keyframes ' + name);
  var open = css.indexOf('{', start);
  var depth = 0;
  for (var i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}') {
      depth--;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  throw new Error('unbalanced @keyframes ' + name);
}

function declaredProps(body) {
  var props = [];
  body.replace(/([\w-]+)\s*:/g, function (m, p) { props.push(p); return m; });
  return props.filter(function (p, i) { return props.indexOf(p) === i; }).sort();
}

test('css tab bar: --ak-tab-icon-size is 26px and .ak-tab-icon uses it', function () {
  assert.match(readCss('ak-tokens.css'), /--ak-tab-icon-size:\s*26px;/);
  var body = bodyOf(rulesOf(readCss('ak-components.css')), '.ak-tab-icon');
  assert.match(body, /width:\s*var\(--ak-tab-icon-size\)/);
  assert.match(body, /height:\s*var\(--ak-tab-icon-size\)/);
});

test('css tab bar: the icon dip uses the kit tokens and works without html.ak-native', function () {
  var css = readCss('ak-components.css');
  var rules = rulesOf(css);
  var base = bodyOf(rules, '.ak-tabbar .ak-tab .ak-tab-icon');
  assert.match(base, /transition:\s*transform var\(--ak-duration\) var\(--ak-ease-spring\)/);
  var press = bodyOf(rules, '.ak-tabbar .ak-tab:active .ak-tab-icon');
  assert.match(press, /transform:\s*scale\(0\.9\)/);
  assert.match(press, /transition-duration:\s*var\(--ak-duration-press\)/);
  assert.match(press, /transition-timing-function:\s*ease-out/);
  rules.forEach(function (r) {
    if (/\.ak-tab-icon/.test(r.prelude)) assert.doesNotMatch(r.prelude, /ak-native/);
  });
  var tokens = readCss('ak-tokens.css');
  assert.match(tokens, /--ak-ease-spring:\s*cubic-bezier\(0\.3, 1\.45, 0\.6, 1\)/);
  assert.match(tokens, /--ak-duration:\s*120ms/);
  assert.match(tokens, /--ak-duration-press:\s*80ms/);
});

test('css tab bar: tab-in, tab-icon-in and page-in keyframes, motion only when allowed', function () {
  var css = readCss('ak-components.css');
  var rules = rulesOf(css);
  assert.match(keyframes(css, 'ak-tab-in'), /from\s*\{\s*color:\s*var\(--ak-muted\)/);
  assert.match(keyframes(css, 'ak-tab-in'), /to\s*\{\s*color:\s*var\(--ak-text\)/);
  assert.match(keyframes(css, 'ak-tab-icon-in'), /scale\(0\.86\)[\s\S]*scale\(1\)/);
  assert.deepEqual(declaredProps(keyframes(css, 'ak-page-in')), ['opacity'], 'page-in is opacity only');
  var tabIn = rules.filter(function (r) { return r.prelude === '.ak-tab.ak-tab-in' && /animation:\s*ak-tab-in 180ms ease-out/.test(r.body); })[0];
  var iconIn = rules.filter(function (r) { return r.prelude === '.ak-tab.ak-tab-in .ak-tab-icon' && /ak-tab-icon-in 220ms var\(--ak-ease-spring\)/.test(r.body); })[0];
  var pageIn = rules.filter(function (r) { return r.prelude === '.ak-page-in' && /animation:\s*ak-page-in 160ms ease-out/.test(r.body); })[0];
  [tabIn, iconIn, pageIn].forEach(function (r) {
    assert.ok(r, 'animation rule');
    assert.deepEqual(r.atrules, ['@media (prefers-reduced-motion: no-preference)']);
  });
});

test('css tab bar: reduced motion has no press transform, no icon transition, no tab-in or page-in', function () {
  var rules = rulesOf(readCss('ak-components.css'));
  var reduced = rules.filter(function (r) { return r.atrules.indexOf('@media (prefers-reduced-motion: reduce)') >= 0; });
  function find(selector) {
    var hit = reduced.filter(function (r) { return splitTop(r.prelude).indexOf(selector) >= 0; });
    assert.ok(hit.length > 0, 'no reduced-motion rule for ' + selector);
    return hit.map(function (r) { return r.body; }).join(';');
  }
  assert.match(find('.ak-tabbar .ak-tab .ak-tab-icon'), /transition:\s*none/);
  assert.match(find('.ak-tabbar .ak-tab:active .ak-tab-icon'), /transform:\s*none/);
  ['.ak-tab.ak-tab-in', '.ak-tab.ak-tab-in .ak-tab-icon', '.ak-page-in'].forEach(function (s) {
    assert.match(find(s), /animation:\s*none/, s);
  });
});

test('css popup: tokens, keyframes with only opacity and transform, and a fade without scale for reduced motion', function () {
  var tokens = readCss('ak-tokens.css');
  assert.match(tokens, /--ak-pop-duration:\s*140ms;/);
  assert.match(tokens, /--ak-pop-ease:\s*cubic-bezier\(0\.2, 0\.9, 0\.3, 1\);/);
  var css = readCss('ak-components.css');
  var rules = rulesOf(css);
  ['ak-pop-in', 'ak-pop-out'].forEach(function (name) {
    assert.deepEqual(declaredProps(keyframes(css, name)), ['opacity', 'transform'], name);
    assert.match(keyframes(css, name), /scale\(0\.96\)/, name);
  });
  assert.deepEqual(declaredProps(keyframes(css, 'ak-fade-out')), ['opacity']);
  assert.deepEqual(declaredProps(keyframes(css, 'ak-fade-in')), ['opacity']);
  assert.match(bodyOf(rules, '.ak-pop'), /animation:\s*ak-pop-in var\(--ak-pop-duration\) var\(--ak-pop-ease\)/);
  assert.match(bodyOf(rules, '.ak-pop'), /transform-origin:\s*50% 50%/);
  assert.match(bodyOf(rules, '.ak-pop.ak-pop-out'), /animation:\s*ak-pop-out var\(--ak-pop-duration\) var\(--ak-pop-ease\)/);
  // Toasts and shown menus pop in by themselves, and take the out class too.
  assert.match(bodyOf(rules, '.ak-toast'), /ak-pop-in/);
  assert.match(bodyOf(rules, '.ak-card-menu:not([hidden])'), /ak-pop-in/);
  assert.match(bodyOf(rules, '.ak-toast.ak-pop-out'), /ak-pop-out/);
  assert.match(bodyOf(rules, '.ak-card-menu.ak-pop-out'), /ak-pop-out/);
  var reduced = rules.filter(function (r) {
    return r.atrules.indexOf('@media (prefers-reduced-motion: reduce)') >= 0 && /\.ak-pop|\.ak-toast|\.ak-card-menu(?!-)/.test(r.prelude);
  });
  assert.ok(reduced.length >= 2);
  reduced.forEach(function (r) {
    assert.doesNotMatch(r.body, /scale|transform/, r.prelude);
    assert.match(r.body, /animation-name:\s*ak-fade-(in|out)/, r.prelude);
  });
});
