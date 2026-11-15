# app-kit auth module (layer 2), design for 0.4.0

Files: `server/auth.ts` (createAuth), `server/auth-code.ts` (codes, hashing, email helpers), `server/mailer.ts` (Mailer, resendMailer, stubMailer). All re-exported from `server/index.ts`. `node:` built-ins only, erasable TS, relative imports end in `.ts`, zero runtime deps. The kit owns no schema: the app implements `AuthStore` over its own tables.

## Two shapes considered

A. One `createAuth(deps)` object. Deps (store, mailer, limiter, now, links) are given once; the object has the operations as methods. Public value exports: 8 (`createAuth`, `resendMailer`, `stubMailer`, the 5 helpers), 11 methods on the object. 5 small pure helpers (`generateRecoveryCode`, `normalizeRecoveryCode`, `hashSecret`, `normalizeEmail`, `needsEmail`), types.
B. Loose pure functions that each take `(deps, input)`: `signup`, `loginByCode`, `setEmail`, `verifyEmail`, `requestLostCode`, `consumeLostCode`, `startSession`, ... plus the same helpers. 13 exported values (the same 8 minus `createAuth`, plus `signup`, `rotateCode`, `setEmail`, `verifyEmail`, `loginByCode`, `requestLostCode`, `consumeLostCode`, `startSession`, `userForToken`, `endSession`; 17 in all), deps repeated at every call site, and an app can wire half of them (a limiter on login but not on lost code).

Pick A. One factory means one place where the deps are checked and wired, the rate limit and the one-live-link rule cannot be skipped by calling a different function, and an app wires 1 object instead of 17 loose functions. Same behaviour, 8 exported values instead of 17.

## Conventions

- Times are epoch milliseconds (number). `now()` is injected, default `Date.now`.
- Every `AuthStore` method may return a value or a Promise; the kit always awaits.
- Secrets at rest are `hashSecret(value)` = sha256 hex of the utf8 string. Raw codes and link tokens are never stored and never logged.
- Failures that are part of normal use are results (`{ ok: false, reason }`), never thrown. Throws are programmer errors (bad options) and store/infra errors.
- Email is trimmed and lowercased by `normalizeEmail`; `null` when it is not a plausible address (one `@`, a dot in the domain, no spaces, at most 254 chars).

## Types

```ts
export type MaybePromise<T> = T | Promise<T>;

/** What the kit needs to know about a user. The app maps its row to this. */
export type AuthUser = {
  id: string;
  name: string;
  /** null for users created before email was required. */
  email: string | null;
  /** epoch ms, null until the verify link was used. */
  emailVerifiedAt: number | null;
};

/** True when the user has no email yet (an account from before email was required). The app must then block everything except the add-email prompt. An unverified address does not need email: the app is usable and shows a banner while `user.emailVerifiedAt === null`. */
export function needsEmail(user: Pick<AuthUser, "email">): boolean;

export type LinkKind = "verify" | "recover";

export type AuthStore = {
  insertUser(user: { id: string; name: string; email: string; recoveryHash: string; createdAt: number }): MaybePromise<void>;
  findUserById(id: string): MaybePromise<AuthUser | undefined>;
  findUserByRecoveryHash(hash: string): MaybePromise<AuthUser | undefined>;
  /** Verified addresses only. An unverified address never matches. The app owns the unique index on verified emails. */
  findUserByVerifiedEmail(email: string): MaybePromise<AuthUser | undefined>;
  setRecoveryHash(userId: string, hash: string): MaybePromise<void>;
  /** Stores the new address and sets emailVerifiedAt to null. */
  setEmail(userId: string, email: string): MaybePromise<void>;
  /** Sets emailVerifiedAt only if the user's current email still equals `email`. False when it does not, or when another user already has this verified address (unique index). */
  markEmailVerified(userId: string, email: string, at: number): MaybePromise<boolean>;
  /** The app picks its own session id; the kit only knows the token hash. */
  insertSession(session: { userId: string; tokenHash: string; createdAt: number }): MaybePromise<void>;
  findUserBySessionHash(tokenHash: string): MaybePromise<AuthUser | undefined>;
  deleteSession(tokenHash: string): MaybePromise<void>;
  /** Deletes every session of the user except the one with `exceptTokenHash`. */
  deleteSessionsForUser(userId: string, exceptTokenHash?: string): MaybePromise<void>;
  insertLink(link: { tokenHash: string; userId: string; kind: LinkKind; email: string; expiresAt: number }): MaybePromise<void>;
  /** Atomic find-and-delete of one link of this kind: returns it only if it exists and `expiresAt > now`. An expired link is deleted and not returned. Single use depends on this being atomic. */
  takeLink(tokenHash: string, kind: LinkKind, now: number): MaybePromise<{ userId: string; email: string } | undefined>;
  deleteLinksForUser(userId: string, kind: LinkKind): MaybePromise<void>;
};

export type MailMessage = { to: string; subject: string; text: string; html: string };
export type Mailer = { send(message: MailMessage): Promise<void> };

/** Same shape as the kit's createRateLimiter() result. */
export type AuthLimiter = { hit(key: string, now: number): boolean };

export type AuthOptions = {
  store: AuthStore;
  /** No mailer = email off: signup and setEmail send nothing, requestLostCode answers ok:true and sends nothing. */
  mailer?: Mailer;
  limiter: AuthLimiter;
  /** Full URL for a link the app serves, with the token in the fragment, e.g. `https://app.example/recover#t=${token}`. */
  linkUrl(kind: LinkKind, token: string): string;
  /** Shown in mail subjects and bodies. */
  appName: string;
  now?: () => number;
  /** Turns what a person typed into the secret that is hashed, or null. Default: normalizeRecoveryCode. free-now passes one that also accepts legacy buzz codes. */
  normalize?: (input: string) => string | null;
  /** Lost-code consume also signs out the user's other sessions. Default false. */
  revokeOtherSessions?: boolean;
  /** Lost-code consume also rotates the recovery code and returns the new one once. Default true. */
  rotateOnLostCode?: boolean;
  /** Server-side log for mail failures. Receives a fixed message plus the error name, never a token, address or body. Default console.error. */
  log?: (message: string) => void;
};

