import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEnv } from './helpers/fake-dom.mjs';

var REDUCED = { '(prefers-reduced-motion: reduce)': true };

// The viewport is 800px high (fake-dom default). A sheet laid out at its highest
// snap is that tall, so the offsets are easy to read: snap 1 is 0px, snap 0.5 is 400px.
function sheetEnv(options) {
  var env = createEnv(options);
  env.load('ak-dom.js');
  env.load('ak-sheet.js');
  env.makeSheet = function () {
    var h = env.window.AppKit.h;
    var node = h('div', { class: 'ak-sheet' }, h('div', { class: 'ak-grabber' }), h('p', null, 'Hi'));
    node.offsetHeight = 800;
    return node;
  };
  return env;
}

function head(node) {
  return node.querySelector('.ak-grabber');
}

function down(el, y, t) {
  el.dispatch('pointerdown', { pointerId: 1, button: 0, clientY: y, timeStamp: t });
}
function move(el, y, t) {
  el.dispatch('pointermove', { pointerId: 1, clientY: y, timeStamp: t });
}
function up(el, y, t) {
  el.dispatch('pointerup', { pointerId: 1, clientY: y, timeStamp: t });
}

// A drag from y0 to y1 that takes ms milliseconds, in one move.
function dragTo(el, y0, y1, ms) {
  down(el, y0, 0);
  move(el, y1, ms);
  up(el, y1, ms);
}

// ---------- the old API, unchanged ----------

test('sheet (old API): returns { close } and adds the scrim, the sheet and html.ak-sheet-open', function () {
  var env = sheetEnv();
  var node = env.makeSheet();
  var handle = env.window.AppKit.sheet.show(node);
  assert.equal(typeof handle.close, 'function');
  assert.match(env.html.className, /\bak-sheet-open\b/);
  assert.ok(env.document.querySelector('.ak-scrim'));
  assert.doesNotMatch(node.className, /ak-sheet-snaps/);
  assert.doesNotMatch(env.html.className, /ak-sheet-scaled/);
});

test('sheet (old API): a 72px swipe closes, a shorter slow drag springs back', function () {
  var env = sheetEnv({ media: REDUCED });
  var closed = 0;
  var node = env.makeSheet();
  env.window.AppKit.sheet.show(node, { onClose: function () { closed += 1; } });
  dragTo(head(node), 100, 130, 900);
  assert.equal(closed, 0);
  assert.equal(node.style.transform, '');
  dragTo(head(node), 100, 180, 900);
  assert.equal(closed, 1);
  assert.equal(env.document.querySelector('.ak-sheet'), null);
});

test('sheet (old API): scrim, Escape, one at a time, onClose once', function () {
  var env = sheetEnv({ media: REDUCED });
  var closed = 0;
  var first = env.window.AppKit.sheet.show(env.makeSheet(), { onClose: function () { closed += 1; } });
  assert.equal(env.window.AppKit.sheet.show(env.makeSheet()), null);
  env.fireKey('Escape');
  first.close();
  assert.equal(closed, 1);
  assert.ok(env.window.AppKit.sheet.show(env.makeSheet()));
  env.document.querySelector('.ak-scrim').click();
  assert.equal(env.document.querySelector('.ak-sheet'), null);
});

test('sheet (old API): without snaps snapTo does nothing', function () {
  var env = sheetEnv();
  var node = env.makeSheet();
  var handle = env.window.AppKit.sheet.show(node);
  handle.snapTo(1);
  assert.equal(node.style.transform, undefined);
  assert.deepEqual(Object.keys(node.style), []);
});

// ---------- velocity ----------

test('sheet: a fast flick down closes even under 72px', function () {
  var env = sheetEnv({ media: REDUCED });
  var closed = 0;
  var node = env.makeSheet();
  env.window.AppKit.sheet.show(node, { onClose: function () { closed += 1; } });
  dragTo(head(node), 100, 150, 50); // 50px in 50ms = 1 px/ms
  assert.equal(closed, 1);
});

test('sheet: a slow drag of the same length does not close', function () {
  var env = sheetEnv();
  var closed = 0;
  var node = env.makeSheet();
  env.window.AppKit.sheet.show(node, { onClose: function () { closed += 1; } });
  dragTo(head(node), 100, 150, 900);
  assert.equal(closed, 0);
  assert.equal(node.style.transform, '');
});

test('sheet: a finger that rests before lifting is not a flick', function () {
  var env = sheetEnv();
  var closed = 0;
  var node = env.makeSheet();
  env.window.AppKit.sheet.show(node, { onClose: function () { closed += 1; } });
  down(head(node), 100, 0);
  move(head(node), 150, 50);
  up(head(node), 150, 600);
  assert.equal(closed, 0);
});

