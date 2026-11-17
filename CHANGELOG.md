# Changelog

## 0.6.0 (unreleased)

Minor and additive: "native feel". Nothing is breaking. Every piece is opt-in, so an app that syncs this version and changes nothing looks and behaves as on 0.5.0. No existing name, API or token value changes, and `scripts/sync.sh`, `ak-sw.js` and `ak-sw-register.js` are untouched. Guide: `docs/native-feel.md`.

- `frontend/ak-transition.js`: `AppKit.transition.go(update, { direction })` runs `update` inside `document.startViewTransition` with `data-ak-nav` on `<html>` (`push`, `pop`; `none`, reduced motion and no support call `update()` directly), and returns a Promise that never throws synchronously. `AppKit.transition.swipeBack({ onBack, edge, threshold, target, force })` is an edge swipe back that only runs in an installed app (or with `force: true`) and returns `{ destroy }`.
- `frontend/ak-view-transitions.css`: `@view-transition { navigation: auto; }` and a reduced-motion guard, for multi-page apps. Its own file because an at-rule cannot be class-scoped.
- `frontend/ak-native.css`: under `html.ak-native` touch feel (no tap highlight, `touch-action: manipulation`, `user-select: none` on chrome only, instant `:active`), glass tab bar, the push and pop page slide, `html.ak-no-bounce` and `.ak-contain`. Also `html.ak-system-font`, `.ak-navbar` and `.ak-large-title`, the `.ak-ptr` indicator, and `.ak-skeleton*` classes. An `@supports` fallback gives the bars an opaque background without `backdrop-filter`. Reduced motion turns the animations off.
- `frontend/ak-native.js`: `AppKit.largeTitle` (toggles `ak-collapsed` with `IntersectionObserver`, scroll fallback), `AppKit.scroll.memory` and `AppKit.scroll.toTop`, `AppKit.pullToRefresh`, and one passive `touchstart` no-op listener so iOS applies `:active`.
- `frontend/ak-swr.js`: `AppKit.swr(key, fetcher, render, { maxAge, onError })` renders the `localStorage` copy (`ak-swr:` keys) at once, then the fresh value unless it is identical. Shared in-flight fetches, a broken `localStorage` means no cache. `AppKit.swr.clear(key)`.
- `frontend/ak-sheet.js`: velocity close, `snaps` and `snap` options with `snapTo(index)` on the result, and `scaleBackground`. The old API is unchanged.
- `frontend/ak-tabbar.js`: `onReselect`, `scrollTopOnReselect`, `scroller` and `rememberScroll`. Without them the tab bar is unchanged.
- `frontend/ak-components.css`: the snap and scaled-background rules for the sheet (`.ak-sheet-snaps`, `.ak-sheet-behind`, `html.ak-sheet-scaled`), and `--ak-glass` for `html.eink`. `frontend/ak-tokens.css`: the new token `--ak-glass` for the dark and light schemes and both `data-ak-scheme` values. Existing token values are unchanged.
- `demo/native/`: one phone-sized page with every piece. `?sheet=plain`, `?sheet=snap`, `?screen=detail` and `?skeleton=1` open each state.
- Docs: `docs/native-feel.md` (new), and updates to `README.md`, `docs/service-worker.md` (how `AppKit.swr` and the worker fit together) and `docs/pwa-bars.md`. The push note in `docs/service-worker.md` no longer says v0.6.0.
- Tests: `tests/transition.test.mjs`, `tests/sheet.test.mjs`, `tests/native.test.mjs`, `tests/swr.test.mjs`. `tests/helpers/fake-dom.mjs` gains scrolling, touch and rAF helpers for them.

## 0.5.0 (2026-11-16)

Minor and additive: a service worker script and a manifest helper. Nothing is breaking. No existing name or API changes, and `scripts/sync.sh` works as before. Guide: `docs/service-worker.md`.

