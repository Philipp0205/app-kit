import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEnv } from './helpers/fake-dom.mjs';

function loaded(options) {
  var env = createEnv(options);
  env.load('theme-color.js');
  return env;
}

var DARK = '(prefers-color-scheme: dark)';

test('only window.AppKit is added to the global scope', function () {
  var env = createEnv();
  var before = Object.keys(env.window);
  env.load('theme-color.js');
  var added = Object.keys(env.window).filter(function (k) { return before.indexOf(k) < 0; });
  assert.deepEqual(added, ['AppKit']);
  assert.deepEqual(Object.keys(env.window.AppKit.themeColor).sort(), ['start', 'toHex']);
});

test('toHex: comma separated rgb and rgba', function () {
  var toHex = loaded().window.AppKit.themeColor.toHex;
  assert.equal(toHex('rgb(15, 28, 31)'), '#0f1c1f');
  assert.equal(toHex('rgb(15,28,31)'), '#0f1c1f');
  assert.equal(toHex('rgba(15, 28, 31, 1)'), '#0f1c1f');
  assert.equal(toHex('rgba(15, 28, 31, 0.5)'), '#0f1c1f');
  assert.equal(toHex('rgb(0, 0, 0)'), '#000000');
  assert.equal(toHex('rgb(255, 255, 255)'), '#ffffff');
});

test('toHex: space separated rgb', function () {
  var toHex = loaded().window.AppKit.themeColor.toHex;
  assert.equal(toHex('rgb(15 28 31)'), '#0f1c1f');
  assert.equal(toHex('rgb(  15   28   31  )'), '#0f1c1f');
  assert.equal(toHex('rgb(23 20 15)'), '#17140f');
});

test('toHex: modern slash alpha', function () {
  var toHex = loaded().window.AppKit.themeColor.toHex;
  assert.equal(toHex('rgb(15 28 31 / 0.5)'), '#0f1c1f');
  assert.equal(toHex('rgb(15 28 31 / 50%)'), '#0f1c1f');
  assert.equal(toHex('rgb(15 28 31/1)'), '#0f1c1f');
  assert.equal(toHex('rgba(15 28 31 / .5)'), '#0f1c1f');
});

test('toHex: fully transparent is null', function () {
  var toHex = loaded().window.AppKit.themeColor.toHex;
  assert.equal(toHex('rgba(0, 0, 0, 0)'), null);
  assert.equal(toHex('rgba(0,0,0,0)'), null);
  assert.equal(toHex('rgba(0, 0, 0, 0%)'), null);
  assert.equal(toHex('rgb(0 0 0 / 0)'), null);
  assert.equal(toHex('rgb(0 0 0 / 0%)'), null);
  assert.equal(toHex('rgba(10, 20, 30, 0.0)'), null);
});

test('toHex: garbage and unrelated strings are null', function () {
  var toHex = loaded().window.AppKit.themeColor.toHex;
  assert.equal(toHex(''), null);
  assert.equal(toHex(null), null);
  assert.equal(toHex(undefined), null);
  assert.equal(toHex(42), null);
  assert.equal(toHex('garbage'), null);
  assert.equal(toHex('transparent'), null);
  assert.equal(toHex('red'), null);
  assert.equal(toHex('#fff'), null);
  assert.equal(toHex('hsl(10, 20%, 30%)'), null);
  assert.equal(toHex('rgb(1, 2)'), null);
  assert.equal(toHex('rgb(1, 2, 3, 4, 5)'), null);
  assert.equal(toHex('rgb(a, b, c)'), null);
  assert.equal(toHex('rgb(1 2 3'), null);
});

test('toHex: output is lowercase and clamped', function () {
  var toHex = loaded().window.AppKit.themeColor.toHex;
  assert.equal(toHex('rgb(171, 205, 239)'), '#abcdef');
  assert.equal(toHex('rgb(300, 0, 0)'), '#ff0000');
  assert.equal(toHex('rgb(1, 2, 3)'), '#010203');
  assert.equal(toHex('rgb(15.6, 28.2, 31)'), '#101c1f');
});

test('start: removes media metas and keeps one without media', function () {
  var env = loaded({
    htmlBg: 'rgb(23, 20, 15)',
    metas: [
      { content: '#111111', media: '(prefers-color-scheme: dark) and (max-width: 719px)' },
      { content: '#222222', media: '(prefers-color-scheme: light) and (max-width: 719px)' },
      { content: '#333333', media: DARK },
      { content: '#444444', media: '(prefers-color-scheme: light)' }
    ]
  });
  env.window.AppKit.themeColor.start();
  var metas = env.themeMetas();
  assert.equal(metas.length, 1);
  assert.equal(metas[0].hasAttribute('media'), false);
  assert.equal(metas[0].getAttribute('content'), '#17140f');
});