test('sheet: a tiny quick jab (under 10px) does not close', function () {
  var env = sheetEnv();
  var closed = 0;
  var node = env.makeSheet();
  env.window.AppKit.sheet.show(node, { onClose: function () { closed += 1; } });
  dragTo(head(node), 100, 106, 5);
  assert.equal(closed, 0);
});

// ---------- snaps ----------

function snapSheet(options, snapOpts) {
  var env = sheetEnv(options);
  var node = env.makeSheet();
  var closed = 0;
  var o = { snaps: [0.5, 1], onClose: function () { closed += 1; } };
  Object.keys(snapOpts || {}).forEach(function (k) { o[k] = snapOpts[k]; });
  var handle = env.window.AppKit.sheet.show(node, o);
  return { env: env, node: node, handle: handle, closed: function () { return closed; } };
}

function offset(s) {
  return s.node.style['--ak-sheet-y'];
}

test('snaps: the sheet opens at snap 0 by default, and opts.snap picks another', function () {
  var a = snapSheet();
  assert.match(a.node.className, /ak-sheet-snaps/);
  assert.equal(offset(a), '400px');
  var b = snapSheet({}, { snap: 1 });
  assert.equal(offset(b), '0px');
});

test('snaps: half and full are aliases, and the list is sorted', function () {
  var s = snapSheet({}, { snaps: ['full', 'half'], snap: 0 });
  assert.equal(offset(s), '400px');
  s.handle.snapTo(1);
  assert.equal(offset(s), '0px');
});

test('snaps: invalid values are dropped, and a list with none left means no snaps', function () {
  var s = snapSheet({}, { snaps: [0, 2, 'x', -1, null] });
  assert.doesNotMatch(s.node.className, /ak-sheet-snaps/);
  s.handle.snapTo(1);
  assert.equal(offset(s), undefined);
});

test('snaps: snapTo moves between snaps, and clamps the index', function () {
  var s = snapSheet();
  s.handle.snapTo(1);
  assert.equal(offset(s), '0px');
  s.handle.snapTo(0);
  assert.equal(offset(s), '400px');
  s.handle.snapTo(9);
  assert.equal(offset(s), '0px');
  s.handle.snapTo('nope');
  assert.equal(offset(s), '0px');
});

test('snaps: dragging follows the finger, and a release rests at the nearest snap', function () {
  var s = snapSheet({}, { snap: 0 });
  var grab = head(s.node);
  down(grab, 500, 0);
  move(grab, 250, 900);
  assert.equal(s.node.style.transform, 'translateY(150px)', 'moved up 250px from 400');
  up(grab, 250, 2000);
  assert.equal(offset(s), '0px', '150px is nearer 0 than 400');
  assert.equal(s.node.style.transform, '');
  assert.equal(s.closed(), 0);

  down(grab, 300, 3000);
  move(grab, 450, 4000);
  up(grab, 450, 5000);
  assert.equal(offset(s), '0px', '150px is nearer 0 than 400');
  down(grab, 300, 6000);
  move(grab, 650, 7000);
  up(grab, 650, 8000);
  assert.equal(offset(s), '400px', '350px is nearer 400');
});

test('snaps: the sheet cannot be dragged above its highest snap', function () {
  var s = snapSheet({}, { snap: 1 });
  var grab = head(s.node);
  down(grab, 300, 0);
  move(grab, 100, 900);
  assert.equal(s.node.style.transform, 'translateY(0px)');
  up(grab, 100, 2000);
  assert.equal(offset(s), '0px');
});

test('snaps: a flick up from the lowest snap goes to the next one', function () {
  var s = snapSheet();
  var grab = head(s.node);
  down(grab, 500, 0);
  move(grab, 480, 20); // 1 px/ms up, but only 20px
  up(grab, 480, 20);
  assert.equal(offset(s), '0px');
  assert.equal(s.closed(), 0);
});

test('snaps: a flick down from the top snap goes to the lower one, not out', function () {
  var s = snapSheet({}, { snap: 1 });
  var grab = head(s.node);
  down(grab, 300, 0);
  move(grab, 330, 30);
  up(grab, 330, 30);
  assert.equal(offset(s), '400px');
  assert.equal(s.closed(), 0);
});

test('snaps: a slow drag past the nearest snap does not need a flick', function () {
  var s = snapSheet({}, { snap: 1 });
  var grab = head(s.node);
  down(grab, 300, 0);
  move(grab, 560, 3000);
  up(grab, 560, 4000);
  assert.equal(offset(s), '400px');
});