- `frontend/ak-sw.js`: `AppKitSW.setup({ version, prefix, shell, networkOnly, runtime, offlineFallback })` for a worker script loaded with `importScripts`. Shell cache `prefix-shell-version` precached with `cache: 'reload'` requests, no `skipWaiting` on install. Fetch: non-GET, cross-origin and `Range` requests and `networkOnly` prefixes (default `/api/`) are not handled. Runtime rules (`cache-first` or `network-first`, own unversioned cache, only status 200 stored) come before the shell logic, which is network-first and only refreshes entries already in the shell cache, with an offline fallback page for navigations. Activate deletes every `prefix-*` cache that is not current, then claims. A `SKIP_WAITING` message calls `skipWaiting`. Based on page-match's worker. No push handlers (planned for v0.6.0).
- `frontend/ak-sw-register.js`: `AppKit.sw.register` (never rejects, `null` when unsupported or failing) with `onUpdate({ registration, apply })` for a waiting worker under an existing controller, and `AppKit.sw.applyUpdate(registration)`, which posts `SKIP_WAITING` and reloads once.
- `scripts/manifest.mjs`: writes `manifest.webmanifest` from a small JSON config (`name`, `color` required, unknown keys are an error). Both manifest colours come from one `color`. It checks that the three fixed icons exist, are PNGs and have the declared size, reports all problems, and writes nothing on failure (exit 1, usage mistakes exit 2). Not synced to apps: run it from a checkout of the tag. No icon generation.
- `demo/sw/`: a runnable demo (`node demo/sw/serve.mjs`) with a version switch to try the update flow, and its generated manifest and icons.
- `docs/service-worker.md` (new), and updates to `README.md` and `docs/pwa-bars.md`.
- Tests: `tests/sw.test.mjs`, `tests/sw-register.test.mjs`, `tests/manifest.test.mjs`.

## 0.4.1 (2026-11-15)

Patch. Additive. Fixes two gaps found while adopting 0.4.0 in free-now. No names or APIs change.

- `healthHandler`: the status variable is typed `200 | 503`, so TypeScript no longer narrows it to literal `200` and fails when an app type-checks the whole `src/` including the kit.
- `AppKit.donate`: the url allowlist now also accepts `www.paypal.me` (https only), so a `https://www.paypal.me/<name>` link renders. Amount chips work for that host the same way. `paypal.me` and `www.paypal.com` are unchanged.

## 0.4.0 (2026-11-15)

Minor and additive: the auth module and a voluntary PayPal donate component. Nothing is breaking. No existing name or API changes, and `scripts/sync.sh` works as before. Design and store contract: `docs/auth.md`.