export type Auth = {
  /** New user. Email required. Creates a recovery code (shown once) and sends a verify link. Does not start a session. */
  signup(input: { name: string; email: string }): Promise<
    { ok: true; user: AuthUser; recoveryCode: string } | { ok: false; reason: "invalid_email" }
  >;
  /** Replaces the recovery code, old one stops working. Returns the new code. */
  rotateCode(userId: string): Promise<{ code: string }>;
  /** Sets or changes the address (also how an existing user adds one). Unverified until the link is used; sends a verify link, and calling it again with the same unverified address sends a fresh link (one live verify link per user); the same address when already verified is a no-op. Changing the address also kills the user's lost-code links. */
  setEmail(userId: string, email: string): Promise<
    { ok: true; user: AuthUser } | { ok: false; reason: "invalid_email" | "rate_limited" | "not_found" }
  >;
  /** Consumes a verify token. */
  verifyEmail(token: string): Promise<{ ok: true; user: AuthUser } | { ok: false; reason: "invalid" | "email_taken" }>;

  /** Recovery-code login. `ip` is the app's client key (right-most X-Forwarded-For on Railway). Starts a session. */
  loginByCode(input: { code: string; ip: string }): Promise<
    { ok: true; user: AuthUser; token: string } | { ok: false; reason: "invalid" | "rate_limited" }
  >;
  /** Lost-code mail. The answer never depends on whether the address exists or is verified; the mail goes out without being awaited so timing does not tell either. Only verified addresses get a link. */
  requestLostCode(input: { email: string; ip: string }): Promise<{ ok: true } | { ok: false; reason: "rate_limited" }>;
  /** Consumes a lost-code token (single use, 20 min), starts a new session, and by default rotates the recovery code, returning the new code once as `recoveryCode` (the app shows it). Opt out with `rotateOnLostCode: false`. */
  consumeLostCode(token: string): Promise<
    { ok: true; user: AuthUser; token: string; recoveryCode?: string } | { ok: false; reason: "invalid" }
  >;

  startSession(userId: string): Promise<{ token: string }>;
  /** The user for a session token, or undefined. Apps check needsEmail(user) here. */
  userForToken(token: string): Promise<AuthUser | undefined>;
  endSession(token: string): Promise<void>;
};

