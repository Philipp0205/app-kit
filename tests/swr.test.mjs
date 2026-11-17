import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEnv } from './helpers/fake-dom.mjs';

function tick() {
  return new Promise(function (resolve) { setImmediate(resolve); });
}

function swrEnv() {
  var env = createEnv();
  env.load('ak-swr.js');
  return env;
}

function store(env, key, value, ageMs) {
  env.window.localStorage.setItem('ak-swr:' + key, JSON.stringify({ t: Date.now() - (ageMs || 0), v: value }));
}

function deferred() {
  var d = {};
  d.promise = new Promise(function (resolve, reject) { d.resolve = resolve; d.reject = reject; });
  return d;
}

function recorder() {
  var calls = [];
  function render(value, info) { calls.push({ value: value, info: info }); }
  render.calls = calls;
  return render;
}

test('swr: with a cache it renders the stale value synchronously, before fetching, then the fresh one', async function () {
  var env = swrEnv();
  store(env, 'closet', { n: 1 }, 5000);
  var order = [];
  var render = function (value, info) { order.push(info.stale ? 'stale' : 'fresh'); render.calls.push({ value: value, info: info }); };
  render.calls = [];
  var fetched = false;
  var p = env.window.AppKit.swr('closet', function () { order.push('fetch'); fetched = true; return Promise.resolve({ n: 2 }); }, render);
  assert.deepEqual(order, ['stale', 'fetch'], 'stale render happened before the call returned, and before fetch');
  assert.equal(fetched, true);
  var result = await p;
  assert.deepEqual(order, ['stale', 'fetch', 'fresh']);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { n: 2 });
  assert.deepEqual(JSON.parse(JSON.stringify(render.calls[0].value)), { n: 1 });
  assert.equal(render.calls[0].info.stale, true);
  assert.ok(render.calls[0].info.age >= 5000 && render.calls[0].info.age < 6000);
  assert.deepEqual(JSON.parse(JSON.stringify(render.calls[1].value)), { n: 2 });
  assert.equal(render.calls[1].info.stale, false);
  var stored = JSON.parse(env.window.localStorage.getItem('ak-swr:closet'));
  assert.deepEqual(stored.v, { n: 2 });
  assert.equal(typeof stored.t, 'number');
});

test('swr: without a cache it fetches, renders once as fresh, and stores the value', async function () {
  var env = swrEnv();
  var render = recorder();
  var value = await env.window.AppKit.swr('k', function () { return Promise.resolve([1, 2]); }, render);
  assert.equal(render.calls.length, 1);
  assert.equal(render.calls[0].info.stale, false);
  assert.equal(render.calls[0].info.age, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(value)), [1, 2]);
  assert.deepEqual(JSON.parse(env.window.localStorage.getItem('ak-swr:k')).v, [1, 2]);
});

test('swr: identical fresh data does not render a second time, but the cache timestamp is renewed', async function () {
  var env = swrEnv();
  store(env, 'k', { a: 1, b: [2] }, 10000);
  var render = recorder();
  await env.window.AppKit.swr('k', function () { return Promise.resolve({ a: 1, b: [2] }); }, render);
  assert.equal(render.calls.length, 1);
  assert.equal(render.calls[0].info.stale, true);
  var t = JSON.parse(env.window.localStorage.getItem('ak-swr:k')).t;
  assert.ok(Date.now() - t < 5000);
});

test('swr: different fresh data renders again', async function () {
  var env = swrEnv();
  store(env, 'k', { a: 1 });
  var render = recorder();
  await env.window.AppKit.swr('k', function () { return Promise.resolve({ a: 2 }); }, render);
  assert.equal(render.calls.length, 2);
});

test('swr: no cache and a fetch error rejects, and onError is called', async function () {
  var env = swrEnv();
  var render = recorder();
  var errors = [];
  await assert.rejects(
    env.window.AppKit.swr('k', function () { return Promise.reject(new Error('offline')); }, render, { onError: function (e) { errors.push(e.message); } }),
    /offline/
  );
  assert.equal(render.calls.length, 0);
  assert.deepEqual(errors, ['offline']);
});

test('swr: no cache, a fetch error and no onError still rejects', async function () {
  var env = swrEnv();
  await assert.rejects(env.window.AppKit.swr('k', function () { return Promise.reject(new Error('x')); }, recorder()), /x/);
});

test('swr: a fetcher that throws synchronously is an error, not a throw', async function () {
  var env = swrEnv();
  var p;
  assert.doesNotThrow(function () {
    p = env.window.AppKit.swr('k', function () { throw new Error('sync'); }, recorder());
  });
  await assert.rejects(p, /sync/);
});

