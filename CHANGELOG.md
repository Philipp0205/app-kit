# Changelog

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
