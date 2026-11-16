import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'frontend', 'ak-sw.js'), 'utf8');
const BASE = 'https://app.test';

// A real Request, but relative URLs resolve against the worker's origin (a
// worker does that on its own, Node's Request does not).
class BaseRequest extends Request {
  constructor(input, init) {
    super(new URL(input, BASE).href, init);
  }
}

function keyOf(input) {
  return new URL(typeof input === 'string' ? input : input.url, BASE).href;
}

// A fake worker global. Nothing is loaded until load() runs the kit script.
function createWorker() {
  const w = {
    listeners: {},
    store: new Map(),   // cache name -> FakeCache
    touches: 0,         // any call into caches or a cache
    fetched: [],        // URLs the worker asked the network for
    log: [],            // delete/claim order
    skipWaitingCalls: 0,
    online: true,
    serve: (url) => new Response('net ' + url),
  };

  class FakeCache {
    constructor() {
      this.entries = new Map();
      this.added = null;
    }
    async addAll(requests) {
      w.touches++;
      this.added = requests;
      for (const r of requests) this.entries.set(keyOf(r), new Response('shell ' + r.url));
    }
    async put(request, response) {
      w.touches++;
      this.entries.set(keyOf(request), response);
    }
    async match(request) {
      w.touches++;
      const hit = this.entries.get(keyOf(request));
      return hit ? hit.clone() : undefined;
    }
  }

  const sandbox = {
    URL, Request: BaseRequest, Response, Promise, Map, Set, Error, TypeError,
    location: { origin: BASE },
    addEventListener(type, fn) {
      (w.listeners[type] = w.listeners[type] || []).push(fn);
    },
    fetch(request) {
      w.fetched.push(request.url);
      if (!w.online) return Promise.reject(new TypeError('Failed to fetch'));
      return Promise.resolve(w.serve(request.url));
    },
    skipWaiting() { w.skipWaitingCalls++; },
    clients: { claim() { w.log.push('claim'); return Promise.resolve(); } },
    caches: {
      async open(name) {
        w.touches++;
        if (!w.store.has(name)) w.store.set(name, new FakeCache());
        return w.store.get(name);
      },
      async keys() { w.touches++; return Array.from(w.store.keys()); },
      async delete(name) { w.touches++; w.log.push('delete ' + name); return w.store.delete(name); },
      async match(request) {
        w.touches++;
        for (const cache of w.store.values()) {
          const hit = await cache.match(request);
          if (hit) return hit;
        }
        return undefined;
      },
    },
  };
  sandbox.self = sandbox;
  vm.createContext(sandbox);

  w.self = sandbox;
  w.load = () => vm.runInContext(SOURCE, sandbox, { filename: 'ak-sw.js' });
  w.setup = (options) => sandbox.AppKitSW.setup(options);
  w.seed = (cacheName, url, body) => {
    if (!w.store.has(cacheName)) w.store.set(cacheName, new FakeCache());
    w.store.get(cacheName).entries.set(keyOf(url), new Response(body));
  };
  w.cachedText = async (cacheName, url) => {
    const cache = w.store.get(cacheName);
    const hit = cache && cache.entries.get(keyOf(url));
    return hit ? hit.clone().text() : undefined;
  };
  w.cacheNames = () => Array.from(w.store.keys()).sort();

  w.install = async () => {
    const waits = [];
    (w.listeners.install || []).forEach((fn) => fn({ waitUntil: (p) => waits.push(p) }));
    await Promise.all(waits);
  };
  w.activate = async () => {
    const waits = [];
    (w.listeners.activate || []).forEach((fn) => fn({ waitUntil: (p) => waits.push(p) }));
    await Promise.all(waits);
  };
  w.message = (data) => {
    (w.listeners.message || []).forEach((fn) => fn({ data }));
  };
  // Dispatches a fetch event. Returns what the listeners did.
  w.dispatchFetch = (request) => {
    const answers = [];
    const waits = [];
    const state = { stopped: false };
    const event = {
      request,
      respondWith(p) {
        if (answers.length > 0) throw new Error('InvalidStateError: already responded');
        Promise.resolve(p).catch(() => {});
        answers.push(p);
      },
      waitUntil(p) { waits.push(p); },
      stopImmediatePropagation() { state.stopped = true; },
    };
    (w.listeners.fetch || []).forEach((fn) => fn(event));
    return {
      handled: answers.length > 0,
      stopped: () => state.stopped,
      // The response (or the error), after the background cache work is done.
      result: async () => {
        let out;
        try {
          out = { response: await answers[0] };
        } catch (error) {
          out = { error };
        }
        await Promise.allSettled(waits);
        return out;
      },
    };
  };
  w.run = (request) => w.dispatchFetch(request).result();
  return w;
}