test('swr: a cache and a fetch error resolves with the cached value and calls onError', async function () {
  var env = swrEnv();
  store(env, 'k', { cached: true });
  var render = recorder();
  var errors = [];
  var value = await env.window.AppKit.swr('k', function () { return Promise.reject(new Error('down')); }, render, {
    onError: function (e) { errors.push(e.message); }
  });
  assert.deepEqual(JSON.parse(JSON.stringify(value)), { cached: true });
  assert.deepEqual(errors, ['down']);
  assert.equal(render.calls.length, 1);
  assert.deepEqual(JSON.parse(env.window.localStorage.getItem('ak-swr:k')).v, { cached: true }, 'the cache is kept');
});

test('swr: maxAge skips an old cached value but still replaces it', async function () {
  var env = swrEnv();
  store(env, 'k', { old: true }, 60000);
  var render = recorder();
  await env.window.AppKit.swr('k', function () { return Promise.resolve({ fresh: true }); }, render, { maxAge: 1000 });
  assert.equal(render.calls.length, 1);
  assert.equal(render.calls[0].info.stale, false);
  assert.deepEqual(JSON.parse(env.window.localStorage.getItem('ak-swr:k')).v, { fresh: true });
});

test('swr: an expired cache and a fetch error rejects, because nothing was shown', async function () {
  var env = swrEnv();
  store(env, 'k', { old: true }, 60000);
  await assert.rejects(env.window.AppKit.swr('k', function () { return Promise.reject(new Error('down')); }, recorder(), { maxAge: 1000 }), /down/);
});

test('swr: a cache younger than maxAge is rendered', async function () {
  var env = swrEnv();
  store(env, 'k', { v: 1 }, 500);
  var render = recorder();
  await env.window.AppKit.swr('k', function () { return Promise.resolve({ v: 1 }); }, render, { maxAge: 1000 });
  assert.equal(render.calls.length, 1);
  assert.equal(render.calls[0].info.stale, true);
});

test('swr: the same data after an expired cache still renders (nothing was shown before)', async function () {
  var env = swrEnv();
  store(env, 'k', { v: 1 }, 60000);
  var render = recorder();
  await env.window.AppKit.swr('k', function () { return Promise.resolve({ v: 1 }); }, render, { maxAge: 1000 });
  assert.equal(render.calls.length, 1);
  assert.equal(render.calls[0].info.stale, false);
});

test('swr: concurrent calls with the same key share one fetch, each renders', async function () {
  var env = swrEnv();
  var d = deferred();
  var fetches = 0;
  function fetcher() { fetches += 1; return d.promise; }
  var r1 = recorder();
  var r2 = recorder();
  var p1 = env.window.AppKit.swr('k', fetcher, r1);
  var p2 = env.window.AppKit.swr('k', fetcher, r2);
  assert.equal(fetches, 1);
  d.resolve({ x: 1 });
  var values = await Promise.all([p1, p2]);
  assert.equal(fetches, 1);
  assert.equal(r1.calls.length, 1);
  assert.equal(r2.calls.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(values[0])), { x: 1 });
  assert.deepEqual(JSON.parse(JSON.stringify(values[1])), { x: 1 });
});

test('swr: a finished fetch is not reused, and different keys do not share', async function () {
  var env = swrEnv();
  var fetches = 0;
  function fetcher() { fetches += 1; return Promise.resolve(fetches); }
  await env.window.AppKit.swr('a', fetcher, recorder());
  await tick();
  await env.window.AppKit.swr('a', fetcher, recorder());
  assert.equal(fetches, 2);
  var d = deferred();
  var other = 0;
  var p1 = env.window.AppKit.swr('x', function () { return d.promise; }, recorder());
  var p2 = env.window.AppKit.swr('y', function () { other += 1; return Promise.resolve(1); }, recorder());
  assert.equal(other, 1);
  d.resolve(1);
  await Promise.all([p1, p2]);
});

test('swr: a failed shared fetch frees the key so a retry fetches again', async function () {
  var env = swrEnv();
  var fetches = 0;
  function fetcher() { fetches += 1; return fetches === 1 ? Promise.reject(new Error('1')) : Promise.resolve('ok'); }
  await assert.rejects(env.window.AppKit.swr('k', fetcher, recorder()), /1/);
  await tick();
  assert.equal(await env.window.AppKit.swr('k', fetcher, recorder()), 'ok');
  assert.equal(fetches, 2);
});