test('snaps: dragging more than 72px below the lowest snap closes', function () {
  var s = snapSheet({ media: REDUCED });
  var grab = head(s.node);
  down(grab, 500, 0);
  move(grab, 590, 3000);
  up(grab, 590, 4000);
  assert.equal(s.closed(), 1);
  assert.equal(s.env.document.querySelector('.ak-sheet'), null);
});

test('snaps: dragging 60px below the lowest snap springs back to it', function () {
  var s = snapSheet({ media: REDUCED });
  var grab = head(s.node);
  down(grab, 500, 0);
  move(grab, 560, 3000);
  up(grab, 560, 4000);
  assert.equal(s.closed(), 0);
  assert.equal(offset(s), '400px');
});

test('snaps: a fast flick down from the lowest snap closes', function () {
  var s = snapSheet({ media: REDUCED });
  var grab = head(s.node);
  down(grab, 500, 0);
  move(grab, 530, 30);
  up(grab, 530, 30);
  assert.equal(s.closed(), 1);
});

test('snaps: three snaps, a flick picks the next in its direction', function () {
  var s = snapSheet({}, { snaps: [0.25, 0.5, 1], snap: 1 });
  assert.equal(offset(s), '400px');
  var grab = head(s.node);
  down(grab, 500, 0);
  move(grab, 480, 20);
  up(grab, 480, 20);
  assert.equal(offset(s), '0px');
  down(grab, 300, 100);
  move(grab, 330, 130);
  up(grab, 330, 130);
  assert.equal(offset(s), '400px');
  down(grab, 300, 200);
  move(grab, 330, 230);
  up(grab, 330, 230);
  assert.equal(offset(s), '600px');
});

test('snaps: while dragging the sheet has ak-dragging, and it is gone after the release', function () {
  var s = snapSheet();
  var grab = head(s.node);
  down(grab, 500, 0);
  assert.match(s.node.className, /\bak-dragging\b/);
  up(grab, 500, 2000);
  assert.doesNotMatch(s.node.className, /ak-dragging/);
});

test('snaps: snapTo after close does nothing', function () {
  var s = snapSheet({ media: REDUCED });
  s.handle.close();
  s.handle.snapTo(1);
  assert.equal(offset(s), '400px');
});

// ---------- close continues from the current offset ----------

test('close: from rest it adds ak-closing, stays until the 220ms timer, then goes', function () {
  var env = sheetEnv();
  var node = env.makeSheet();
  env.window.AppKit.sheet.show(node).close();
  assert.ok(env.document.querySelector('.ak-sheet-layer.ak-closing'));
  assert.equal(env.timers[0].ms, 220);
  assert.ok(env.document.querySelector('.ak-sheet'));
  env.runTimers();
  assert.equal(env.document.querySelector('.ak-sheet-layer'), null);
});

test('close: a mid-drag offset is never cleared to the rest position', function () {
  var env = sheetEnv();
  var node = env.makeSheet();
  var handle = env.window.AppKit.sheet.show(node);
  node.style.transform = 'translateY(40px)';
  var seen = [];
  var style = node.style;
  var value = style.transform;
  Object.defineProperty(style, 'transform', {
    get: function () { return value; },
    set: function (v) { value = v; seen.push(v); },
    enumerable: true
  });
  handle.close();
  assert.ok(seen.length > 0);
  seen.forEach(function (v) { assert.notEqual(v, '', 'the offset was cleared'); });
  assert.equal(seen[0], 'translateY(40px)', 'frozen at the current offset first');
  assert.equal(node.style.transform, 'translateY(100%)');
  assert.ok(node.parentNode, 'still in the document until the timer');
  assert.ok(env.document.querySelector('.ak-sheet-layer.ak-closing'));
  env.runTimers();
  assert.equal(env.document.querySelector('.ak-sheet'), null);
});

test('close: a sheet at rest starts from translateY(0px), not from an empty transform', function () {
  var env = sheetEnv();
  var node = env.makeSheet();
  var handle = env.window.AppKit.sheet.show(node);
  var seen = [];
  var style = node.style;
  var value = style.transform;
  Object.defineProperty(style, 'transform', {
    get: function () { return value; },
    set: function (v) { value = v; seen.push(v); },
    enumerable: true
  });
  handle.close();
  assert.deepEqual(seen, ['translateY(0px)', 'translateY(100%)']);
});