function worker(options) {
  const w = createWorker();
  w.load();
  w.api = w.setup(options);
  return w;
}

function headers(map) {
  const lower = {};
  Object.keys(map || {}).forEach((k) => { lower[k.toLowerCase()] = map[k]; });
  return {
    has: (name) => Object.prototype.hasOwnProperty.call(lower, name.toLowerCase()),
    get: (name) => (Object.prototype.hasOwnProperty.call(lower, name.toLowerCase()) ? lower[name.toLowerCase()] : null),
  };
}

// A plain object, as a fetch event carries it. A path or a full URL.
function req(target, extra) {
  const o = extra || {};
  return {
    url: target.startsWith('http') ? target : BASE + target,
    method: o.method || 'GET',
    mode: o.mode || 'no-cors',
    headers: headers(o.headers),
  };
}
function nav(target) { return req(target, { mode: 'navigate' }); }

const SHELL = ['/', '/style.css', '/app.js'];
const PM = { version: 'v1', prefix: 'pm', shell: SHELL, runtime: [{ match: '/vendor/', cache: 'vendor' }] };

// ---------- setup ----------

test('only self.AppKitSW is added, and a second load does nothing', function () {
  const w = createWorker();
  const before = Object.keys(w.self);
  w.load();
  const added = Object.keys(w.self).filter((k) => !before.includes(k));
  assert.deepEqual(added, ['AppKitSW']);
  const first = w.self.AppKitSW;
  w.load();
  assert.equal(w.self.AppKitSW, first);
});

test('setup: version is required', function () {
  [undefined, '', 1, null].forEach((version) => {
    const w = createWorker();
    w.load();
    assert.throws(() => w.setup({ version }), TypeError);
    assert.deepEqual(w.listeners, {}, 'a failed setup registers nothing');
  });
  const w = createWorker();
  w.load();
  assert.throws(() => w.setup(), TypeError);
});

test('setup: prefix allows letters, digits, _ and - only', function () {
  ['', 'a b', 'a/b', 'a.b', 'é', 1].forEach((prefix) => {
    const w = createWorker();
    w.load();
    assert.throws(() => w.setup({ version: 'v1', prefix }), TypeError, String(prefix));
  });
  const w = createWorker();
  w.load();
  assert.doesNotThrow(() => w.setup({ version: 'v1', prefix: 'My_app-2' }));
});

test('setup: runtime strategy and cache name are checked', function () {
  const bad = [
    { match: '/v/', cache: 'x', strategy: 'stale-while-revalidate' },
    { match: '/v/', strategy: 'cache-first' },
    { match: '/v/', cache: '' },
    { match: '/v/', cache: 'a b' },
    { match: '/v/', cache: 'a/b' },
  ];
  bad.forEach((rule) => {
    const w = createWorker();
    w.load();
    assert.throws(() => w.setup({ version: 'v1', runtime: [rule] }), TypeError, JSON.stringify(rule));
  });
  ['cache-first', 'network-first', undefined].forEach((strategy) => {
    const w = createWorker();
    w.load();
    assert.doesNotThrow(() => w.setup({ version: 'v1', runtime: [{ match: '/v/', cache: 'x', strategy }] }));
  });
});