export function createAuth(options: AuthOptions): Auth;
```

Helpers (auth-code.ts): `generateRecoveryCode()` (XXXX-XXXX-XXXX from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, CSPRNG without modulo bias), `normalizeRecoveryCode(input): string | null`, `hashSecret(value): string`, `normalizeEmail(input): string | null`, `needsEmail`. Link tokens are internal: 32 random bytes base64url, hashed with `hashSecret`; session tokens the same.

Mailers (mailer.ts): `resendMailer({ apiKey, from, fetch? }): Mailer` POSTs `https://api.resend.com/emails` with fetch, Bearer key, JSON `{from, to, subject, text, html}`; a non-2xx response throws `MailerError` naming only the status (never the response body or request). `stubMailer(): Mailer & { sent: MailMessage[] }` records messages.

Email rules, do not mix up: `signup` and `setEmail` REJECT a missing or malformed email (`invalid_email`). `requestLostCode` with a missing, malformed, unknown, unverified or valid email always answers `{ ok: true }` (unless rate limited); it never reveals which.

Fire-and-forget mail: the lost-code send is started but not awaited. Wrap it so a rejection is caught and logged as a fixed message plus `error.name` only (never `error.message`, address or token); an unhandled rejection would fail `node --test`. Verify mail from `signup`/`setEmail` is awaited inside the same catch, so it also never throws. Tests flush with `await new Promise((r) => setImmediate(r))` before asserting. The "token never logged" test uses a mailer that throws an Error whose message contains the token, then asserts no captured log line contains the token.

Design choice: consuming a lost-code link rotates the recovery code by default (new session, and a new code returned once as `recoveryCode`, so the old code stops working). Pass `rotateOnLostCode: false` to leave the old code in place; the app can still call `rotateCode` itself in that case. Other sessions are kept unless `revokeOtherSessions`. A failed consume (invalid, expired, email changed, unverified) rotates nothing and starts no session.

Not built (ideas): mail text localization or overrides, session-id passthrough, a `resendVerification` method (setEmail with the same address does it), name validation (the app owns it).

Rules the tests pin down:
- Lost-code link: ttl 20 min; single use; one live link per user (a new request deletes the old; consume deletes all); constant `{ok:true}`; limiter per email and per ip (key prefixes `lost:email:` and `lost:ip:`); mailer failure is logged (name only) and still `{ok:true}`; token never in any log line; mail has plain text plus minimal html, no tracking pixel, no images.
- Verify link: same token format, ttl 24 h, kind "verify", carries the email; used only if the user's email still equals it.
- loginByCode limiter key `code:` + ip. setEmail limiter key `email:` + userId. All via the one injected limiter.
- Lost-code consume requires the user's current email to equal the link's email and still be verified.

## Usage

```ts
import { createAuth, resendMailer, createRateLimiter, clientKey, needsEmail, readJson, sendJson } from "./app-kit/index.ts";

const auth = createAuth({
  store: sqliteAuthStore(db),               // the app's ~15 small queries
  mailer: process.env.RESEND_API_KEY ? resendMailer({ apiKey: process.env.RESEND_API_KEY, from: process.env.MAIL_FROM! }) : undefined,
  limiter: createRateLimiter({ limit: 10, windowMs: 10 * 60_000 }),
  linkUrl: (kind, token) => `${origin}/${kind === "verify" ? "verify" : "recover"}#t=${token}`,
  appName: "Loan some",
});

// POST /api/auth/start
const r = await auth.signup({ name, email });
if (!r.ok) throw new HttpError(400, "that email does not look right");
const { token } = await auth.startSession(r.user.id);
sendJson(res, 200, { token, recoveryCode: r.recoveryCode, user: r.user });

// every authed route
const user = await auth.userForToken(bearer);
if (!user) throw new HttpError(401, "sign in");
if (needsEmail(user) && !isAddEmailRoute) throw new HttpError(403, "add an email first");
```

## Rationale

The shape is one factory because every operation needs the same five collaborators (store, mailer, limiter, clock, link URLs) and the security rules (rate limits, one live link, constant answers, hashing) only hold if they are applied the same way everywhere. A factory applies them in one place and gives the three apps one name to import. The cost, a bigger single object, is small: 11 methods that are each one call in a route. The store has no schema and no transaction: it is 14 plain methods, with atomicity only required in `takeLink`, so a SQLite, Postgres or in-memory store all fit. The "existing user must add an email" rule is a state the kit reports (`needsEmail` = "missing") and the app enforces in its own middleware, because only the app knows its routes.