test('close: a snap sheet at the half snap starts from the snap offset, not from 0', function () {
  var s = snapSheet();
  var seen = [];
  var style = s.node.style;
  var value = style.transform;
  Object.defineProperty(style, 'transform', {
    get: function () { return value; },
    set: function (v) { value = v; seen.push(v); },
    enumerable: true
  });
  assert.equal(offset(s), '400px');
  s.handle.close();
  assert.equal(seen[0], 'translateY(400px)');
  seen.forEach(function (v) { assert.notEqual(v, ''); });
  assert.equal(s.node.style.transform, 'translateY(100%)');
  assert.ok(s.node.parentNode);
  s.env.runTimers();
  assert.equal(s.env.document.querySelector('.ak-sheet'), null);
});

test('close: a snap sheet dragged below the lowest snap and released closes from the drag offset', function () {
  var s = snapSheet();
  var grab = head(s.node);
  var seen = [];
  var style = s.node.style;
  var value = style.transform;
  Object.defineProperty(style, 'transform', {
    get: function () { return value; },
    set: function (v) { value = v; seen.push(v); },
    enumerable: true
  });
  down(grab, 500, 0);
  move(grab, 600, 3000); // 100px below the lowest snap (400px): past the 72px threshold
  up(grab, 600, 4000);
  assert.equal(s.closed(), 1);
  assert.deepEqual(seen, ['translateY(500px)', 'translateY(500px)', 'translateY(100%)']);
  assert.ok(s.node.parentNode, 'still in the document until the timer');
  s.env.runTimers();
  assert.equal(s.env.document.querySelector('.ak-sheet'), null);
});

test('close: a drag past 72px on a plain sheet closes from that offset', function () {
  var env = sheetEnv();
  var closed = 0;
  var node = env.makeSheet();
  env.window.AppKit.sheet.show(node, { onClose: function () { closed += 1; } });
  var seen = [];
  var style = node.style;
  var value = style.transform;
  Object.defineProperty(style, 'transform', {
    get: function () { return value; },
    set: function (v) { value = v; seen.push(v); },
    enumerable: true
  });
  dragTo(head(node), 100, 190, 900);
  assert.equal(closed, 1);
  assert.deepEqual(seen, ['translateY(90px)', 'translateY(90px)', 'translateY(100%)']);
  assert.ok(env.document.querySelector('.ak-sheet-layer.ak-closing'));
  env.runTimers();
  assert.equal(env.document.querySelector('.ak-sheet'), null);
});

test('close: reduced motion still removes at once and does not animate', function () {
  var env = sheetEnv({ media: REDUCED });
  var node = env.makeSheet();
  env.window.AppKit.sheet.show(node).close();
  assert.equal(env.document.querySelector('.ak-sheet'), null);
  assert.equal(env.timers.length, 0);
  assert.equal(node.style.transform, undefined);
});

// ---------- scaleBackground ----------

test('scaleBackground: adds ak-sheet-behind and html.ak-sheet-scaled, removes them on close', function () {
  var env = sheetEnv({ media: REDUCED });
  var app = env.document.createElement('div');
  env.body.appendChild(app);
  var handle = env.window.AppKit.sheet.show(env.makeSheet(), { scaleBackground: app });
  assert.match(app.className, /\bak-sheet-behind\b/);
  assert.match(env.html.className, /\bak-sheet-scaled\b/);
  handle.close();
  assert.doesNotMatch(app.className, /ak-sheet-behind/);
  assert.doesNotMatch(env.html.className, /ak-sheet-scaled/);
});

test('scaleBackground: with motion the element scales back while the sheet slides out', function () {
  var env = sheetEnv();
  var app = env.document.createElement('div');
  app.className = 'app';
  env.body.appendChild(app);
  env.window.AppKit.sheet.show(env.makeSheet(), { scaleBackground: app }).close();
  assert.doesNotMatch(env.html.className, /ak-sheet-scaled/);
  assert.match(app.className, /ak-sheet-behind/, 'the class stays until the slide out ends');
  env.runTimers();
  assert.equal(app.className, 'app');
});

test('scaleBackground: it never touches the background of html or body', function () {
  var env = sheetEnv({ media: REDUCED });
  var app = env.document.createElement('div');
  env.body.appendChild(app);
  env.window.AppKit.sheet.show(env.makeSheet(), { scaleBackground: app });
  assert.equal(env.html.style.background, undefined);
  assert.equal(env.html.style.backgroundColor, undefined);
  assert.equal(env.body.style.background, undefined);
});

test('scaleBackground: something that is not an element is ignored', function () {
  var env = sheetEnv({ media: REDUCED });
  var handle = env.window.AppKit.sheet.show(env.makeSheet(), { scaleBackground: 'app' });
  assert.ok(handle);
  assert.doesNotMatch(env.html.className, /ak-sheet-scaled/);
});
