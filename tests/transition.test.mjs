import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEnv } from './helpers/fake-dom.mjs';

var REDUCED = { '(prefers-reduced-motion: reduce)': true };

function tick() {
  return new Promise(function (resolve) { setImmediate(resolve); });
}

function loaded(options) {
  var env = createEnv(options);
  env.load('ak-transition.js');
  return env;
}

// A fake document.startViewTransition. The update callback runs in a microtask,
// like the browser (after it captured the old state). finish() settles .finished.
function fakeViewTransition(env) {
  var api = { calls: 0, finish: null, seenAttr: [] };
  env.document.startViewTransition = function (callback) {
    api.calls += 1;
    api.seenAttr.push(env.html.getAttribute('data-ak-nav'));
    var updateCallbackDone = Promise.resolve().then(callback);
    var gate = new Promise(function (resolve) { api.finish = resolve; });
    return {
      updateCallbackDone: updateCallbackDone,
      ready: updateCallbackDone,
      finished: updateCallbackDone.then(function () { return gate; })
    };
  };
  return api;
}

// ---------- go ----------

test('go: uses startViewTransition, sets data-ak-nav, removes it when finished settles', async function () {
  var env = loaded();
  var vt = fakeViewTransition(env);
  var updates = 0;
  var p = env.window.AppKit.transition.go(function () { updates += 1; }, { direction: 'pop' });
  assert.equal(vt.calls, 1);
  assert.equal(env.html.getAttribute('data-ak-nav'), 'pop');
  assert.deepEqual(vt.seenAttr, ['pop'], 'the attribute is set before the transition starts');
  await p;
  assert.equal(updates, 1);
  assert.equal(env.html.getAttribute('data-ak-nav'), 'pop', 'still animating');
  vt.finish();
  await tick();
  assert.equal(env.html.getAttribute('data-ak-nav'), null);
});

test('go: the default direction is push', async function () {
  var env = loaded();
  var vt = fakeViewTransition(env);
  var p = env.window.AppKit.transition.go(function () {});
  assert.equal(env.html.getAttribute('data-ak-nav'), 'push');
  await p;
  vt.finish();
  await tick();
});

test('go: removes data-ak-nav when the transition finishes with an error', async function () {
  var env = loaded();
  env.document.startViewTransition = function (callback) {
    var done = Promise.resolve().then(callback);
    return { updateCallbackDone: done, ready: done, finished: done.then(function () { throw new Error('aborted'); }) };
  };
  await env.window.AppKit.transition.go(function () {});
  await tick();
  assert.equal(env.html.getAttribute('data-ak-nav'), null);
});

test('go: without startViewTransition it calls update directly, and sets nothing', async function () {
  var env = loaded();
  var updates = 0;
  var p = env.window.AppKit.transition.go(function () { updates += 1; });
  assert.equal(updates, 1, 'update ran synchronously');
  assert.equal(env.html.getAttribute('data-ak-nav'), null);
  await p;
});

test('go: reduced motion falls back to a direct call', async function () {
  var env = loaded({ media: REDUCED });
  var vt = fakeViewTransition(env);
  var updates = 0;
  await env.window.AppKit.transition.go(function () { updates += 1; });
  assert.equal(updates, 1);
  assert.equal(vt.calls, 0);
  assert.equal(env.html.getAttribute('data-ak-nav'), null);
});

test('go: direction none skips the view transition', async function () {
  var env = loaded();
  var vt = fakeViewTransition(env);
  var updates = 0;
  await env.window.AppKit.transition.go(function () { updates += 1; }, { direction: 'none' });
  assert.equal(updates, 1);
  assert.equal(vt.calls, 0);
  assert.equal(env.html.getAttribute('data-ak-nav'), null);
});

test('go: the Promise resolves after an async update has finished', async function () {
  var env = loaded();
  var vt = fakeViewTransition(env);
  var order = [];
  var p = env.window.AppKit.transition.go(function () {
    return new Promise(function (resolve) {
      setImmediate(function () { order.push('update'); resolve(); });
    });
  });
  p.then(function () { order.push('resolved'); });
  await p;
  await tick();
  assert.deepEqual(order, ['update', 'resolved']);
  vt.finish();
});

test('go: rejects when update throws, with and without a view transition', async function () {
  var plain = loaded();
  await assert.rejects(plain.window.AppKit.transition.go(function () { throw new Error('boom'); }), /boom/);

  var env = loaded();
  var vt = fakeViewTransition(env);
  await assert.rejects(env.window.AppKit.transition.go(function () { throw new Error('boom2'); }), /boom2/);
  vt.finish();
});

test('go: rejects when update rejects', async function () {
  var env = loaded();
  await assert.rejects(env.window.AppKit.transition.go(function () { return Promise.reject(new Error('nope')); }), /nope/);
});

