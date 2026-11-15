import assert from "node:assert/strict";
import test from "node:test";
import { installGracefulShutdown, type GracefulShutdownOptions } from "../../server/shutdown.ts";

type Timer = { fn: () => void; ms: number; cleared: boolean };

/** A server whose close callback the test fires (or never fires, to simulate a hanging keep-alive socket). */
function rig(overrides: Partial<GracefulShutdownOptions> = {}) {
  const events: string[] = [];
  const timers: Timer[] = [];
  const listeners = new Map<string, () => void>();
  const closeCallbacks: Array<() => void> = [];
  const exits: number[] = [];
  const logs: string[] = [];
  const errors: string[] = [];
  let onCloseCalls = 0;

  const server = {
    close(callback?: (error?: Error) => void) {
      events.push("close");
      if (callback) closeCallbacks.push(() => callback());
      return this as never;
    },
    closeIdleConnections() {
      events.push("closeIdleConnections");
    },
  };

  const handle = installGracefulShutdown({
    server,
    onClose: async () => {
      onCloseCalls += 1;
      events.push("onClose");
    },
    exit: (code) => {
      exits.push(code);
      events.push(`exit:${code}`);
    },
    log: (message) => logs.push(message),
    logError: (message) => errors.push(message),
    on: (signal, listener) => void listeners.set(signal, listener),
    off: (signal, listener) => {
      if (listeners.get(signal) === listener) listeners.delete(signal);
    },
    setTimer: (fn, ms) => {
      const timer: Timer = { fn, ms, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimer: (timer) => {
      (timer as Timer).cleared = true;
    },
    ...overrides,
  });

  return {
    handle,
    events,
    timers,
    listeners,
    exits,
    logs,
    errors,
    onCloseCalls: () => onCloseCalls,
    /** The server finishes closing. */
    serverClosed: () => closeCallbacks.forEach((cb) => cb()),
    signal: (name: string) => listeners.get(name)?.(),
    /** Let queued promise callbacks (async onClose) run. */
    settle: () => new Promise((resolve) => setImmediate(resolve)),
  };
}

test("registers SIGTERM and SIGINT by default, and nothing is closed until a signal arrives", () => {
  const r = rig();
  assert.deepEqual([...r.listeners.keys()].sort(), ["SIGINT", "SIGTERM"]);
  assert.deepEqual(r.events, []);
  assert.equal(r.timers.length, 0);
});

test("on a signal: close, closeIdleConnections, a force timer of 8000 ms, then onClose and exit after the server closed", async () => {
  const r = rig();
  r.signal("SIGTERM");
  assert.deepEqual(r.events, ["close", "closeIdleConnections"]);
  assert.equal(r.timers.length, 1);
  assert.equal(r.timers[0].ms, 8000);
  assert.deepEqual(r.exits, [], "does not exit before the server has closed");
  r.serverClosed();
  await r.settle();
  assert.deepEqual(r.events, ["close", "closeIdleConnections", "onClose", "exit:0"]);
  assert.equal(r.timers[0].cleared, true, "the force timer is cancelled after a clean close");
  assert.match(r.logs.join("\n"), /SIGTERM/);
});

test("a second signal does not close again, and onClose runs once", async () => {
  const r = rig();
  r.signal("SIGTERM");
  r.signal("SIGINT");
  r.signal("SIGTERM");
  r.handle.shutdown();
  assert.equal(r.events.filter((e) => e === "close").length, 1);
  assert.equal(r.events.filter((e) => e === "closeIdleConnections").length, 1);
  assert.equal(r.timers.length, 1);
  r.serverClosed();
  await r.settle();
  r.serverClosed();
  await r.settle();
  assert.equal(r.onCloseCalls(), 1);
  assert.deepEqual(r.exits, [0]);
});

test("if close hangs, the force timer runs onClose and exits", async () => {
  const r = rig({ forceExitMs: 1234 });
  r.signal("SIGINT");
  assert.equal(r.timers[0].ms, 1234);
  assert.deepEqual(r.exits, []);
  r.timers[0].fn(); // time passes, the server never closed
  await r.settle();
  assert.deepEqual(r.events.slice(-2), ["onClose", "exit:0"]);
  assert.equal(r.onCloseCalls(), 1);
});

test("the force timer and a late close together still run onClose and exit once", async () => {
  const r = rig();
  r.signal("SIGTERM");
  r.timers[0].fn();
  await r.settle();
  r.serverClosed();
  await r.settle();
  assert.equal(r.onCloseCalls(), 1);
  assert.deepEqual(r.exits, [0]);
});

test("closeIdleConnections is called after close, so keep-alive sockets do not hold it open", () => {
  const r = rig();
  r.signal("SIGTERM");
  assert.ok(r.events.indexOf("closeIdleConnections") > r.events.indexOf("close"));
});

test("the default force timer is unref'd, so it never keeps the process alive", () => {
  const timeouts = () => process.getActiveResourcesInfo().filter((name) => name === "Timeout").length;
  const before = timeouts();
  const handle = installGracefulShutdown({
    server: { close: () => ({}) as never, closeIdleConnections() {} },
    forceExitMs: 60_000,
    exit: () => {
      throw new Error("must not exit");
    },
    log: () => {},
    on: () => {},
    off: () => {},
  });
  handle.shutdown("test"); // the server never finishes closing, so the real timer stays pending
  assert.equal(timeouts(), before, "a pending ref'd timer would show up here");
});

test("an onClose that throws is logged and the process still exits", async () => {
  const r = rig({
    onClose: () => {
      throw new Error("db close failed");
    },
  });
  r.signal("SIGTERM");
  r.serverClosed();
  await r.settle();
  assert.deepEqual(r.exits, [0]);
  assert.equal(r.errors.length, 1);
});

test("an async onClose is awaited before exit", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const r = rig({ onClose: () => gate });
  r.signal("SIGTERM");
  r.serverClosed();
  await r.settle();
  assert.deepEqual(r.exits, [], "still waiting for onClose");
  release();
  await r.settle();
  assert.deepEqual(r.exits, [0]);
});

test("onClose is optional", async () => {
  const exits: number[] = [];
  const closers: Array<() => void> = [];
  const handle = installGracefulShutdown({
    server: {
      close(cb?: (error?: Error) => void) {
        closers.push(() => cb?.());
        return this as never;
      },
      closeIdleConnections() {},
    },
    exit: (code) => void exits.push(code),
    log: () => {},
    on: () => {},
    off: () => {},
    setTimer: () => ({}),
    clearTimer: () => {},
  });
  handle.shutdown();
  closers[0]();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(exits, [0]);
});

test("shutdown() can be called directly and gives the reason in the log", () => {
  const r = rig();
  r.handle.shutdown("manual");
  assert.match(r.logs[0], /manual/);
  assert.deepEqual(r.events, ["close", "closeIdleConnections"]);
});

test("custom signals are registered instead of the defaults", () => {
  const r = rig({ signals: ["SIGHUP"] });
  assert.deepEqual([...r.listeners.keys()], ["SIGHUP"]);
  r.signal("SIGHUP");
  assert.deepEqual(r.events, ["close", "closeIdleConnections"]);
});

test("dispose removes the signal listeners, and a later signal does nothing", () => {
  const r = rig();
  r.handle.dispose();
  assert.equal(r.listeners.size, 0);
  r.signal("SIGTERM");
  assert.deepEqual(r.events, []);
  assert.equal(r.timers.length, 0);
});

test("with the real process, listeners are added and dispose removes exactly those", () => {
  const before = { term: process.listenerCount("SIGTERM"), int: process.listenerCount("SIGINT") };
  const handle = installGracefulShutdown({
    server: { close: () => ({}) as never, closeIdleConnections() {} },
    exit: () => {
      throw new Error("must not exit");
    },
    log: () => {},
  });
  assert.equal(process.listenerCount("SIGTERM"), before.term + 1);
  assert.equal(process.listenerCount("SIGINT"), before.int + 1);
  handle.dispose();
  assert.equal(process.listenerCount("SIGTERM"), before.term);
  assert.equal(process.listenerCount("SIGINT"), before.int);
});
