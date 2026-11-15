import assert from "node:assert/strict";
import test from "node:test";
import { createRateLimiter } from "../../server/rate-limit.ts";

test("allows up to the limit in a window, then refuses", () => {
  const limiter = createRateLimiter({ limit: 3, windowMs: 1000 });
  assert.deepEqual([0, 1, 2, 3, 4].map(() => limiter.hit("a", 100)), [true, true, true, false, false]);
});

test("window boundary: still limited just before the end, fresh window exactly at the end", () => {
  const limiter = createRateLimiter({ limit: 1, windowMs: 1000 });
  assert.equal(limiter.hit("a", 0), true);
  assert.equal(limiter.hit("a", 999), false);
  assert.equal(limiter.hit("a", 1000), true);
  assert.equal(limiter.hit("a", 1999), false);
  assert.equal(limiter.hit("a", 2000), true);
});

test("the window is fixed from the first hit, later hits do not extend it", () => {
  const limiter = createRateLimiter({ limit: 2, windowMs: 1000 });
  assert.equal(limiter.hit("a", 0), true);
  assert.equal(limiter.hit("a", 900), true);
  assert.equal(limiter.hit("a", 950), false);
  assert.equal(limiter.hit("a", 1000), true);
});

test("a refused hit does not make the next window harder", () => {
  const limiter = createRateLimiter({ limit: 1, windowMs: 1000 });
  for (let i = 0; i < 50; i++) limiter.hit("a", 10);
  assert.equal(limiter.hit("a", 1010), true);
});

test("keys are independent", () => {
  const limiter = createRateLimiter({ limit: 1, windowMs: 1000 });
  assert.equal(limiter.hit("a", 0), true);
  assert.equal(limiter.hit("a", 1), false);
  assert.equal(limiter.hit("b", 1), true);
  assert.equal(limiter.hit("b", 2), false);
});

test("resetIn: time left in the window, 0 for an unknown key and after expiry", () => {
  const limiter = createRateLimiter({ limit: 1, windowMs: 1000 });
  assert.equal(limiter.resetIn("a", 0), 0);
  limiter.hit("a", 100);
  assert.equal(limiter.resetIn("a", 100), 1000);
  assert.equal(limiter.resetIn("a", 600), 500);
  assert.equal(limiter.resetIn("a", 1100), 0);
  assert.equal(limiter.resetIn("a", 5000), 0);
  assert.equal(limiter.resetIn("other", 600), 0);
});

test("resetIn does not count a hit", () => {
  const limiter = createRateLimiter({ limit: 1, windowMs: 1000 });
  limiter.resetIn("a", 0);
  assert.equal(limiter.size(), 0);
  assert.equal(limiter.hit("a", 0), true);
});

test("maxKeys bounds memory under a flood of distinct live keys", () => {
  const limiter = createRateLimiter({ limit: 5, windowMs: 60_000, maxKeys: 100 });
  for (let i = 0; i < 10_000; i++) {
    limiter.hit(`ip-${i}`, i);
    assert.ok(limiter.size() <= 100);
  }
  assert.equal(limiter.size(), 100);
});

test("when full of live keys the oldest are dropped and the newest are kept", () => {
  const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, maxKeys: 3 });
  for (const key of ["a", "b", "c", "d"]) limiter.hit(key, 0);
  assert.equal(limiter.size(), 3);
  // d is tracked: a second hit is refused. a was evicted: it starts fresh.
  assert.equal(limiter.hit("d", 1), false);
  assert.equal(limiter.hit("a", 1), true);
});

test("expired windows are pruned, so size falls after the window passes", () => {
  const limiter = createRateLimiter({ limit: 5, windowMs: 1000, maxKeys: 10_000 });
  for (let i = 0; i < 500; i++) limiter.hit(`ip-${i}`, 0);
  assert.equal(limiter.size(), 500);
  limiter.hit("fresh", 5000);
  assert.equal(limiter.size(), 1);
});

test("pruning expired keys makes room before live keys are evicted", () => {
  const limiter = createRateLimiter({ limit: 1, windowMs: 1000, maxKeys: 3 });
  limiter.hit("old1", 0);
  limiter.hit("old2", 0);
  limiter.hit("live", 900);
  limiter.hit("new", 1100); // old1 and old2 are expired; live must survive
  assert.equal(limiter.hit("live", 1200), false);
});

test("a limit of 0 refuses everything", () => {
  const limiter = createRateLimiter({ limit: 0, windowMs: 1000 });
  assert.equal(limiter.hit("a", 0), false);
});

test("bad options throw", () => {
  assert.throws(() => createRateLimiter({ limit: 1, windowMs: 0 }), RangeError);
  assert.throws(() => createRateLimiter({ limit: -1, windowMs: 1000 }), RangeError);
  assert.throws(() => createRateLimiter({ limit: 1, windowMs: 1000, maxKeys: 0 }), RangeError);
});