test('go: never throws synchronously, not even when startViewTransition throws', async function () {
  var env = loaded();
  env.document.startViewTransition = function () { throw new Error('not allowed'); };
  var updates = 0;
  var p;
  assert.doesNotThrow(function () { p = env.window.AppKit.transition.go(function () { updates += 1; }); });
  await p;
  assert.equal(updates, 1, 'the update still ran');
  assert.equal(env.html.getAttribute('data-ak-nav'), null);

  var bad;
  assert.doesNotThrow(function () { bad = env.window.AppKit.transition.go(null); });
  await assert.rejects(bad, /update must be a function/);
});

test('go: loading twice keeps the first AppKit.transition', function () {
  var env = loaded();
  var first = env.window.AppKit.transition;
  env.load('ak-transition.js');
  assert.equal(env.window.AppKit.transition, first);
});

// ---------- swipeBack ----------

function touch(x, y) {
  return { clientX: x, clientY: y };
}

// Plays a one finger gesture. points: [[x, y, t], ...]. First is touchstart, the
// rest are touchmove, and the finger lifts at the last point's time.
function gesture(env, points) {
  var prevented = 0;
  env.fireDocument('touchstart', { touches: [touch(points[0][0], points[0][1])], timeStamp: points[0][2] });
  for (var i = 1; i < points.length; i++) {
    env.fireDocument('touchmove', {
      touches: [touch(points[i][0], points[i][1])],
      timeStamp: points[i][2],
      cancelable: true,
      preventDefault: function () { prevented += 1; }
    });
  }
  var last = points[points.length - 1];
  env.fireDocument('touchend', { touches: [], timeStamp: last[2] });
  return { prevented: prevented };
}

function forced(options) {
  var env = loaded(options);
  var backs = 0;
  var target = env.document.createElement('div');
  var swipe = env.window.AppKit.transition.swipeBack({
    force: true,
    target: target,
    onBack: function () { backs += 1; }
  });
  return { env: env, swipe: swipe, target: target, backs: function () { return backs; } };
}

test('swipeBack: needs an onBack function', function () {
  var env = loaded();
  assert.throws(function () { env.window.AppKit.transition.swipeBack({}); }, /onBack must be a function/);
});

test('swipeBack: in a browser tab it is inert and adds no listener', function () {
  var env = loaded();
  var backs = 0;
  var swipe = env.window.AppKit.transition.swipeBack({ onBack: function () { backs += 1; } });
  assert.equal(typeof swipe.destroy, 'function');
  assert.equal(env.docHandlerCount('touchstart'), 0);
  gesture(env, [[5, 300, 0], [100, 300, 300], [250, 300, 600]]);
  assert.equal(backs, 0);
  swipe.destroy();
});

test('swipeBack: works in a standalone app (display-mode, or navigator.standalone)', function () {
  var a = loaded({ media: { '(display-mode: standalone)': true } });
  a.window.AppKit.transition.swipeBack({ onBack: function () {} });
  assert.equal(a.docHandlerCount('touchstart'), 1);

  var b = loaded({ standalone: true });
  b.window.AppKit.transition.swipeBack({ onBack: function () {} });
  assert.equal(b.docHandlerCount('touchstart'), 1);
});

test('swipeBack: a drag from the edge past the threshold calls onBack once', function () {
  var t = forced();
  var result = gesture(t.env, [[5, 300, 0], [100, 304, 300], [200, 304, 600]]);
  assert.equal(t.backs(), 1);
  assert.ok(result.prevented > 0, 'a committed horizontal drag does not scroll the page');
  assert.equal(t.target.style.transform, '');
});

test('swipeBack: the target follows the finger while dragging', function () {
  var t = forced();
  t.env.fireDocument('touchstart', { touches: [touch(5, 300)], timeStamp: 0 });
  t.env.fireDocument('touchmove', { touches: [touch(105, 302)], timeStamp: 100, cancelable: true, preventDefault: function () {} });
  assert.equal(t.target.style.transform, 'translateX(100px)');
  t.env.fireDocument('touchend', { touches: [], timeStamp: 900 });
  assert.equal(t.backs(), 0);
  assert.equal(t.target.style.transform, '', 'springs back');
});

test('swipeBack: a drag that starts past the edge does nothing', function () {
  var t = forced();
  gesture(t.env, [[50, 300, 0], [150, 300, 300], [300, 300, 600]]);
  assert.equal(t.backs(), 0);
  assert.ok(!t.target.style.transform);
});