test('setup returns the shell cache name, prefix defaults to ak', function () {
  assert.equal(worker({ version: 'v7' }).api.shellCache, 'ak-shell-v7');
  assert.equal(worker(PM).api.shellCache, 'pm-shell-v1');
  assert.deepEqual(Object.keys(worker(PM).api), ['shellCache']);
});

test('setup registers install, activate, fetch and message listeners', function () {
  const w = worker(PM);
  assert.deepEqual(Object.keys(w.listeners).sort(), ['activate', 'fetch', 'install', 'message']);
});

// ---------- install ----------

test('install precaches the shell with reload requests in the versioned cache', async function () {
  const w = worker(PM);
  await w.install();
  assert.deepEqual(w.cacheNames(), ['pm-shell-v1']);
  const added = w.store.get('pm-shell-v1').added;
  assert.deepEqual(Array.from(added, (r) => r.url), SHELL.map((p) => BASE + p));
  added.forEach((r) => {
    assert.ok(r instanceof Request);
    assert.equal(r.cache, 'reload');
  });
  assert.equal(await w.cachedText('pm-shell-v1', '/app.js'), 'shell ' + BASE + '/app.js');
});

test('install does not call skipWaiting', async function () {
  const w = worker(PM);
  await w.install();
  assert.equal(w.skipWaitingCalls, 0);
});

test('install with no shell opens an empty shell cache', async function () {
  const w = worker({ version: 'v1' });
  await w.install();
  assert.deepEqual(w.cacheNames(), ['ak-shell-v1']);
});

// ---------- activate ----------

test('activate deletes old prefix caches, keeps current and foreign ones, then claims', async function () {
  const w = worker({
    version: 'v2', prefix: 'pm',
    runtime: [{ match: '/vendor/', cache: 'vendor' }, { match: '/img/', cache: 'img' }],
  });
  ['pm-shell-v2', 'pm-vendor', 'pm-shell-v1', 'pm-v22', 'pm-gone',
    'other-shell-v1', 'other-vendor', 'pmx-shell-v1', 'pm'].forEach((name) => w.seed(name, '/', 'x'));
  await w.activate();
  assert.deepEqual(w.cacheNames(), ['other-shell-v1', 'other-vendor', 'pm', 'pm-shell-v2', 'pm-vendor', 'pmx-shell-v1']);
  assert.equal(w.log[w.log.length - 1], 'claim');
  assert.equal(w.log.filter((l) => l === 'claim').length, 1);
  assert.deepEqual(w.log.filter((l) => l.startsWith('delete')).sort(),
    ['delete pm-gone', 'delete pm-shell-v1', 'delete pm-v22']);
  assert.equal(w.skipWaitingCalls, 0);
});

test('activate removes a hand-written legacy cache when prefix matches it', async function () {
  const w = worker({ version: 'v1', prefix: 'loaner' });
  w.seed('loaner-v22', '/', 'old');
  await w.activate();
  assert.deepEqual(w.cacheNames(), []);
});

test('activate claims even with nothing to delete', async function () {
  const w = worker(PM);
  await w.activate();
  assert.deepEqual(w.log, ['claim']);
});

// ---------- fetch: never touched ----------

test('GET /api/x, POST, cross-origin and Range requests are not handled and touch nothing', function () {
  const w = worker(PM);
  const cases = [
    req('/api/x'),
    req('/api/'),
    req('/app.js', { method: 'POST' }),
    req('/app.js', { method: 'PUT' }),
    req('https://other.test/app.js'),
    req('/vendor/blob.bin', { headers: { Range: 'bytes=0-9' } }),
    req('/app.js', { headers: { range: 'bytes=0-9' } }),
    nav('/api/page'),
  ];
  cases.forEach((request) => {
    const r = w.dispatchFetch(request);
    assert.equal(r.handled, false, request.method + ' ' + request.url);
  });
  assert.equal(w.touches, 0);
  assert.deepEqual(w.fetched, []);
});