test('start: keeps an existing meta without media', function () {
  var env = loaded({ htmlBg: 'rgb(244 238 225)', metas: [{ content: '#000000' }, { content: '#111111', media: DARK }] });
  var original = env.themeMetas()[0];
  env.window.AppKit.themeColor.start();
  var metas = env.themeMetas();
  assert.equal(metas.length, 1);
  assert.equal(metas[0], original);
  assert.equal(metas[0].getAttribute('content'), '#f4eee1');
});

test('start: creates a meta in the head when there is none', function () {
  var env = loaded({ htmlBg: 'rgb(1, 2, 3)' });
  env.window.AppKit.themeColor.start();
  var metas = env.themeMetas();
  assert.equal(metas.length, 1);
  assert.equal(metas[0].parentNode, env.head);
  assert.equal(metas[0].getAttribute('content'), '#010203');
});

test('start: falls back to body when html is transparent', function () {
  var env = loaded({ htmlBg: 'rgba(0, 0, 0, 0)', bodyBg: 'rgb(15 28 31)' });
  env.window.AppKit.themeColor.start();
  assert.equal(env.themeMetas()[0].getAttribute('content'), '#0f1c1f');
});

test('start: html colour wins over body', function () {
  var env = loaded({ htmlBg: 'rgb(1, 2, 3)', bodyBg: 'rgb(9, 9, 9)' });
  env.window.AppKit.themeColor.start();
  assert.equal(env.themeMetas()[0].getAttribute('content'), '#010203');
});

test('start: leaves metas alone when neither background is solid', function () {
  var env = loaded({ htmlBg: 'rgba(0, 0, 0, 0)', bodyBg: 'rgba(0, 0, 0, 0%)', metas: [{ content: '#111111', media: DARK }] });
  env.window.AppKit.themeColor.start();
  var metas = env.themeMetas();
  assert.equal(metas.length, 1);
  assert.equal(metas[0].getAttribute('media'), DARK);
  assert.equal(metas[0].getAttribute('content'), '#111111');
});

test('skip: a selector that matches <html> leaves everything alone', function () {
  var env = loaded({ htmlClass: 'eink', htmlBg: 'rgb(1, 2, 3)', metas: [{ content: '#111111', media: DARK }] });
  env.window.AppKit.themeColor.start({ skip: 'html.eink' });
  var metas = env.themeMetas();
  assert.equal(metas.length, 1);
  assert.equal(metas[0].getAttribute('media'), DARK);
  assert.equal(metas[0].getAttribute('content'), '#111111');
  assert.deepEqual(env.watched(), []);
  assert.equal(env.windowHandlerCount('resize'), 0);
});

test('skip: a selector that does not match still runs', function () {
  var env = loaded({ htmlBg: 'rgb(1, 2, 3)' });
  env.window.AppKit.themeColor.start({ skip: 'html.eink' });
  assert.equal(env.themeMetas()[0].getAttribute('content'), '#010203');
});

test('skip: a selector that matches an element in the document skips', function () {
  var env = loaded({ htmlBg: 'rgb(1, 2, 3)' });
  var marker = env.document.createElement('div');
  marker.className = 'no-bar';
  env.body.appendChild(marker);
  env.window.AppKit.themeColor.start({ skip: 'div.no-bar' });
  assert.equal(env.themeMetas().length, 0);
});

test('skip: a function returning true skips, false runs', function () {
  var env = loaded({ htmlBg: 'rgb(1, 2, 3)', metas: [{ content: '#111111', media: DARK }] });
  var calls = 0;
  env.window.AppKit.themeColor.start({ skip: function () { calls++; return true; } });
  assert.equal(calls, 1);
  assert.equal(env.themeMetas()[0].getAttribute('media'), DARK);
  env.window.AppKit.themeColor.start({ skip: function () { return false; } });
  assert.equal(env.themeMetas().length, 1);
  assert.equal(env.themeMetas()[0].hasAttribute('media'), false);
});

test('no skip option means do not skip', function () {
  var env = loaded({ htmlClass: 'eink', htmlBg: 'rgb(1, 2, 3)' });
  env.window.AppKit.themeColor.start();
  assert.equal(env.themeMetas()[0].getAttribute('content'), '#010203');
});

