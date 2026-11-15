import assert from "node:assert/strict";
import test from "node:test";
import { createAuth } from "../../server/auth.ts";
import type { AuthOptions } from "../../server/auth.ts";
import { generateRecoveryCode, hashSecret, needsEmail } from "../../server/auth-code.ts";
import type { Mailer, MailMessage } from "../../server/mailer.ts";
import { stubMailer } from "../../server/mailer.ts";
import { createRateLimiter } from "../../server/rate-limit.ts";
import { memoryStore } from "./auth-memory-store.ts";

const MIN = 60_000;
const HOUR = 60 * MIN;
const flush = () => new Promise((resolve) => setImmediate(resolve));

type Issued = { kind: string; token: string };

function setup(overrides: Partial<AuthOptions> = {}, withMailer = true) {
  const m = memoryStore();
  const mailer = stubMailer();
  const clock = { t: 1_700_000_000_000 };
  const issued: Issued[] = [];
  const logs: string[] = [];
  const auth = createAuth({
    store: m.store,
    mailer: withMailer ? mailer : undefined,
    limiter: createRateLimiter({ limit: 100, windowMs: HOUR }),
    linkUrl: (kind, token) => {
      issued.push({ kind, token });
      return `https://app.test/${kind}#t=${token}`;
    },
    appName: "Test App",
    now: () => clock.t,
    log: (line) => logs.push(line),
    ...overrides,
  });
  return { m, mailer, clock, issued, logs, auth };
}

/** The token in the last mail's link. */
function tokenIn(message: MailMessage): string {
  const match = /#t=([A-Za-z0-9_-]+)/.exec(message.text);
  assert.ok(match, "the mail text has a link with a token");
  return match[1];
}

function verifiedUser(m: ReturnType<typeof memoryStore>, id = "u1", email = "ann@example.com") {
  return m.seedUser({ id, name: "Ann", email, emailVerifiedAt: 1 });
}

// ---------- options ----------

test("createAuth throws TypeError when store, limiter, linkUrl or appName is missing", () => {
  const good = setup().auth;
  assert.ok(good);
  const base: AuthOptions = {
    store: memoryStore().store,
    limiter: createRateLimiter({ limit: 1, windowMs: 1000 }),
    linkUrl: () => "https://x.test",
    appName: "X",
  };
  assert.ok(createAuth(base));
  for (const key of ["store", "limiter", "linkUrl", "appName"] as const) {
    const options = { ...base, [key]: undefined } as AuthOptions;
    assert.throws(() => createAuth(options), TypeError, key);
  }
  assert.throws(() => createAuth({ ...base, appName: "  " }), TypeError);
  assert.throws(() => createAuth(undefined as unknown as AuthOptions), TypeError);
});

// ---------- signup ----------

test("signup requires a valid email: missing, empty and malformed give invalid_email and create nothing", async () => {
  const { auth, m, mailer } = setup();
  for (const email of [undefined as unknown as string, "", "   ", "not-an-email", "a@b"]) {
    assert.deepEqual(await auth.signup({ name: "Ann", email }), { ok: false, reason: "invalid_email" });
  }
  assert.equal(m.users.size, 0);
  assert.equal(m.links().length, 0);
  assert.equal(mailer.sent.length, 0);
});