test('networkOnly is configurable and beats runtime rules', function () {
  const w = worker({
    version: 'v1', prefix: 'pm', networkOnly: ['/feed/', '/vendor/private/'],
    runtime: [{ match: '/vendor/', cache: 'vendor' }],
  });
  assert.equal(w.dispatchFetch(req('/feed/1')).handled, false);
  assert.equal(w.dispatchFetch(req('/vendor/private/a.bin')).handled, false);
  assert.equal(w.dispatchFetch(req('/vendor/public.bin')).handled, true);
  // The default list is replaced, not extended.
  assert.equal(w.dispatchFetch(req('/api/x')).handled, true);
});

// ---------- fetch: shell ----------

test('navigation is network-first and a success refreshes a precached URL', async function () {
  const w = worker(PM);
  await w.install();
  const { response, error } = await w.run(nav('/'));
  assert.equal(error, undefined);
  assert.equal(await response.text(), 'net ' + BASE + '/');
  assert.equal(await w.cachedText('pm-shell-v1', '/'), 'net ' + BASE + '/');
  assert.deepEqual(w.fetched, [BASE + '/']);
});

test('a URL that is not precached is passed through and not stored', async function () {
  const w = worker(PM);
  await w.install();
  const { response } = await w.run(req('/other.js'));
  assert.equal(await response.text(), 'net ' + BASE + '/other.js');
  assert.equal(await w.cachedText('pm-shell-v1', '/other.js'), undefined);
  assert.deepEqual(w.cacheNames(), ['pm-shell-v1']);
});

test('a non-200 answer is passed through and does not replace the cached entry', async function () {
  const w = worker(PM);
  await w.install();
  w.serve = () => new Response('missing', { status: 404 });
  const { response } = await w.run(req('/app.js'));
  assert.equal(response.status, 404);
  assert.equal(await response.text(), 'missing');
  assert.equal(await w.cachedText('pm-shell-v1', '/app.js'), 'shell ' + BASE + '/app.js');
  w.serve = () => new Response('partial', { status: 206 });
  await w.run(req('/app.js'));
  assert.equal(await w.cachedText('pm-shell-v1', '/app.js'), 'shell ' + BASE + '/app.js');
});

test('offline: a cached request is served', async function () {
  const w = worker(PM);
  await w.install();
  w.online = false;
  const { response } = await w.run(req('/style.css'));
  assert.equal(await response.text(), 'shell ' + BASE + '/style.css');
});

test('offline navigation: the cached page, else the fallback shell page', async function () {
  const w = worker(PM);
  await w.install();
  w.seed('pm-shell-v1', '/page', 'cached page');
  w.online = false;
  const hit = await w.run(nav('/page'));
  assert.equal(await hit.response.text(), 'cached page');
  const fallback = await w.run(nav('/unknown/route'));
  assert.equal(await fallback.response.text(), 'shell ' + BASE + '/');
});

test('offlineFallback is configurable', async function () {
  const w = worker({ version: 'v1', prefix: 'pm', shell: ['/', '/offline.html'], offlineFallback: '/offline.html' });
  await w.install();
  w.online = false;
  const { response } = await w.run(nav('/x'));
  assert.equal(await response.text(), 'shell ' + BASE + '/offline.html');
});

test('offline and nothing cached: the network error is rethrown', async function () {
  const w = worker(PM);
  await w.install();
  w.online = false;
  const sub = await w.run(req('/missing.js'));
  assert.equal(sub.response, undefined);
  assert.equal(sub.error.message, 'Failed to fetch');
  // A navigation with no fallback page in the cache rejects too.
  const bare = worker({ version: 'v1', prefix: 'pm' });
  bare.online = false;
  const page = await bare.run(nav('/x'));
  assert.equal(page.error.message, 'Failed to fetch');
});

