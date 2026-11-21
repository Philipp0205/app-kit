import assert from "node:assert/strict";
import test from "node:test";
import {
  CHAT_PUSH_GAP_MS,
  CHAT_PUSH_WINDOW_MS,
  CHAT_SQLITE_SCHEMA,
  CHAT_TEXT_MAX,
  CHAT_THREAD_LIMIT,
  cleanChatText,
  createChat,
  createChatPushBatcher,
  nextChatPushDelay,
} from "../../server/chat.ts";
import type { ChatPush, ChatPushBatcherOptions } from "../../server/chat.ts";
import { memoryChatStore } from "./chat-memory-store.ts";

// ---------- cleanChatText ----------

test("cleanChatText trims and keeps the text", () => {
  assert.deepEqual(cleanChatText("  hello  "), { ok: true, text: "hello" });
});

test("cleanChatText: empty, whitespace-only and non-strings are empty", () => {
  assert.deepEqual(cleanChatText(""), { ok: false, reason: "empty" });
  assert.deepEqual(cleanChatText(" \n\t "), { ok: false, reason: "empty" });
  for (const value of [undefined, null, 42, {}, ["a"], true]) {
    assert.deepEqual(cleanChatText(value), { ok: false, reason: "empty" });
  }
});

test("cleanChatText strips control characters but keeps tab and newlines", () => {
  assert.deepEqual(cleanChatText("a\u0000b\u0007c\u001fd\u007f"), { ok: true, text: "abcd\u007f" });
  assert.deepEqual(cleanChatText("a\tb\nc"), { ok: true, text: "a\tb\nc" });
  assert.deepEqual(cleanChatText("\u0001\u0002"), { ok: false, reason: "empty" });
});

test("cleanChatText turns CRLF into LF", () => {
  assert.deepEqual(cleanChatText("one\r\ntwo\r\n\r\nthree"), { ok: true, text: "one\ntwo\n\nthree" });
});

test("cleanChatText: 1000 is fine, 1001 is too long", () => {
  assert.equal(CHAT_TEXT_MAX, 1000);
  assert.deepEqual(cleanChatText("a".repeat(1000)), { ok: true, text: "a".repeat(1000) });
  assert.deepEqual(cleanChatText("a".repeat(1001)), { ok: false, reason: "too_long" });
});

test("cleanChatText counts code points, not UTF-16 units", () => {
  assert.equal(cleanChatText("😀".repeat(1000)).ok, true);
  assert.deepEqual(cleanChatText("😀".repeat(1001)), { ok: false, reason: "too_long" });
  assert.equal(cleanChatText("😀😀😀", 3).ok, true);
  assert.deepEqual(cleanChatText("😀😀😀😀", 3), { ok: false, reason: "too_long" });
});

test("cleanChatText measures after trimming", () => {
  assert.equal(cleanChatText("  " + "a".repeat(1000) + "  ").ok, true);
});

// ---------- createChat ----------

function chatFixture(overrides: Record<string, unknown> = {}) {
  const fake = memoryChatStore();
  let clock = 1000;
  let seq = 0;
  const chat = createChat({
    store: fake.store,
    now: () => clock,
    newId: () => `id-${++seq}`,
    ...overrides,
  });
  return { ...fake, chat, tick: (ms: number) => (clock += ms), setClock: (at: number) => (clock = at) };
}

test("createChat throws TypeError for missing options or store", () => {
  assert.throws(() => createChat(undefined as never), TypeError);
  assert.throws(() => createChat({} as never), TypeError);
  assert.throws(() => createChat({ store: null } as never), TypeError);
  assert.throws(() => createChat({ store: memoryChatStore().store, threadLimit: 0 }), TypeError);
  assert.throws(() => createChat({ store: memoryChatStore().store, maxLength: 1.5 }), TypeError);
});

test("post stores the cleaned text and returns the message with name, time and id", async () => {
  const f = chatFixture();
  const result = await f.chat.post("c1", { id: "u1", name: "Ana" }, "  hi there \r\n you ");
  assert.deepEqual(result, {
    ok: true,
    message: { id: "id-1", chatId: "c1", userId: "u1", userName: "Ana", body: "hi there \n you", createdAt: 1000 },
  });
  assert.equal(f.messages.length, 1);
  assert.equal(f.messages[0].body, "hi there \n you");
});