test("signup stores the trimmed lowercase email, a code whose hash is stored, and sends one verify mail", async () => {
  const { auth, m, mailer, issued } = setup();
  const r = await auth.signup({ name: "Ann", email: "  Ann@Example.COM " });
  assert.ok(r.ok);
  assert.equal(r.user.email, "ann@example.com");
  assert.equal(r.user.name, "Ann");
  assert.equal(r.user.emailVerifiedAt, null);
  assert.match(r.recoveryCode, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  const row = m.users.get(r.user.id);
  assert.ok(row);
  assert.equal(row.email, "ann@example.com");
  assert.equal(row.recoveryHash, hashSecret(r.recoveryCode));
  assert.equal(JSON.stringify([...m.users.values()]).includes(r.recoveryCode), false, "the raw code is not stored");
  // one verify mail
  assert.equal(mailer.sent.length, 1);
  assert.equal(mailer.sent[0].to, "ann@example.com");
  assert.deepEqual(issued.map((i) => i.kind), ["verify"]);
  assert.ok(mailer.sent[0].text.includes("Test App"));
  assert.ok(mailer.sent[0].text.includes(issued[0].token));
  assert.ok(mailer.sent[0].html.includes("Test App"));
  assert.equal(/<img/i.test(mailer.sent[0].html), false, "no images or tracking pixels");
  // no session
  assert.equal(m.sessions.length, 0);
});

test("signup with no mailer sends nothing and still succeeds", async () => {
  const { auth, m, mailer, issued } = setup({}, false);
  const r = await auth.signup({ name: "Ann", email: "ann@example.com" });
  assert.ok(r.ok);
  assert.equal(mailer.sent.length, 0);
  assert.equal(issued.length, 0);
  assert.equal(m.users.size, 1);
});

test("signup still succeeds when the mailer throws, and logs only the error name", async () => {
  const mailer: Mailer = {
    async send(message) {
      throw new Error(`down: ${message.to} ${message.text}`);
    },
  };
  const { auth, logs } = setup({ mailer });
  const r = await auth.signup({ name: "Ann", email: "ann@example.com" });
  assert.ok(r.ok);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /Error/);
  assert.equal(/ann@example\.com|#t=|down/.test(logs[0]), false);
});

// ---------- needsEmail / legacy users ----------

test("a legacy user needs an email; setEmail fixes that and leaves it unverified; userForToken returns the user", async () => {
  const { auth, m } = setup();
  m.seedUser({ id: "old", name: "Old", email: null });
  const { token } = await auth.startSession("old");
  const before = await auth.userForToken(token);
  assert.ok(before);
  assert.equal(needsEmailOf(before), true);

  const r = await auth.setEmail("old", "Old@Example.com");
  assert.ok(r.ok);
  assert.equal(r.user.email, "old@example.com");
  assert.equal(r.user.emailVerifiedAt, null);

  const after = await auth.userForToken(token);
  assert.ok(after);
  assert.equal(needsEmailOf(after), false);
  assert.equal(after.emailVerifiedAt, null);
});

function needsEmailOf(user: { email: string | null }): boolean {
  return needsEmail(user);
}

test("a user with an email does not need one", async () => {
  const { auth } = setup();
  const r = await auth.signup({ name: "Ann", email: "ann@example.com" });
  assert.ok(r.ok);
  const { token } = await auth.startSession(r.user.id);
  const user = await auth.userForToken(token);
  assert.ok(user);
  assert.equal(needsEmailOf(user), false);
});

// ---------- setEmail ----------

test("setEmail: invalid_email, not_found, rate_limited", async () => {
  const keys: string[] = [];
  const limiter = { hit: (key: string) => (keys.push(key), keys.filter((k) => k === key).length <= 1) };
  const { auth, m } = setup({ limiter });
  m.seedUser({ id: "u1", name: "A" });
  assert.deepEqual(await auth.setEmail("u1", "nope"), { ok: false, reason: "invalid_email" });
  assert.deepEqual(await auth.setEmail("ghost", "a@example.com"), { ok: false, reason: "not_found" });
  assert.ok((await auth.setEmail("u1", "a@example.com")).ok);
  assert.deepEqual(await auth.setEmail("u1", "b@example.com"), { ok: false, reason: "rate_limited" });
  assert.ok(keys.every((k) => k === "email:u1"));
  assert.equal(m.users.get("u1")?.email, "a@example.com", "a rate-limited call changes nothing");
});

test("setEmail with the address the user already has verified is a no-op: stays verified, sends nothing", async () => {
  const { m, mailer, auth } = setup();
  verifiedUser(m);
  const r = await auth.setEmail("u1", " ANN@example.com ");
  assert.equal(r.ok, true);
  assert.equal(m.users.get("u1")?.emailVerifiedAt, 1);
  assert.equal(mailer.sent.length, 0);
});

test("setEmail replaces the old verify link: one live link per user", async () => {
  const { auth, m, mailer } = setup();
  m.seedUser({ id: "u1", name: "A" });
  await auth.setEmail("u1", "a@example.com");
  await auth.setEmail("u1", "a@example.com");
  assert.equal(mailer.sent.length, 2);
  const [first, second] = mailer.sent.map(tokenIn);
  assert.equal(m.links().filter((l) => l.kind === "verify" && l.userId === "u1").length, 1);
  assert.deepEqual(await auth.verifyEmail(first), { ok: false, reason: "invalid" });
  const ok = await auth.verifyEmail(second);
  assert.ok(ok.ok);
});

test("setEmail kills the user's lost-code links", async () => {
  const { auth, m, mailer } = setup();
  verifiedUser(m);
  await auth.requestLostCode({ email: "ann@example.com", ip: "1.1.1.1" });
  await flush();
  assert.equal(m.links().filter((l) => l.kind === "recover").length, 1);
  const lostToken = tokenIn(mailer.sent[0]);
  await auth.setEmail("u1", "new@example.com");
  assert.equal(m.links().filter((l) => l.kind === "recover").length, 0);
  assert.deepEqual(await auth.consumeLostCode(lostToken), { ok: false, reason: "invalid" });
});

// ---------- verifyEmail ----------

test("verifyEmail marks the address verified and the link is single use", async () => {
  const { auth, m, mailer, clock } = setup();
  const r = await auth.signup({ name: "Ann", email: "ann@example.com" });
  assert.ok(r.ok);
  const token = tokenIn(mailer.sent[0]);
  clock.t += 5 * MIN;
  const v = await auth.verifyEmail(token);
  assert.ok(v.ok);
  assert.equal(v.user.emailVerifiedAt, clock.t);
  assert.equal(m.users.get(r.user.id)?.emailVerifiedAt, clock.t);
  assert.deepEqual(await auth.verifyEmail(token), { ok: false, reason: "invalid" });
});

test("verifyEmail: valid until 24 h, expired from 24 h on", async () => {
  for (const [offset, expected] of [[24 * HOUR - 1, true], [24 * HOUR, false], [24 * HOUR + 1, false]] as const) {
    const { auth, mailer, clock } = setup();
    await auth.signup({ name: "Ann", email: "ann@example.com" });
    clock.t += offset;
    const v = await auth.verifyEmail(tokenIn(mailer.sent[0]));
    assert.equal(v.ok, expected, `offset ${offset}`);
    if (!v.ok) assert.equal(v.reason, "invalid");
  }
});

test("verifyEmail: unknown or odd tokens are invalid", async () => {
  const { auth } = setup();
  assert.deepEqual(await auth.verifyEmail("nope"), { ok: false, reason: "invalid" });
  assert.deepEqual(await auth.verifyEmail(""), { ok: false, reason: "invalid" });
  assert.deepEqual(await auth.verifyEmail(undefined as unknown as string), { ok: false, reason: "invalid" });
});

test("verifyEmail: a link is invalid when the email changed after it was issued", async () => {
  const { auth, m, mailer } = setup();
  const r = await auth.signup({ name: "Ann", email: "ann@example.com" });
  assert.ok(r.ok);
  // The app changes the address behind the kit's back (no new link).
  await m.store.setEmail(r.user.id, "other@example.com");
  assert.deepEqual(await auth.verifyEmail(tokenIn(mailer.sent[0])), { ok: false, reason: "invalid" });
  assert.equal(m.users.get(r.user.id)?.emailVerifiedAt, null);
});

test("verifyEmail: email_taken when another user already holds the verified address", async () => {
  const { auth, m, mailer } = setup();
  verifiedUser(m, "holder", "ann@example.com");
  const r = await auth.signup({ name: "Ann 2", email: "ann@example.com" });
  assert.ok(r.ok);
  assert.deepEqual(await auth.verifyEmail(tokenIn(mailer.sent[0])), { ok: false, reason: "email_taken" });
  assert.equal(m.users.get(r.user.id)?.emailVerifiedAt, null);
});

// ---------- lost-code link ----------

test("requestLostCode mails a link of kind recover to a verified address only", async () => {
  const { auth, m, mailer, issued } = setup();
  verifiedUser(m);
  assert.deepEqual(await auth.requestLostCode({ email: " ANN@example.com ", ip: "1.1.1.1" }), { ok: true });
  await flush();
  assert.equal(mailer.sent.length, 1);
  assert.equal(mailer.sent[0].to, "ann@example.com");
  assert.deepEqual(issued.map((i) => i.kind), ["recover"]);
  assert.ok(mailer.sent[0].text.includes("20 minutes"));
  assert.equal(/<img/i.test(mailer.sent[0].html), false);
  const [link] = m.links();
  assert.equal(link.tokenHash, hashSecret(issued[0].token), "only the hash is stored");
  assert.equal(link.expiresAt, 1_700_000_000_000 + 20 * MIN);
});

test("requestLostCode answers exactly { ok: true } for every kind of address and mails only the verified one", async () => {
  const { auth, m, mailer } = setup();
  verifiedUser(m, "v", "verified@example.com");
  m.seedUser({ id: "u", name: "U", email: "unverified@example.com", emailVerifiedAt: null });
  const answers = [];
  for (const email of [
    "verified@example.com",
    "unverified@example.com",
    "unknown@example.com",
    "not-an-email",
    "",
    undefined as unknown as string,
  ]) {
    answers.push(await auth.requestLostCode({ email, ip: "9.9.9.9" }));
  }
  await flush();
  for (const answer of answers) assert.deepEqual(answer, { ok: true });
  assert.deepEqual(Object.keys(answers[0]), ["ok"]);
  assert.equal(mailer.sent.length, 1);
  assert.equal(mailer.sent[0].to, "verified@example.com");
  assert.equal(m.links().filter((l) => l.userId === "u").length, 0, "the unverified address gets no link");
});

test("requestLostCode with no mailer answers ok and sends nothing", async () => {
  const { auth, m, mailer } = setup({}, false);
  verifiedUser(m);
  assert.deepEqual(await auth.requestLostCode({ email: "ann@example.com", ip: "1.1.1.1" }), { ok: true });
  await flush();
  assert.equal(mailer.sent.length, 0);
  assert.equal(m.links().length, 0);
});

test("lost-code link: valid up to 20 min minus 1 ms, invalid at exactly 20 min", async () => {
  for (const [offset, expected] of [[20 * MIN - 1, true], [20 * MIN, false], [20 * MIN + 1, false]] as const) {
    const { auth, m, mailer, clock } = setup();
    verifiedUser(m);
    await auth.requestLostCode({ email: "ann@example.com", ip: "1.1.1.1" });
    await flush();
    clock.t += offset;
    const r = await auth.consumeLostCode(tokenIn(mailer.sent[0]));
    assert.equal(r.ok, expected, `offset ${offset}`);
  }
});

test("lost-code link is single use", async () => {
  const { auth, m, mailer } = setup();
  verifiedUser(m);
  await auth.requestLostCode({ email: "ann@example.com", ip: "1.1.1.1" });
  await flush();
  const token = tokenIn(mailer.sent[0]);
  assert.ok((await auth.consumeLostCode(token)).ok);
  assert.deepEqual(await auth.consumeLostCode(token), { ok: false, reason: "invalid" });
});

test("one live lost-code link per user: a second request invalidates the first", async () => {
  const { auth, m, mailer } = setup();
  verifiedUser(m);
  await auth.requestLostCode({ email: "ann@example.com", ip: "1.1.1.1" });
  await flush();
  await auth.requestLostCode({ email: "ann@example.com", ip: "1.1.1.1" });
  await flush();
  assert.equal(mailer.sent.length, 2);
  assert.equal(m.links().filter((l) => l.kind === "recover").length, 1);
  const [first, second] = mailer.sent.map(tokenIn);
  assert.deepEqual(await auth.consumeLostCode(first), { ok: false, reason: "invalid" });
  assert.ok((await auth.consumeLostCode(second)).ok);
});

test("consume deletes every other lost-code link of the user", async () => {
  const { auth, m, mailer } = setup();
  verifiedUser(m);
  await auth.requestLostCode({ email: "ann@example.com", ip: "1.1.1.1" });
  await flush();
  // A stray second live link, as a racing request could leave behind.
  await m.store.insertLink({ tokenHash: "stray", userId: "u1", kind: "recover", email: "ann@example.com", expiresAt: Infinity });
  assert.ok((await auth.consumeLostCode(tokenIn(mailer.sent[0]))).ok);
  assert.equal(m.links().length, 0);
});

test("requestLostCode is rate limited per email and per ip, and then sends nothing", async () => {
  const limiter = createRateLimiter({ limit: 2, windowMs: HOUR });
  const { auth, m, mailer } = setup({ limiter });
  verifiedUser(m, "u1", "ann@example.com");
  verifiedUser(m, "u2", "bob@example.com");

  // per email: the same address from different ips
  assert.deepEqual(await auth.requestLostCode({ email: "ann@example.com", ip: "10.0.0.1" }), { ok: true });
  assert.deepEqual(await auth.requestLostCode({ email: "ann@example.com", ip: "10.0.0.2" }), { ok: true });
  await flush();
  assert.equal(mailer.sent.length, 2);
  assert.deepEqual(await auth.requestLostCode({ email: "Ann@example.com", ip: "10.0.0.3" }), { ok: false, reason: "rate_limited" });
  await flush();
  assert.equal(mailer.sent.length, 2, "no mail when rate limited");

  // per ip: the same ip with different (here unknown) addresses
  assert.deepEqual(await auth.requestLostCode({ email: "x1@example.com", ip: "10.9.9.9" }), { ok: true });
  assert.deepEqual(await auth.requestLostCode({ email: "x2@example.com", ip: "10.9.9.9" }), { ok: true });
  assert.deepEqual(await auth.requestLostCode({ email: "bob@example.com", ip: "10.9.9.9" }), { ok: false, reason: "rate_limited" });
  await flush();
  assert.equal(mailer.sent.length, 2);
});

test("limiter keys are code:ip, email:userId, lost:email:address and lost:ip:ip", async () => {
  const keys: string[] = [];
  const { auth, m } = setup({ limiter: { hit: (key) => (keys.push(key), true) } });
  verifiedUser(m);
  await auth.loginByCode({ code: "ABCD-EFGH-JKLM", ip: "1.2.3.4" });
  await auth.setEmail("u1", "ann2@example.com");
  await auth.requestLostCode({ email: "Ann@Example.com", ip: "5.6.7.8" });
  await flush();
  assert.deepEqual(keys.sort(), ["code:1.2.3.4", "email:u1", "lost:email:ann@example.com", "lost:ip:5.6.7.8"]);
});

test("a mailer that throws still gives ok:true, and the log has the error name only, never the token", async () => {
  let seenToken = "";
  const mailer: Mailer = {
    async send(message) {
      seenToken = tokenIn(message);
      throw new Error(`provider rejected ${message.to} with ${seenToken}`);
    },
  };
  const { auth, m, logs } = setup({ mailer });
  verifiedUser(m);
  assert.deepEqual(await auth.requestLostCode({ email: "ann@example.com", ip: "1.1.1.1" }), { ok: true });
  await flush();
  assert.ok(seenToken.length > 20);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /Error/);
  for (const line of logs) {
    assert.equal(line.includes(seenToken), false, "token in log");
    assert.equal(line.includes("ann@example.com"), false, "address in log");
    assert.equal(line.includes("provider rejected"), false, "error message in log");
  }
});