test('swipeBack: opts.edge changes the start zone', function () {
  var env = loaded();
  var backs = 0;
  env.window.AppKit.transition.swipeBack({ force: true, edge: 60, target: env.document.createElement('div'), onBack: function () { backs += 1; } });
  gesture(env, [[50, 300, 0], [150, 300, 300], [300, 300, 600]]);
  assert.equal(backs, 1);
});

test('swipeBack: a mostly vertical drag does not go back', function () {
  var t = forced();
  gesture(t.env, [[5, 300, 0], [25, 420, 100], [220, 560, 400]]);
  assert.equal(t.backs(), 0);
  assert.ok(!t.target.style.transform);
});

test('swipeBack: a drag to the left does not go back', function () {
  var t = forced();
  gesture(t.env, [[5, 300, 0], [0, 300, 300], [0, 300, 600]]);
  assert.equal(t.backs(), 0);
});

test('swipeBack: a short, slow drag springs back without onBack', function () {
  var t = forced();
  gesture(t.env, [[5, 300, 0], [60, 300, 300], [100, 300, 600]]);
  assert.equal(t.backs(), 0);
  assert.equal(t.target.style.transform, '');
});

test('swipeBack: a fast short flick goes back', function () {
  var t = forced();
  gesture(t.env, [[5, 300, 0], [60, 302, 40], [100, 302, 80]]);
  assert.equal(t.backs(), 1);
});

test('swipeBack: opts.threshold changes the commit distance', function () {
  var env = loaded();
  var backs = 0;
  env.window.AppKit.transition.swipeBack({ force: true, threshold: 0.1, target: env.document.createElement('div'), onBack: function () { backs += 1; } });
  gesture(env, [[5, 300, 0], [30, 300, 400], [60, 300, 800]]);
  assert.equal(backs, 1);
});

test('swipeBack: two fingers are ignored', function () {
  var t = forced();
  t.env.fireDocument('touchstart', { touches: [touch(5, 300), touch(200, 300)], timeStamp: 0 });
  t.env.fireDocument('touchmove', { touches: [touch(300, 300), touch(200, 300)], timeStamp: 300, cancelable: true, preventDefault: function () {} });
  t.env.fireDocument('touchend', { touches: [], timeStamp: 600 });
  assert.equal(t.backs(), 0);
});

test('swipeBack: reduced motion does not move the target, but still goes back', function () {
  var t = forced({ media: REDUCED });
  gesture(t.env, [[5, 300, 0], [100, 300, 300], [200, 300, 600]]);
  assert.equal(t.backs(), 1);
  assert.ok(!t.target.style.transform);
});

test('swipeBack: without a target it moves the first .ak-screen, else the body', function () {
  var env = loaded();
  var screen = env.document.createElement('main');
  screen.className = 'ak-screen';
  env.body.appendChild(screen);
  env.window.AppKit.transition.swipeBack({ force: true, onBack: function () {} });
  env.fireDocument('touchstart', { touches: [touch(5, 300)], timeStamp: 0 });
  env.fireDocument('touchmove', { touches: [touch(80, 300)], timeStamp: 300, cancelable: true, preventDefault: function () {} });
  assert.equal(screen.style.transform, 'translateX(75px)');
  assert.ok(!env.body.style.transform);
  env.fireDocument('touchend', { touches: [], timeStamp: 900 });

  var plain = loaded();
  plain.window.AppKit.transition.swipeBack({ force: true, onBack: function () {} });
  plain.fireDocument('touchstart', { touches: [touch(5, 300)], timeStamp: 0 });
  plain.fireDocument('touchmove', { touches: [touch(80, 300)], timeStamp: 300, cancelable: true, preventDefault: function () {} });
  assert.equal(plain.body.style.transform, 'translateX(75px)');
});

test('swipeBack: destroy removes every listener and stops the gesture', function () {
  var t = forced();
  ['touchstart', 'touchmove', 'touchend', 'touchcancel'].forEach(function (type) {
    assert.equal(t.env.docHandlerCount(type), 1, type);
  });
  t.swipe.destroy();
  ['touchstart', 'touchmove', 'touchend', 'touchcancel'].forEach(function (type) {
    assert.equal(t.env.docHandlerCount(type), 0, type);
  });
  gesture(t.env, [[5, 300, 0], [100, 300, 300], [250, 300, 600]]);
  assert.equal(t.backs(), 0);
});

test('swipeBack: touchcancel springs back without onBack', function () {
  var t = forced();
  t.env.fireDocument('touchstart', { touches: [touch(5, 300)], timeStamp: 0 });
  t.env.fireDocument('touchmove', { touches: [touch(250, 300)], timeStamp: 300, cancelable: true, preventDefault: function () {} });
  t.env.fireDocument('touchcancel', { touches: [], timeStamp: 310 });
  assert.equal(t.backs(), 0);
  assert.equal(t.target.style.transform, '');
});