test("post answers empty and too_long without storing", async () => {
  const f = chatFixture();
  assert.deepEqual(await f.chat.post("c1", { id: "u1", name: "Ana" }, "   "), { ok: false, reason: "empty" });
  assert.deepEqual(await f.chat.post("c1", { id: "u1", name: "Ana" }, 7), { ok: false, reason: "empty" });
  assert.deepEqual(await f.chat.post("c1", { id: "u1", name: "Ana" }, "a".repeat(1001)), { ok: false, reason: "too_long" });
  assert.equal(f.messages.length, 0);
});

test("post uses the maxLength option", async () => {
  const f = chatFixture({ maxLength: 5 });
  assert.equal((await f.chat.post("c1", { id: "u1", name: "Ana" }, "12345")).ok, true);
  assert.deepEqual(await f.chat.post("c1", { id: "u1", name: "Ana" }, "123456"), { ok: false, reason: "too_long" });
});

test("post generates a UUID by default", async () => {
  const fake = memoryChatStore();
  const chat = createChat({ store: fake.store });
  const result = await chat.post("c1", { id: "u1", name: "Ana" }, "hi");
  assert.ok(result.ok);
  assert.match(result.message.id, /^[0-9a-f]{8}-[0-9a-f]{4}-/);
  assert.ok(Math.abs(result.message.createdAt - Date.now()) < 5000);
});

test("thread returns the last 200 messages oldest first, and the muted flag", async () => {
  const f = chatFixture();
  f.setName("u1", "Ana");
  for (let i = 1; i <= 205; i++) {
    f.setClock(i);
    await f.chat.post("c1", { id: "u1", name: "Ana" }, `m${i}`);
  }
  await f.chat.post("other", { id: "u1", name: "Ana" }, "elsewhere");
  assert.equal(CHAT_THREAD_LIMIT, 200);
  const thread = await f.chat.thread("c1", "u2");
  assert.equal(thread.messages.length, 200);
  assert.equal(thread.messages[0].body, "m6");
  assert.equal(thread.messages[199].body, "m205");
  assert.equal(thread.muted, false);
  assert.equal(thread.messages[0].userName, "Ana");
  await f.chat.setMuted("c1", "u2", true);
  assert.equal((await f.chat.thread("c1", "u2")).muted, true);
  assert.equal((await f.chat.thread("c1", "u3")).muted, false);
});

test("thread honours threadLimit and does not mark read", async () => {
  const f = chatFixture({ threadLimit: 2 });
  for (let i = 1; i <= 3; i++) await f.chat.post("c1", { id: "u1", name: "Ana" }, `m${i}`);
  const thread = await f.chat.thread("c1", "u2");
  assert.deepEqual(thread.messages.map((m) => m.body), ["m2", "m3"]);
  assert.deepEqual(await f.chat.unreadCounts("u2", ["c1"]), { c1: 3 });
});

test("markRead and unreadCounts: others only, after read_at, per chat", async () => {
  const f = chatFixture();
  f.setClock(100);
  await f.chat.post("c1", { id: "u1", name: "Ana" }, "a");
  f.setClock(200);
  await f.chat.post("c1", { id: "u2", name: "Ben" }, "mine");
  f.setClock(300);
  await f.chat.post("c2", { id: "u1", name: "Ana" }, "b");
  await f.chat.post("c2", { id: "u1", name: "Ana" }, "c");

  assert.deepEqual(await f.chat.unreadCounts("u2", ["c1", "c2"]), { c1: 1, c2: 2 });
  assert.deepEqual(await f.chat.unreadCounts("u1", ["c1", "c2"]), { c1: 1, c2: 0 });

  f.setClock(250);
  await f.chat.markRead("c1", "u2");
  assert.deepEqual(await f.chat.unreadCounts("u2", ["c1", "c2"]), { c1: 0, c2: 2 });

  f.setClock(400);
  await f.chat.post("c1", { id: "u1", name: "Ana" }, "later");
  assert.deepEqual(await f.chat.unreadCounts("u2", ["c1"]), { c1: 1 });
});

test("unreadCounts: missing ids are 0, an empty list skips the store, ids are deduped", async () => {
  const f = chatFixture();
  assert.deepEqual(await f.chat.unreadCounts("u2", ["nope"]), { nope: 0 });
  const before = f.calls.unreadCounts;
  assert.deepEqual(await f.chat.unreadCounts("u2", []), {});
  assert.equal(f.calls.unreadCounts, before);

  const seen: string[][] = [];
  const chat = createChat({
    store: {
      ...f.store,
      unreadCounts(_userId, chatIds) {
        seen.push(chatIds);
        return Object.fromEntries(chatIds.map((id) => [id, 0]));
      },
    },
  });
  await chat.unreadCounts("u2", ["a", "b", "a"]);
  assert.deepEqual(seen, [["a", "b"]]);
});