test("a store failure in the background send is logged by name and does not become an unhandled rejection", async () => {
  const { auth, m, logs } = setup();
  verifiedUser(m);
  m.store.insertLink = () => {
    throw new RangeError("disk secret path");
  };
  assert.deepEqual(await auth.requestLostCode({ email: "ann@example.com", ip: "1.1.1.1" }), { ok: true });
  await flush();
  assert.equal(logs.length, 1);
  assert.match(logs[0], /RangeError/);
  assert.equal(logs[0].includes("disk secret path"), false);
});

test("the default log is console.error", async () => {
  const lines: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => void lines.push(args);
  try {
    const mailer: Mailer = {
      async send() {
        throw new TypeError("x");
      },
    };
    const { auth } = setup({ mailer, log: undefined });
    await auth.signup({ name: "Ann", email: "ann@example.com" });
  } finally {
    console.error = original;
  }
  assert.equal(lines.length, 1);
  assert.equal(typeof lines[0][0], "string");
  assert.match(String(lines[0][0]), /TypeError/);
});

test("consumeLostCode starts a new session and keeps the other sessions by default", async () => {
  const { auth, m, mailer } = setup();
  verifiedUser(m);
  const other = await auth.startSession("u1");
  await auth.requestLostCode({ email: "ann@example.com", ip: "1.1.1.1" });
  await flush();
  const r = await auth.consumeLostCode(tokenIn(mailer.sent[0]));
  assert.ok(r.ok);
  assert.equal(r.user.id, "u1");
  assert.notEqual(r.token, other.token);
  assert.equal((await auth.userForToken(r.token))?.id, "u1");
  assert.equal((await auth.userForToken(other.token))?.id, "u1");
  assert.equal(m.sessions.length, 2);
});