test('swr.clear(key) removes one key, swr.clear() removes every ak-swr: key and nothing else', function () {
  var env = swrEnv();
  store(env, 'a', 1);
  store(env, 'b', 2);
  env.window.localStorage.setItem('other', 'keep');
  env.window.localStorage.setItem('ak-scroll:x', 'keep');
  env.window.AppKit.swr.clear('a');
  assert.equal(env.window.localStorage.getItem('ak-swr:a'), null);
  assert.notEqual(env.window.localStorage.getItem('ak-swr:b'), null);
  env.window.AppKit.swr.clear();
  assert.equal(env.window.localStorage.getItem('ak-swr:b'), null);
  assert.equal(env.window.localStorage.getItem('other'), 'keep');
  assert.equal(env.window.localStorage.getItem('ak-scroll:x'), 'keep');
});

test('swr: bad JSON and wrongly shaped entries mean no cache', async function () {
  var env = swrEnv();
  env.window.localStorage.setItem('ak-swr:a', '{not json');
  env.window.localStorage.setItem('ak-swr:b', JSON.stringify({ v: 1 }));
  env.window.localStorage.setItem('ak-swr:c', JSON.stringify({ t: 'x', v: 1 }));
  env.window.localStorage.setItem('ak-swr:d', 'null');
  for (var key of ['a', 'b', 'c', 'd']) {
    var render = recorder();
    await env.window.AppKit.swr(key, function () { return Promise.resolve('fresh'); }, render);
    assert.equal(render.calls.length, 1, key);
    assert.equal(render.calls[0].info.stale, false, key);
  }
});

test('swr: a cached null or false value is still a cache hit', async function () {
  var env = swrEnv();
  store(env, 'n', null);
  var render = recorder();
  await env.window.AppKit.swr('n', function () { return Promise.resolve(null); }, render);
  assert.equal(render.calls.length, 1);
  assert.equal(render.calls[0].value, null);
  assert.equal(render.calls[0].info.stale, true);
});

function brokenStorage() {
  function boom() { throw new Error('SecurityError'); }
  return { getItem: boom, setItem: boom, removeItem: boom, key: boom, get length() { throw new Error('SecurityError'); } };
}

test('swr: a localStorage that throws on every call still works, without a cache', async function () {
  var env = swrEnv();
  env.window.localStorage = brokenStorage();
  var render = recorder();
  var value = await env.window.AppKit.swr('k', function () { return Promise.resolve({ ok: 1 }); }, render);
  assert.deepEqual(JSON.parse(JSON.stringify(value)), { ok: 1 });
  assert.equal(render.calls.length, 1);
  assert.doesNotThrow(function () { env.window.AppKit.swr.clear('k'); });
  assert.doesNotThrow(function () { env.window.AppKit.swr.clear(); });
});

test('swr: a localStorage that throws on write keeps the fresh value and the result', async function () {
  var env = swrEnv();
  var real = env.window.localStorage;
  env.window.localStorage = {
    getItem: function (k) { return real.getItem(k); },
    setItem: function () { throw new Error('QuotaExceededError'); },
    removeItem: function (k) { real.removeItem(k); }
  };
  var render = recorder();
  await env.window.AppKit.swr('k', function () { return Promise.resolve('v'); }, render);
  assert.equal(render.calls.length, 1);
});

test('swr: a missing localStorage (the property itself throws) still works', async function () {
  var env = swrEnv();
  Object.defineProperty(env.window, 'localStorage', { get: function () { throw new Error('denied'); }, configurable: true });
  var value = await env.window.AppKit.swr('k', function () { return Promise.resolve(3); }, recorder());
  assert.equal(value, 3);
});

test('swr: fetcher and render must be functions', async function () {
  var env = swrEnv();
  await assert.rejects(env.window.AppKit.swr('k', null, recorder()), /must be functions/);
  await assert.rejects(env.window.AppKit.swr('k', function () { return 1; }), /must be functions/);
});

test('swr: a render that throws for the stale value rejects instead of throwing synchronously', async function () {
  var env = swrEnv();
  store(env, 'k', 1);
  var p;
  assert.doesNotThrow(function () {
    p = env.window.AppKit.swr('k', function () { return Promise.resolve(2); }, function () { throw new Error('render'); });
  });
  await assert.rejects(p, /render/);
});

test('swr: the fetcher may return a plain value', async function () {
  var env = swrEnv();
  assert.equal(await env.window.AppKit.swr('k', function () { return 7; }, recorder()), 7);
});

test('swr: loading twice keeps the first AppKit.swr', function () {
  var env = swrEnv();
  var first = env.window.AppKit.swr;
  env.load('ak-swr.js');
  assert.equal(env.window.AppKit.swr, first);
});