test('re-syncs when the colour scheme changes', function () {
  var env = loaded({ htmlBg: 'rgb(244, 238, 225)' });
  env.window.AppKit.themeColor.start();
  assert.equal(env.themeMetas()[0].getAttribute('content'), '#f4eee1');
  env.html._bg = 'rgb(23, 20, 15)';
  env.changeMedia(DARK);
  assert.equal(env.themeMetas()[0].getAttribute('content'), '#17140f');
  assert.equal(env.themeMetas().length, 1);
});

test('listens to extra media queries', function () {
  var phone = '(max-width: 719px)';
  var env = loaded({ htmlBg: 'rgb(1, 1, 1)' });
  env.window.AppKit.themeColor.start({ media: [phone] });
  assert.deepEqual(env.watched().sort(), [phone, DARK].sort());
  env.html._bg = 'rgb(2, 2, 2)';
  env.changeMedia(phone);
  assert.equal(env.themeMetas()[0].getAttribute('content'), '#020202');
});

test('resize is coalesced with requestAnimationFrame', function () {
  var env = loaded({ htmlBg: 'rgb(1, 1, 1)' });
  env.window.AppKit.themeColor.start();
  env.html._bg = 'rgb(3, 3, 3)';
  env.fireWindow('resize');
  env.fireWindow('resize');
  env.fireWindow('resize');
  assert.equal(env.pendingFrames(), 1);
  assert.equal(env.themeMetas()[0].getAttribute('content'), '#010101');
  env.flushFrames();
  assert.equal(env.themeMetas()[0].getAttribute('content'), '#030303');
  env.fireWindow('resize');
  assert.equal(env.pendingFrames(), 1);
});

test('resize syncs at once without requestAnimationFrame', function () {
  var env = loaded({ htmlBg: 'rgb(1, 1, 1)' });
  env.window.requestAnimationFrame = undefined;
  env.window.AppKit.themeColor.start();
  env.html._bg = 'rgb(4, 4, 4)';
  env.fireWindow('resize');
  assert.equal(env.themeMetas()[0].getAttribute('content'), '#040404');
});

test('uses addListener when addEventListener is missing on the media list', function () {
  var env = loaded({ legacyMedia: true, htmlBg: 'rgb(244, 238, 225)' });
  env.window.AppKit.themeColor.start({ media: ['(max-width: 719px)'] });
  assert.equal(env.handlerCount(DARK), 1);
  env.html._bg = 'rgb(23, 20, 15)';
  env.changeMedia(DARK);
  assert.equal(env.themeMetas()[0].getAttribute('content'), '#17140f');
});

test('calling start twice does not attach duplicate listeners', function () {
  var phone = '(max-width: 719px)';
  var env = loaded({ htmlBg: 'rgb(1, 1, 1)' });
  env.window.AppKit.themeColor.start({ media: [phone] });
  env.window.AppKit.themeColor.start({ media: [phone] });
  env.window.AppKit.themeColor.start();
  assert.equal(env.handlerCount(DARK), 1);
  assert.equal(env.handlerCount(phone), 1);
  assert.equal(env.windowHandlerCount('resize'), 1);
  assert.equal(env.themeMetas().length, 1);
});

test('start is a no-op when matchMedia is missing', function () {
  var env = loaded({ noMatchMedia: true, htmlBg: 'rgb(1, 1, 1)', metas: [{ content: '#111111', media: DARK }] });
  assert.doesNotThrow(function () { env.window.AppKit.themeColor.start(); });
  assert.equal(env.themeMetas()[0].getAttribute('media'), DARK);
});

test('start is a no-op when getComputedStyle is missing', function () {
  var env = loaded({ htmlBg: 'rgb(1, 1, 1)', metas: [{ content: '#111111', media: DARK }] });
  env.window.getComputedStyle = undefined;
  assert.doesNotThrow(function () { env.window.AppKit.themeColor.start(); });
  assert.equal(env.themeMetas()[0].getAttribute('media'), DARK);
});

test('start is a no-op when querySelectorAll is missing', function () {
  var env = loaded({ htmlBg: 'rgb(1, 1, 1)' });
  env.document.querySelectorAll = undefined;
  assert.doesNotThrow(function () { env.window.AppKit.themeColor.start(); });
  assert.equal(env.head.children.length, 0);
});

test('a head script without a body syncs again on DOMContentLoaded', function () {
  var env = createEnv({ bodyless: true, htmlBg: 'rgba(0, 0, 0, 0)' });
  env.document.readyState = 'loading';
  env.load('theme-color.js');
  env.window.AppKit.themeColor.start();
  assert.equal(env.themeMetas().length, 0);
  env.html._bg = 'rgb(5, 5, 5)';
  env.fireDocument('DOMContentLoaded');
  assert.equal(env.themeMetas()[0].getAttribute('content'), '#050505');
});