test('a non-navigation request never gets the fallback page', async function () {
  const w = worker(PM);
  await w.install();
  w.online = false;
  const { error } = await w.run(req('/data.json'));
  assert.equal(error.message, 'Failed to fetch');
});

// ---------- fetch: runtime ----------

test('runtime cache-first fills on first use and serves from cache offline', async function () {
  const w = worker(PM);
  const url = '/vendor/blob.bin';
  const first = await w.run(req(url));
  assert.equal(await first.response.text(), 'net ' + BASE + url);
  assert.equal(await w.cachedText('pm-vendor', url), 'net ' + BASE + url);
  assert.equal(await w.cachedText('pm-shell-v1', url), undefined);
  // Cached now: no more network, even online.
  const second = await w.run(req(url));
  assert.equal(await second.response.text(), 'net ' + BASE + url);
  assert.equal(w.fetched.length, 1);
  w.online = false;
  const offline = await w.run(req(url));
  assert.equal(await offline.response.text(), 'net ' + BASE + url);
  assert.deepEqual(w.cacheNames(), ['pm-vendor']);
});

test('runtime cache-first: offline and not cached rejects', async function () {
  const w = worker(PM);
  w.online = false;
  const { error } = await w.run(req('/vendor/none.bin'));
  assert.equal(error.message, 'Failed to fetch');
});

test('runtime cache-first stores only status 200', async function () {
  const w = worker(PM);
  const cases = [
    new Response('part', { status: 206 }),
    new Response('gone', { status: 404 }),
    new Response('boom', { status: 500 }),
    { status: 0, type: 'opaque', clone() { return this; } },
  ];
  for (let i = 0; i < cases.length; i++) {
    const url = '/vendor/f' + i;
    w.serve = () => cases[i];
    const { response } = await w.run(req(url));
    assert.equal(response.status, cases[i].status);
    assert.equal(await w.cachedText('pm-vendor', url), undefined, 'status ' + cases[i].status);
  }
});

test('runtime cache name is prefix + cache, not versioned', async function () {
  const a = worker({ version: 'v1', prefix: 'pm', runtime: [{ match: '/vendor/', cache: 'vendor' }] });
  await a.run(req('/vendor/x'));
  assert.deepEqual(a.cacheNames(), ['pm-vendor']);
  const b = worker({ version: 'v2', prefix: 'pm', runtime: [{ match: '/vendor/', cache: 'vendor' }] });
  await b.run(req('/vendor/x'));
  assert.deepEqual(b.cacheNames(), ['pm-vendor']);
});

test('runtime network-first: fresh when online, cached when offline', async function () {
  const w = worker({ version: 'v1', prefix: 'pm', runtime: [{ match: '/data/', cache: 'data', strategy: 'network-first' }] });
  let n = 0;
  w.serve = () => new Response('v' + (++n));
  const one = await w.run(req('/data/a'));
  assert.equal(await one.response.text(), 'v1');
  const two = await w.run(req('/data/a'));
  assert.equal(await two.response.text(), 'v2');
  assert.equal(await w.cachedText('pm-data', '/data/a'), 'v2');
  w.online = false;
  const off = await w.run(req('/data/a'));
  assert.equal(await off.response.text(), 'v2');
  const none = await w.run(req('/data/b'));
  assert.equal(none.error.message, 'Failed to fetch');
});

test('runtime network-first stores only status 200', async function () {
  const w = worker({ version: 'v1', prefix: 'pm', runtime: [{ match: '/data/', cache: 'data', strategy: 'network-first' }] });
  w.serve = () => new Response('part', { status: 206 });
  await w.run(req('/data/a'));
  w.serve = () => new Response('gone', { status: 404 });
  const { response } = await w.run(req('/data/b'));
  assert.equal(response.status, 404);
  assert.equal(await w.cachedText('pm-data', '/data/a'), undefined);
  assert.equal(await w.cachedText('pm-data', '/data/b'), undefined);
});