test("consumeLostCode does not change the recovery code", async () => {
  const { auth, m, mailer } = setup();
  const row = verifiedUser(m);
  const hash = row.recoveryHash;
  await auth.requestLostCode({ email: "ann@example.com", ip: "1.1.1.1" });
  await flush();
  await auth.consumeLostCode(tokenIn(mailer.sent[0]));
  assert.equal(m.users.get("u1")?.recoveryHash, hash);
});

test("revokeOtherSessions: true removes the user's other sessions but not other users'", async () => {
  const { auth, m, mailer } = setup({ revokeOtherSessions: true });
  verifiedUser(m);
  verifiedUser(m, "u2", "bob@example.com");
  const other = await auth.startSession("u1");
  const bystander = await auth.startSession("u2");
  await auth.requestLostCode({ email: "ann@example.com", ip: "1.1.1.1" });
  await flush();
  const r = await auth.consumeLostCode(tokenIn(mailer.sent[0]));
  assert.ok(r.ok);
  assert.equal(await auth.userForToken(other.token), undefined);
  assert.equal((await auth.userForToken(r.token))?.id, "u1");
  assert.equal((await auth.userForToken(bystander.token))?.id, "u2");
});

test("consumeLostCode is invalid when the email changed after the link was issued", async () => {
  const { auth, m, mailer } = setup();
  verifiedUser(m);
  await auth.requestLostCode({ email: "ann@example.com", ip: "1.1.1.1" });
  await flush();
  // Changed behind the kit's back, so the link was not deleted.
  const row = m.users.get("u1");
  assert.ok(row);
  row.email = "changed@example.com";
  assert.deepEqual(await auth.consumeLostCode(tokenIn(mailer.sent[0])), { ok: false, reason: "invalid" });
  assert.equal(m.sessions.length, 0);
});