test("setMuted round trip", async () => {
  const f = chatFixture();
  assert.equal((await f.chat.thread("c1", "u1")).muted, false);
  await f.chat.setMuted("c1", "u1", true);
  assert.equal((await f.chat.thread("c1", "u1")).muted, true);
  await f.chat.setMuted("c1", "u1", false);
  assert.equal((await f.chat.thread("c1", "u1")).muted, false);
});

test("CHAT_SQLITE_SCHEMA names the four tables and is idempotent SQL", () => {
  for (const table of ["chats", "chat_messages", "chat_reads", "chat_mutes"]) {
    assert.match(CHAT_SQLITE_SCHEMA, new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(`));
  }
  assert.match(CHAT_SQLITE_SCHEMA, /CREATE INDEX IF NOT EXISTS \w+ ON chat_messages\(chat_id, created_at\)/);
  assert.match(CHAT_SQLITE_SCHEMA, /PRIMARY KEY \(user_id, chat_id\)/);
});

// ---------- nextChatPushDelay ----------

test("nextChatPushDelay: window when never sent or the gap is over, else the rest of the gap", () => {
  assert.equal(CHAT_PUSH_WINDOW_MS, 15_000);
  assert.equal(CHAT_PUSH_GAP_MS, 60_000);
  assert.equal(nextChatPushDelay(0, 1_000_000), 15_000);
  assert.equal(nextChatPushDelay(1_000_000, 1_060_000), 15_000);
  assert.equal(nextChatPushDelay(1_000_000, 1_070_000), 15_000);
  assert.equal(nextChatPushDelay(1_000_000, 1_010_000), 50_000);
  assert.equal(nextChatPushDelay(1_000_000, 1_050_000), 15_000);
  assert.equal(nextChatPushDelay(1_000_000, 1_048_000), 15_000);
  assert.equal(nextChatPushDelay(1_000_000, 1_000_000), 60_000);
  assert.equal(nextChatPushDelay(5, 100, 10, 1000), 905);
});

// ---------- the push batcher ----------

type Timer = { id: number; at: number; fn: () => void };

function batcherFixture(overrides: Partial<ChatPushBatcherOptions> = {}) {
  let clock = 1_000_000;
  let nextId = 1;
  let timers: Timer[] = [];
  const sent: ChatPush[] = [];
  const logs: string[] = [];
  const batcher = createChatPushBatcher({
    send: (push) => {
      sent.push(push);
    },
    now: () => clock,
    setTimer: (fn, ms) => {
      const timer = { id: nextId++, at: clock + ms, fn };
      timers.push(timer);
      return timer.id;
    },
    clearTimer: (handle) => {
      timers = timers.filter((t) => t.id !== handle);
    },
    log: (message) => logs.push(message),
    ...overrides,
  });
  return {
    batcher,
    sent,
    logs,
    timers: () => timers,
    /** Moves the clock and fires due timers in order. Waits for the async work they start. */
    async advance(ms: number) {
      const target = clock + ms;
      for (;;) {
        const due = timers.filter((t) => t.at <= target).sort((a, b) => a.at - b.at || a.id - b.id)[0];
        if (!due) break;
        timers = timers.filter((t) => t !== due);
        clock = Math.max(clock, due.at);
        due.fn();
        await settle();
      }
      clock = target;
    },
    setClock: (at: number) => (clock = at),
  };
}

async function settle() {
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
}

test("batcher: createChatPushBatcher needs send", () => {
  assert.throws(() => createChatPushBatcher({} as never), TypeError);
  assert.throws(() => createChatPushBatcher(undefined as never), TypeError);
});

test("batcher: one message sends one push after 15 s with the first body", async () => {
  const f = batcherFixture();
  f.batcher.schedule({ chatId: "c1", recipients: ["u2"], body: "Ana: hi" });
  assert.equal(f.batcher.pending(), 1);
  await f.advance(14_999);
  assert.equal(f.sent.length, 0);
  await f.advance(1);
  assert.deepEqual(f.sent, [{ chatId: "c1", userId: "u2", count: 1, firstBody: "Ana: hi", body: "Ana: hi" }]);
  assert.equal(f.batcher.pending(), 0);
});

test("batcher: three messages in the window are one push, 3 new messages", async () => {
  const f = batcherFixture();
  f.batcher.schedule({ chatId: "c1", recipients: ["u2"], body: "one" });
  await f.advance(3000);
  f.batcher.schedule({ chatId: "c1", recipients: ["u2"], body: "two" });
  await f.advance(3000);
  f.batcher.schedule({ chatId: "c1", recipients: ["u2"], body: "three" });
  assert.equal(f.batcher.pending(), 1);
  await f.advance(20_000);
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].count, 3);
  assert.equal(f.sent[0].firstBody, "one");
  assert.equal(f.sent[0].body, "3 new messages");
});

test("batcher: a second burst within 60 s of the last push waits for the gap", async () => {
  const f = batcherFixture();
  f.batcher.schedule({ chatId: "c1", recipients: ["u2"], body: "first" });
  await f.advance(15_000);
  assert.equal(f.sent.length, 1);
  // 10 s after the push: the gap leaves 50 s.
  await f.advance(10_000);
  f.batcher.schedule({ chatId: "c1", recipients: ["u2"], body: "second" });
  await f.advance(49_999);
  assert.equal(f.sent.length, 1);
  await f.advance(1);
  assert.equal(f.sent.length, 2);
  assert.equal(f.sent[1].body, "second");
  // A burst after the gap is over waits only for the window.
  await f.advance(60_000);
  f.batcher.schedule({ chatId: "c1", recipients: ["u2"], body: "third" });
  await f.advance(15_000);
  assert.equal(f.sent.length, 3);
});

test("batcher: the gap is per recipient, another user is not held back", async () => {
  const f = batcherFixture();
  f.batcher.schedule({ chatId: "c1", recipients: ["u2"], body: "first" });
  await f.advance(15_000);
  await f.advance(5_000);
  f.batcher.schedule({ chatId: "c1", recipients: ["u2", "u3"], body: "second" });
  await f.advance(15_000);
  assert.deepEqual(f.sent.map((p) => p.userId), ["u2", "u3"]);
  assert.equal(f.sent[1].body, "second");
  await f.advance(30_000);
  assert.equal(f.sent.length, 2);
  await f.advance(10_000);
  assert.deepEqual(f.sent.map((p) => p.userId), ["u2", "u3", "u2"]);
});

test("batcher: the gap is per chat too", async () => {
  const f = batcherFixture();
  f.batcher.schedule({ chatId: "c1", recipients: ["u2"], body: "first" });
  await f.advance(15_000);
  await f.advance(5_000);
  f.batcher.schedule({ chatId: "c2", recipients: ["u2"], body: "other chat" });
  f.batcher.schedule({ chatId: "c1", recipients: ["u2"], body: "same chat" });
  await f.advance(15_000);
  assert.deepEqual(f.sent.map((p) => `${p.chatId}:${p.body}`), ["c1:first", "c2:other chat"]);
  await f.advance(30_000);
  assert.equal(f.sent.length, 2);
  await f.advance(10_000);
  assert.equal(f.sent[2].body, "same chat");
});

test("batcher: stillEligible false drops the slot and records no push", async () => {
  let eligible = true;
  const f = batcherFixture({ stillEligible: () => eligible });
  f.batcher.schedule({ chatId: "c1", recipients: ["u2", "u3"], body: "hi" });
  eligible = false;
  await f.advance(15_000);
  assert.equal(f.sent.length, 0);
  assert.equal(f.batcher.pending(), 0);
  // No push went out, so the next message waits only for the window.
  eligible = true;
  f.batcher.schedule({ chatId: "c1", recipients: ["u2"], body: "again" });
  await f.advance(15_000);
  assert.equal(f.sent.length, 1);
});

test("batcher: stillEligible is called with the chat and the user", async () => {
  const asked: string[] = [];
  const f = batcherFixture({
    stillEligible: async (chatId, userId) => {
      asked.push(`${chatId}/${userId}`);
      return userId === "u2";
    },
  });
  f.batcher.schedule({ chatId: "c1", recipients: ["u2", "u3"], body: "hi" });
  await f.advance(15_000);
  assert.deepEqual(asked.sort(), ["c1/u2", "c1/u3"]);
  assert.deepEqual(f.sent.map((p) => p.userId), ["u2"]);
});

test("batcher: a throwing send is logged and does not break later pushes", async () => {
  let fail = true;
  const f = batcherFixture({
    send: (push) => {
      if (fail) {
        const error = new Error("secret detail");
        error.name = "PushError";
        throw error;
      }
      f.sent.push(push);
    },
  });
  f.batcher.schedule({ chatId: "c1", recipients: ["u2"], body: "one" });
  await f.advance(15_000);
  assert.equal(f.sent.length, 0);
  assert.equal(f.logs.length, 1);
  assert.match(f.logs[0], /PushError/);
  assert.equal(f.logs[0].includes("secret detail"), false);
  assert.equal(f.batcher.pending(), 0);

  fail = false;
  f.batcher.schedule({ chatId: "c1", recipients: ["u3"], body: "two" });
  await f.advance(15_000);
  assert.deepEqual(f.sent.map((p) => p.userId), ["u3"]);
});

test("batcher: an async send that rejects is logged too, and a broken log does not throw", async () => {
  const f = batcherFixture({
    send: async () => {
      throw new Error("nope");
    },
    log: () => {
      throw new Error("log is broken");
    },
  });
  f.batcher.schedule({ chatId: "c1", recipients: ["u2"], body: "one" });
  await f.advance(15_000);
  assert.equal(f.batcher.pending(), 0);
});

test("batcher: flush(true) fires every slot at once", async () => {
  const f = batcherFixture();
  f.batcher.schedule({ chatId: "c1", recipients: ["u2", "u3"], body: "one" });
  f.batcher.schedule({ chatId: "c2", recipients: ["u2"], body: "two" });
  assert.equal(f.batcher.pending(), 3);
  await f.batcher.flush();
  assert.equal(f.sent.length, 0);
  await f.batcher.flush(true);
  assert.equal(f.sent.length, 3);
  assert.equal(f.batcher.pending(), 0);
  assert.equal(f.timers().length, 0);
});

test("batcher: flush() fires only slots whose window is over", async () => {
  const f = batcherFixture();
  f.batcher.schedule({ chatId: "c1", recipients: ["u2"], body: "one" });
  f.setClock(1_000_000 + 15_000);
  await f.batcher.flush();
  assert.equal(f.sent.length, 1);
});

test("batcher: a slot that is busy sending is not fired twice", async () => {
  let release: () => void = () => {};
  let calls = 0;
  const f = batcherFixture({
    send: () => {
      calls += 1;
      return new Promise<void>((resolve) => {
        release = resolve;
      });
    },
  });
  f.batcher.schedule({ chatId: "c1", recipients: ["u2"], body: "one" });
  const first = f.batcher.flush(true);
  await settle();
  const second = f.batcher.flush(true);
  await settle();
  assert.equal(calls, 1);
  release();
  await Promise.all([first, second]);
  assert.equal(calls, 1);
});

test("batcher: dispose clears timers and drops slots", async () => {
  const f = batcherFixture();
  f.batcher.schedule({ chatId: "c1", recipients: ["u2", "u3"], body: "one" });
  assert.equal(f.timers().length, 2);
  f.batcher.dispose();
  assert.equal(f.timers().length, 0);
  assert.equal(f.batcher.pending(), 0);
  await f.advance(120_000);
  await f.batcher.flush(true);
  assert.equal(f.sent.length, 0);
});

test("batcher: the body is cut to 140 characters", async () => {
  const f = batcherFixture();
  f.batcher.schedule({ chatId: "c1", recipients: ["u2"], body: "x".repeat(300) });
  await f.advance(15_000);
  assert.equal(f.sent[0].firstBody.length, 140);
  assert.equal(f.sent[0].body.length, 140);
  f.batcher.schedule({ chatId: "c9", recipients: ["u2"], body: "😀".repeat(200) });
  await f.advance(15_000);
  assert.equal([...f.sent[1].firstBody].length, 140);
});

test("batcher: format builds the body, recipients are deduped", async () => {
  const f = batcherFixture({ format: (count, first) => `${count}x ${first}` });
  f.batcher.schedule({ chatId: "c1", recipients: ["u2", "u2"], body: "hey" });
  await f.advance(15_000);
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].body, "1x hey");
});

test("batcher: a message that arrives after the push opens a new slot", async () => {
  const f = batcherFixture();
  f.batcher.schedule({ chatId: "c1", recipients: ["u2"], body: "one" });
  await f.advance(15_000);
  f.batcher.schedule({ chatId: "c1", recipients: ["u2"], body: "two" });
  assert.equal(f.batcher.pending(), 1);
  await f.advance(60_000);
  assert.deepEqual(f.sent.map((p) => p.body), ["one", "two"]);
});

test("batcher: with real timers the default timer is unref'd and fires", async () => {
  const sent: ChatPush[] = [];
  const batcher = createChatPushBatcher({ send: (p) => void sent.push(p), windowMs: 5, gapMs: 10, log: () => {} });
  batcher.schedule({ chatId: "c1", recipients: ["u2"], body: "hi" });
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(sent.length, 1);
  batcher.dispose();
});