test('runtime match: prefix string, RegExp on the pathname, and a function of URL', async function () {
  const w = worker({
    version: 'v1', prefix: 'pm',
    runtime: [
      { match: '/p/', cache: 'p' },
      { match: /\.woff2$/, cache: 'fonts' },
      { match: (url) => url.searchParams.get('x') === '1', cache: 'fn' },
    ],
  });
  await w.run(req('/p/a'));
  await w.run(req('/f/a.woff2?v=3'));
  await w.run(req('/other?x=1'));
  assert.deepEqual(w.cacheNames(), ['pm-fn', 'pm-fonts', 'pm-p']);
  assert.equal(await w.cachedText('pm-fonts', '/f/a.woff2?v=3'), 'net ' + BASE + '/f/a.woff2?v=3');
  // The RegExp is tested on the pathname, not the query.
  const q = worker({ version: 'v1', runtime: [{ match: /v=3/, cache: 'q' }] });
  await q.run(req('/f/a.woff2?v=3'));
  assert.equal(q.cacheNames().includes('ak-q'), false);
  assert.equal(await q.cachedText('ak-q', '/f/a.woff2?v=3'), undefined);
});

test('the first matching runtime rule wins', async function () {
  const w = worker({
    version: 'v1', prefix: 'pm',
    runtime: [
      { match: '/vendor/', cache: 'first' },
      { match: /vendor/, cache: 'second', strategy: 'network-first' },
    ],
  });
  await w.run(req('/vendor/a'));
  assert.deepEqual(w.cacheNames(), ['pm-first']);
  // A precached URL under a runtime rule is handled by the rule, not the shell.
  const s = worker({ version: 'v1', prefix: 'pm', shell: ['/vendor/a'], runtime: [{ match: '/vendor/', cache: 'v' }] });
  await s.install();
  s.serve = () => new Response('from rule');
  await s.run(req('/vendor/a'));
  assert.equal(await s.cachedText('pm-v', '/vendor/a'), 'from rule');
  // The shell entry was not refreshed by the shell logic.
  assert.equal(await s.cachedText('pm-shell-v1', '/vendor/a'), 'shell ' + BASE + '/vendor/a');
});

// ---------- message ----------

test('SKIP_WAITING calls skipWaiting, other messages do not', function () {
  const w = worker(PM);
  w.message({ type: 'SOMETHING_ELSE' });
  w.message({ type: 'skip_waiting' });
  w.message('SKIP_WAITING');
  w.message(null);
  w.message(undefined);
  w.message({});
  assert.equal(w.skipWaitingCalls, 0);
  w.message({ type: 'SKIP_WAITING' });
  assert.equal(w.skipWaitingCalls, 1);
});

// ---------- app listeners ----------

test('an app listener that already answered does not make the kit listener throw', async function () {
  const w = createWorker();
  w.load();
  w.self.addEventListener('fetch', (event) => event.respondWith(Promise.resolve(new Response('app answer'))));
  w.setup(PM);
  w.online = false; // the kit's own answer rejects, which must not be an unhandled rejection
  let dispatched;
  assert.doesNotThrow(() => { dispatched = w.dispatchFetch(req('/missing.js')); });
  assert.equal(dispatched.handled, true);
  const { response } = await dispatched.result();
  assert.equal(await response.text(), 'app answer');
  assert.equal(dispatched.stopped(), false);
});

test('the kit never calls stopImmediatePropagation', async function () {
  const w = worker(PM);
  await w.install();
  const handled = w.dispatchFetch(nav('/'));
  await handled.result();
  assert.equal(handled.stopped(), false);
  const ignored = w.dispatchFetch(req('/api/x'));
  assert.equal(ignored.stopped(), false);
});