test("consumeLostCode is invalid when the address is no longer verified", async () => {
  const { auth, m, mailer } = setup();
  verifiedUser(m);
  await auth.requestLostCode({ email: "ann@example.com", ip: "1.1.1.1" });
  await flush();
  const row = m.users.get("u1");
  assert.ok(row);
  row.emailVerifiedAt = null;
  assert.deepEqual(await auth.consumeLostCode(tokenIn(mailer.sent[0])), { ok: false, reason: "invalid" });
});

test("a verify link is not accepted as a lost-code link and the other way round", async () => {
  const { auth, m, mailer } = setup();
  const r = await auth.signup({ name: "Ann", email: "ann@example.com" });
  assert.ok(r.ok);
  const verifyToken = tokenIn(mailer.sent[0]);
  assert.deepEqual(await auth.consumeLostCode(verifyToken), { ok: false, reason: "invalid" });
  assert.ok((await auth.verifyEmail(verifyToken)).ok, "the verify link was not used up by the wrong kind");
  await auth.requestLostCode({ email: "ann@example.com", ip: "1.1.1.1" });
  await flush();
  assert.deepEqual(await auth.verifyEmail(tokenIn(mailer.sent[1])), { ok: false, reason: "invalid" });
  assert.equal(m.users.size, 1);
});

