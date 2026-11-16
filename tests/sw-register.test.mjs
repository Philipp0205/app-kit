import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'frontend', 'ak-sw-register.js'), 'utf8');

function emitter() {
  const handlers = {};
  return {
    handlers,
    addEventListener(type, fn) { (handlers[type] = handlers[type] || []).push(fn); },
    fire(type, event) { (handlers[type] || []).slice().forEach((fn) => fn(event || {})); },
  };
}

function fakeWorker(state) {
  const w = emitter();
  w.state = state;
  w.posted = [];
  w.postMessage = (message) => { w.posted.push(message); };
  return w;
}

// Options: supported, controller, waiting, readyState, registerError.
function createEnv(options) {
  const o = options || {};
  const registration = emitter();
  registration.waiting = o.waiting || null;
  registration.installing = null;
  registration.active = null;

  const container = emitter();
  container.controller = o.controller || null;
  container.registered = [];
  container.register = (url, opts) => {
    container.registered.push({ url, scope: opts && opts.scope });
    return o.registerError ? Promise.reject(new Error('nope')) : Promise.resolve(registration);
  };

  const win = emitter();
  const reloads = { count: 0 };
  const sandbox = {
    Promise,
    navigator: o.supported === false ? {} : { serviceWorker: container },
    document: { readyState: o.readyState || 'complete' },
    location: { reload() { reloads.count++; } },
    addEventListener: win.addEventListener,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox, { filename: 'ak-sw-register.js' });
  return {
    sw: sandbox.AppKit.sw, window: sandbox, registration, container, reloads, win,
    // A new worker starts installing, as the browser does it.
    startInstall() {
      const worker = fakeWorker('installing');
      registration.installing = worker;
      registration.fire('updatefound');
      return worker;
    },
    finishInstall(worker) {
      worker.state = 'installed';
      registration.installing = null;
      registration.waiting = worker;
      worker.fire('statechange');
    },
  };
}

test('only window.AppKit is added, with sw.register and sw.applyUpdate', function () {
  const env = createEnv();
  assert.deepEqual(Object.keys(env.window).filter((k) => !['Promise', 'navigator', 'document', 'location', 'addEventListener', 'window'].includes(k)), ['AppKit']);
  assert.deepEqual(Object.keys(env.sw).sort(), ['applyUpdate', 'register']);
});

test('register: unsupported returns null', function () {
  const env = createEnv({ supported: false });
  assert.equal(env.sw.register({}), null);
});

test('register: registers /sw.js with scope / by default', async function () {
  const env = createEnv();
  const registration = await env.sw.register();
  assert.equal(registration, env.registration);
  assert.deepEqual(env.container.registered, [{ url: '/sw.js', scope: '/' }]);
});

test('register: passes url and scope', async function () {
  const env = createEnv();
  await env.sw.register({ url: '/app/sw.js', scope: '/app/' });
  assert.deepEqual(env.container.registered, [{ url: '/app/sw.js', scope: '/app/' }]);
});

test('register: a failing register resolves null and never rejects', async function () {
  const env = createEnv({ registerError: true });
  assert.equal(await env.sw.register({ onUpdate() { throw new Error('unused'); } }), null);
});

test('register: waits for load when the page has not finished loading', async function () {
  const env = createEnv({ readyState: 'loading' });
  const pending = env.sw.register();
  assert.deepEqual(env.container.registered, []);
  env.win.fire('load');
  assert.equal(await pending, env.registration);
  assert.equal(env.container.registered.length, 1);
});

test('onUpdate: not called on the very first install (no controller)', async function () {
  const calls = [];
  const env = createEnv({ controller: null });
  await env.sw.register({ onUpdate: (u) => calls.push(u) });
  env.finishInstall(env.startInstall());
  assert.equal(calls.length, 0);
});

test('onUpdate: not called for a waiting worker without a controller', async function () {
  const calls = [];
  const env = createEnv({ controller: null, waiting: fakeWorker('installed') });
  await env.sw.register({ onUpdate: (u) => calls.push(u) });
  assert.equal(calls.length, 0);
});

test('onUpdate: called at registration when a worker is waiting under a controller', async function () {
  const calls = [];
  const env = createEnv({ controller: {}, waiting: fakeWorker('installed') });
  await env.sw.register({ onUpdate: (u) => calls.push(u) });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].registration, env.registration);
  assert.equal(typeof calls[0].apply, 'function');
});

test('onUpdate: called after updatefound once the installing worker is installed', async function () {
  const calls = [];
  const env = createEnv({ controller: {} });
  await env.sw.register({ onUpdate: (u) => calls.push(u) });
  const worker = env.startInstall();
  assert.equal(calls.length, 0);
  worker.fire('statechange'); // still installing
  assert.equal(calls.length, 0);
  env.finishInstall(worker);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].registration, env.registration);
});

test('onUpdate: at most once per waiting worker', async function () {
  const calls = [];
  const waiting = fakeWorker('installed');
  const env = createEnv({ controller: {}, waiting });
  await env.sw.register({ onUpdate: (u) => calls.push(u) });
  assert.equal(calls.length, 1);
  // The same worker reports again (a second statechange, or a second updatefound).
  env.registration.installing = waiting;
  env.registration.fire('updatefound');
  waiting.fire('statechange');
  waiting.fire('statechange');
  assert.equal(calls.length, 1);
  // A different, newer worker is a new update.
  env.finishInstall(env.startInstall());
  assert.equal(calls.length, 2);
});

test('register without onUpdate does not throw on an update', async function () {
  const env = createEnv({ controller: {}, waiting: fakeWorker('installed') });
  await env.sw.register();
  env.finishInstall(env.startInstall());
});

test('apply posts SKIP_WAITING to the waiting worker and reloads once on controllerchange', async function () {
  const waiting = fakeWorker('installed');
  const env = createEnv({ controller: {}, waiting });
  let update;
  await env.sw.register({ onUpdate: (u) => { update = u; } });
  update.apply();
  assert.deepEqual(waiting.posted.map((m) => m.type), ['SKIP_WAITING']);
  assert.equal(env.reloads.count, 0, 'no reload before the controller changes');
  env.container.fire('controllerchange');
  assert.equal(env.reloads.count, 1);
  env.container.fire('controllerchange');
  env.container.fire('controllerchange');
  assert.equal(env.reloads.count, 1, 'no reload loop');
});

test('apply twice still reloads once', async function () {
  const waiting = fakeWorker('installed');
  const env = createEnv({ controller: {}, waiting });
  let update;
  await env.sw.register({ onUpdate: (u) => { update = u; } });
  update.apply();
  update.apply();
  env.container.fire('controllerchange');
  assert.equal(env.reloads.count, 1);
});

test('applyUpdate(registration) is the same action', function () {
  const waiting = fakeWorker('installed');
  const env = createEnv({ controller: {} });
  env.registration.waiting = waiting;
  env.sw.applyUpdate(env.registration);
  assert.deepEqual(waiting.posted.map((m) => m.type), ['SKIP_WAITING']);
  env.container.fire('controllerchange');
  assert.equal(env.reloads.count, 1);
});

test('applyUpdate with no waiting worker does nothing', function () {
  const env = createEnv({ controller: {} });
  env.sw.applyUpdate(env.registration);
  env.sw.applyUpdate(null);
  env.container.fire('controllerchange');
  assert.equal(env.reloads.count, 0);
});

test('a second load of the script keeps the first AppKit.sw', function () {
  const env = createEnv();
  const first = env.sw;
  vm.runInContext(SOURCE, env.window);
  assert.equal(env.window.AppKit.sw, first);
});