- `server/auth.ts`: `createAuth(options)` returns one object with `signup`, `rotateCode`, `setEmail`, `verifyEmail`, `loginByCode`, `requestLostCode`, `consumeLostCode`, `startSession`, `userForToken` and `endSession`. The kit owns no schema: the app implements `AuthStore` (14 small methods, atomic only in `takeLink`). Options are checked once and a missing `store`, `limiter`, `linkUrl` or `appName` throws `TypeError`. Link and session tokens are 32 random bytes in base64url and are stored only as their sha256. Verify links last 24 h, lost-code links 20 min.
- `server/auth-code.ts`: `generateRecoveryCode` (`XXXX-XXXX-XXXX`, CSPRNG without modulo bias), `normalizeRecoveryCode`, `hashSecret`, `normalizeEmail`, `needsEmail`.
- `server/mailer.ts`: `resendMailer({ apiKey, from, fetch? })` (a non-2xx answer throws `MailerError` naming only the status), `stubMailer()`, types `Mailer` and `MailMessage`.
- Mandatory email rules: `signup` requires an email (`invalid_email` otherwise) and `setEmail` is how an existing user adds one. `needsEmail(user)` is true for an existing user without an email, and the app blocks everything but the add-email prompt. Recovery by email goes only to verified addresses, and `requestLostCode` answers `{ ok: true }` whatever the address, with the mail sent in the background and failures logged by error name only. "Unique among verified addresses" is the app's unique index: the kit reports `email_taken`.
- Three small gaps from loaner, all additive: `sendJson` with an `undefined` body sends `null`, `readBody(req, maxBytes, { message? })` takes the 413 message, and `healthHandler(req, res, check?)` takes an optional check (a `Promise<boolean>`; a failing check answers `503 {"ok":false}` with nothing leaked). Without a check `healthHandler` is unchanged and synchronous.
- Tests: `tests/server/auth.test.ts`, `auth-code.test.ts`, `mailer.test.ts` (with an in-memory store in `tests/server/auth-memory-store.ts`), and new cases in `http.test.ts`, `health.test.ts` and `index.test.ts`.
- `consumeLostCode` rotates the recovery code by default and returns the new code once as `recoveryCode`. Apps that want the old code to keep working pass `rotateOnLostCode: false`. This is not a break against 0.3.0.
- `frontend/ak-donate.js`: `AppKit.donate.button({ url, label })` (an `ak-btn`, default label "Donate") and `AppKit.donate.show({ url, appName, text, amounts })`, a voluntary tip sheet on `AppKit.sheet`. It has a grabber head, a short note (default English with `appName`, or `text`), optional amount chips and a "Donate with PayPal" link. Everything is built with `AppKit.h`, so text is never parsed as HTML. Load after `ak-dom.js` and `ak-sheet.js`; it throws a clear error if either is missing.
- URL rule: `url` must be `https:` and the host must be exactly `paypal.me` or `www.paypal.com`. Anything else throws a `TypeError`.
- Amounts: `amounts` is a non-empty array of positive finite numbers. A chip links to the url with one trailing slash stripped, plus `/{amount}EUR`. EUR is fixed.
- It only links out (`target="_blank"`, `rel="noopener noreferrer"`). No payments, no PayPal SDK, no tracking, no network calls.
- `ak-components.css`: `.ak-donate-amounts` (wrapping chip row) and `.ak-donate-note`. No new colours. `.ak-chip` now sets `text-decoration: none`, so amount chips used as links have no underline.
- `demo/index.html`: loads the design CSS and the sheet helpers, and has a Donate section with a fake `https://paypal.me/appkitdemo` link.
- Tests: `tests/donate.test.mjs`. `tests/helpers/fake-dom.mjs` now gives the sandbox a `URL`.

## 0.3.0 (2026-11-15)

Minor and additive: "platform primitives". Nothing from 0.2.x changes its name or API. `scripts/sync.sh <tag> <dest-dir>` works as before.

- `server/`: new TypeScript modules for the two TypeScript apps. `node:` built-ins only, no `package.json`, no dependencies, plain `.ts` on Node type stripping (Node >= 22.18 or 24, erasable syntax only, relative imports end in `.ts`). No router and no app wrapper: the apps keep their own route tables. `server/index.ts` re-exports everything, `server/README.md` lists the exports.
  - `rate-limit.ts`: `createRateLimiter` from Hangry. Fixed window, `hit`, `resetIn`, `size`, bounded by `maxKeys` (default 10,000) with pruning. The clock is the `now` argument.
  - `client-key.ts`: `clientKey(req)`, the rightmost `X-Forwarded-For` hop (the Railway rule), else the socket address, else `"unknown"`. Takes any `{ headers, socket }`. Several header lines are read as one list.
  - `time.ts`: `isoDate`, `addDays`, `isCalendarDate`, `daysBetween`, `isTimeZone`, `assertTimeZone`, `zonedParts`, `zonedDateTime` (first instant on fall-back, RFC 5545 gap rule), `endOfDay`. The label formatters (`shortDate`, `dayLabel`, `clockLabel`, `noticeDay`) are left out on purpose.
  - `http.ts`: `HttpError` (status, message, optional code), `SECURITY_HEADERS`, `sendJson`, `sendEmpty`, a capped `readBody` that drains an oversize body without keeping it and rejects with 413, `readJson` (per-call `max`, default 16 KiB, 400 on invalid JSON), `errorBody` and `sendError` (unknown errors are `500 {"error":"internal error"}`, nothing leaked).
  - `csp.ts`: `buildCsp(directives)`, a parameterised Content-Security-Policy with strict defaults. It throws on `;`, `,`, whitespace and control characters. It has no built-in CDN list.
  - `static.ts`: `serveStatic(root, options)`. GET and HEAD, rejects `..`, NUL and malformed encoding, stays inside the real root (symlinks and prefix siblings too), SPA fallback to `index.html`, common content types, configurable cache-control.
  - `health.ts`: `healthHandler`, `isHealthRequest`. `GET`/`HEAD /api/health` is `200 {"ok":true}`, other methods are 405, other paths are not handled.
  - `shutdown.ts`: `installGracefulShutdown`, modelled on loaner's `server.ts`. `server.close`, `closeIdleConnections`, an unref'd force-exit timer (8 s), a one-shot `onClose`. Signals, exit, timers and logging can be injected. Returns `{ shutdown, dispose }`.