// ---------- loginByCode / rotateCode ----------

test("loginByCode accepts the code as typed (lowercase, spaces) and starts a session", async () => {
  const { auth, m } = setup();
  const r = await auth.signup({ name: "Ann", email: "ann@example.com" });
  assert.ok(r.ok);
  const typed = r.recoveryCode.toLowerCase().replaceAll("-", " ");
  const login = await auth.loginByCode({ code: typed, ip: "1.1.1.1" });
  assert.ok(login.ok);
  assert.equal(login.user.id, r.user.id);
  assert.equal((await auth.userForToken(login.token))?.id, r.user.id);
  assert.equal(m.sessions.length, 1);
});

test("loginByCode: a wrong, malformed or empty code is invalid and starts no session", async () => {
  const { auth, m } = setup();
  await auth.signup({ name: "Ann", email: "ann@example.com" });
  for (const code of [generateRecoveryCode(), "short", "", undefined as unknown as string]) {
    assert.deepEqual(await auth.loginByCode({ code, ip: "1.1.1.1" }), { ok: false, reason: "invalid" });
  }
  assert.equal(m.sessions.length, 0);
});

test("loginByCode is rate limited per ip after the limit; another ip is unaffected", async () => {
  const limiter = createRateLimiter({ limit: 3, windowMs: HOUR });
  const { auth } = setup({ limiter });
  const r = await auth.signup({ name: "Ann", email: "ann@example.com" });
  assert.ok(r.ok);
  for (let i = 0; i < 3; i++) {
    assert.deepEqual(await auth.loginByCode({ code: generateRecoveryCode(), ip: "1.1.1.1" }), { ok: false, reason: "invalid" });
  }
  // Even the right code is refused once the limit is hit.
  assert.deepEqual(await auth.loginByCode({ code: r.recoveryCode, ip: "1.1.1.1" }), { ok: false, reason: "rate_limited" });
  assert.ok((await auth.loginByCode({ code: r.recoveryCode, ip: "2.2.2.2" })).ok);
});

test("a custom normalize option lets a legacy secret log in", async () => {
  const { auth, m } = setup({ normalize: (input) => input.trim() || null });
  m.seedUser({ id: "legacy", name: "Buzz", email: null, recoveryHash: hashSecret("buzz secret phrase 42") });
  const login = await auth.loginByCode({ code: "  buzz secret phrase 42 ", ip: "1.1.1.1" });
  assert.ok(login.ok);
  assert.equal(login.user.id, "legacy");
  assert.deepEqual(await auth.loginByCode({ code: "buzz secret phrase 43", ip: "1.1.1.1" }), { ok: false, reason: "invalid" });
  assert.deepEqual(await auth.loginByCode({ code: "   ", ip: "1.1.1.1" }), { ok: false, reason: "invalid" });
});

test("the default normalize rejects a legacy secret", async () => {
  const { auth, m } = setup();
  m.seedUser({ id: "legacy", name: "Buzz", recoveryHash: hashSecret("buzz secret phrase 42") });
  assert.deepEqual(await auth.loginByCode({ code: "buzz secret phrase 42", ip: "1.1.1.1" }), { ok: false, reason: "invalid" });
});

test("rotateCode makes the old code stop working and the new one work", async () => {
  const { auth, m } = setup();
  const r = await auth.signup({ name: "Ann", email: "ann@example.com" });
  assert.ok(r.ok);
  const { code } = await auth.rotateCode(r.user.id);
  assert.match(code, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.notEqual(code, r.recoveryCode);
  assert.equal(m.users.get(r.user.id)?.recoveryHash, hashSecret(code));
  assert.deepEqual(await auth.loginByCode({ code: r.recoveryCode, ip: "1.1.1.1" }), { ok: false, reason: "invalid" });
  assert.ok((await auth.loginByCode({ code, ip: "1.1.1.1" })).ok);
});

// ---------- sessions ----------

test("startSession, userForToken and endSession", async () => {
  const { auth, m } = setup();
  verifiedUser(m);
  const a = await auth.startSession("u1");
  const b = await auth.startSession("u1");
  assert.notEqual(a.token, b.token);
  assert.match(a.token, /^[A-Za-z0-9_-]{43}$/, "32 random bytes, base64url");
  assert.equal((await auth.userForToken(a.token))?.email, "ann@example.com");
  await auth.endSession(a.token);
  assert.equal(await auth.userForToken(a.token), undefined);
  assert.equal((await auth.userForToken(b.token))?.id, "u1");
});

test("an unknown, empty or odd session token gives undefined", async () => {
  const { auth } = setup();
  assert.equal(await auth.userForToken("nope"), undefined);
  assert.equal(await auth.userForToken(""), undefined);
  assert.equal(await auth.userForToken(undefined as unknown as string), undefined);
  await auth.endSession("nope");
  await auth.endSession("");
});

test("only the hash of a session token is stored, and a stored hash is not a token", async () => {
  const { auth, m } = setup();
  verifiedUser(m);
  const { token } = await auth.startSession("u1");
  assert.equal(m.sessions.length, 1);
  assert.equal(m.sessions[0].tokenHash, hashSecret(token));
  assert.equal(m.sessions[0].createdAt, 1_700_000_000_000);
  assert.equal(JSON.stringify(m.sessions).includes(token), false);
  assert.equal(await auth.userForToken(m.sessions[0].tokenHash), undefined, "the hash cannot be used as a token");
});

test("link tokens are 32 random bytes, stored only as their hash", async () => {
  const { auth, m, issued } = setup();
  await auth.signup({ name: "Ann", email: "ann@example.com" });
  assert.match(issued[0].token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(m.links().length, 1);
  assert.equal(m.links()[0].tokenHash, hashSecret(issued[0].token));
  assert.equal(m.links()[0].expiresAt, 1_700_000_000_000 + 24 * HOUR);
  assert.equal(m.links()[0].kind, "verify");
  assert.equal(m.links()[0].email, "ann@example.com");
});