- `frontend/ak-whats-new.js`: `AppKit.whatsNew` helpers `validId`, `normalizeEntries`, `latestId`, `unseenEntries`, `formatEntryDate` and `newerSeen`. Pure, no DOM. An empty seen id gives every entry, an unknown seen id gives none.
- `docs/whats-new.md`: the changelog entry schema (`id`, ISO `date`, `title`, `bullets`, newest first, unique ids), the seen-id rules, and how Extrablatt's `{ releases }` / `highlights` / `changes` / human-date format maps to it. Extrablatt's `unseenSince` returns only the latest release, which differs from `unseenEntries`.
- `docs/java-conventions.md`: the Java-side spec for the limiter, the client key, `/api/health`, the error JSON and the security headers. Extrablatt's `RateLimiter` and `ClientIpResolver` already match; Actuator health stays at `/actuator/health`.
- `scripts/sync.sh --server <tag> <dest-dir>`: copies `server/` instead of `frontend/` (for example into `src/app-kit`), with its own `VERSION` file, the same safety rules, and a clear error when the tag has no `server/`. The usage `scripts/sync.sh <tag> <dest-dir>` is unchanged.
- `README.md`: a "Server modules (TS)" section with a wired-together example, the sync commands for TS apps, and the `allowImportingTsExtensions` note.
- Tests: `tests/server/*.test.ts` (rate limiter, client key, time with Hangry's DST cases, HTTP on a real `node:http` server, CSP, static, health, shutdown, and a check that `server/` uses only `node:` imports and erasable syntax), `tests/whats-new.test.mjs`, and `--server` cases in `tests/sync.test.mjs`. `scripts/check.sh` now also runs `tests/server/*.test.ts`.

## 0.2.1 (2026-11-15)

Patch. Additive. Fixes gaps found while adopting 0.2.0. No names or APIs change.

- Sheet z-order: `.ak-sheet-layer` now has its own `z-index` (40), so an open sheet paints above the tab bar (20) and its Done / Send taps are no longer eaten. The toast (60) stays on top. New tokens `--ak-z-tabbar`, `--ak-z-sheet-layer`, `--ak-z-scrim`, `--ak-z-sheet`, `--ak-z-toast`. Apps can drop their own `.ak-sheet-layer { z-index: 31 }` workaround.
- Light contrast: `--ak-muted` `#8e8e93` -> `#636366` (3.26:1 on white, now 5.99:1), `--ak-danger` `#ff3b30` -> `#c0281f` (3.55:1, now 5.89:1). Both reach 4.5:1 on every light surface token.
- Dark contrast: `--ak-muted` `#8e8e93` -> `#a6a6aa` and `--ak-danger` `#ff453a` -> `#ff7f77`, so muted and danger text reach 4.5:1 on `--ak-surface-3` too. This is also what makes the error toast text pass on `--ak-surface-2` in both schemes, so no toast-only colour was needed.
- Dark accent: `--ak-accent` `#ff2d78` -> `#e3166b` and `--ak-accent-strong` `#e0115f` -> `#c40e52`, so white accent ink reaches 4.5:1 (it was 3.56:1). Still Hangry pink. `--ak-accent-2` is unchanged. The install prompt's dark fallback colour follows.
- `AppKit.tabbar`: the badge now has `role="img"` and an `aria-label` of `"{text} {badgeLabel}"` for a count, for example `"3 new"` and `"99+ new"`. Custom text such as `"new"` is the label as it is. New option `badgeLabel` (default `'new'`). The label is set on create and refreshed by `update()`. The visible text is unchanged.
- `AppKit.installPrompt`: new option `iosNonSafari: 'open-in-safari' | 'share-steps'`. The default is `'open-in-safari'`, as before. `'share-steps'` shows the Share steps in iOS Chrome, Firefox, Edge and in-app browsers.
- Tests: a WCAG contrast test over the tokens in both schemes (and the toast text), a z-order test for the sheet layer, tab bar and toast, badge aria tests, and `iosNonSafari` tests.

## 0.2.0 (2026-11-15)

Minor and additive. Nothing from 0.1.0 changes its name or API.

- Shared design system, the Hangry look. Each app keeps its own accent and may set its own font (`--ak-accent*`, `--ak-font`).
- `frontend/ak-tokens.css`: `--ak-*` tokens for colour, type, space, radii, chrome and motion. Dark by default, light on a light phone (colours only), and `html[data-ak-scheme="dark|light"]` to force one. Also defines `--ak-safe-*`, same values as `app-kit.css`, and `--ak-ink` / `--ak-line` aliases.
- `frontend/ak-base.css`: an opt-in reset, scoped under `html.ak-base`.
- `frontend/ak-components.css`: class-based components, all `ak-` prefixed, no bare element selectors: buttons, icon button, toggle, chip, pill, badge, cards, card menu, panel, list and row, divider, scrim, sheet, tab bar, screen head, field and input, segment, toast, banner, empty state, avatars, `ak-grad-0` to `ak-grad-13`. Press feel at zero specificity. An `html.eink` layer for e-ink pages.
- JS helpers on `window.AppKit`: `h` and `copyText` (`ak-dom.js`), `sheet.show` (`ak-sheet.js`), `toast` (`ak-toast.js`), `tabbar` (`ak-tabbar.js`), `nav.syncOverlayHistory` (`ak-nav.js`).
- `demo/design.html`: every component, with scheme, accent and e-ink switches. `demo/index.html` links to it.
- `tests/design.test.mjs`: the new helpers, and a lint that fails on a non-`ak-` class or a bare element selector in `ak-components.css`. `tests/helpers/fake-dom.mjs` gained `style`, `remove`, `focus`, a `textContent` setter, comma selectors, timers, key events, and a fake history.
- `install-prompt.css`: the `--ak-ip-*` variables still win, and the class names are unchanged. The final fallbacks are now the Hangry tokens (dark first, light on a light phone) instead of the old paper colours, and the font follows `--ak-font`. A page that loads `ak-tokens.css` gets the new look by default. A page that defines its own `--ak-surface` and friends is unaffected.

## 0.1.0 (2026-11-15)

- `frontend/theme-color.js`: `AppKit.themeColor.start(opts)` keeps one `theme-color` meta equal to the painted page background. It removes media-bound metas, falls back to `body` when `html` is transparent, and re-syncs on colour-scheme changes, extra media queries (`opts.media`), and resize. `opts.skip` takes a function or a selector such as `html.eink`.
- `AppKit.themeColor.toHex(value)` reads `rgb()` and `rgba()` in both comma and space form, including `/ alpha` and `0%`. Fully transparent gives `null`. This fixes the bar sticking on dark with the older comma-only parser.
- `frontend/install-prompt.js` and `install-prompt.css`: `AppKit.installPrompt.init/show/hide`. Variants: iOS Share steps (with an "open in Safari" hint in other iOS browsers), a native Install button from `beforeinstallprompt`, and a generic menu hint.
- Install detection uses only `display-mode: standalone`, `display-mode: fullscreen`, and `navigator.standalone`. No "installed" flag is stored, so an uninstall brings the prompt back.
- Dismissal is per session, or `{ days: n }` in localStorage with an expiry. `shouldShow` hook for apps with an onboarding gate.
- `frontend/app-kit.css`: `--ak-safe-*` variables and the optional `html.ak-status-strip`.
- `frontend/head.html`: copy-paste head snippet with the four `theme-color` metas (dark phone first) and the app metas.
- `docs/pwa-bars.md`: how Android, Chrome, and Firefox treat the bar colours, and manifest caching.
- `scripts/sync.sh <tag> <dest-dir>`: copies a tagged `frontend/` into an app. The repo is private, so apps sync instead of installing from a git tag in CI.
- `demo/index.html`: a phone-sized demo page.
- `scripts/check.sh` now also runs `bash -n`, and the `node --test` tests in `tests/`.
