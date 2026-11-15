# app-kit

Shared frontend helpers for Hangry (free-now), Loan some (loaner), and Extrablatt.

- Plain JS and CSS for PWA install prompts, theme-color, and push. No build step, no runtime dependencies.
- A TypeScript auth module for the two TypeScript apps.
- Shared Playwright behaviour tests.

Apps pin a released git tag, not a branch tip.

## What is in frontend/

| File | What it does |
| --- | --- |
| `theme-color.js` | `AppKit.themeColor`: keeps the browser bar colour equal to the page background. |
| `install-prompt.js`, `install-prompt.css` | `AppKit.installPrompt`: an "install this app" banner (iOS steps, native button, or a menu hint). |
| `app-kit.css` | Safe-area variables (`--ak-safe-top` and friends) and the optional `html.ak-status-strip`. |
| `head.html` | A copy-paste `<head>` snippet: theme-color metas, iOS and Android app metas, manifest link. |
| `ak-tokens.css` | The `--ak-*` design tokens (colour, type, space, radii, motion). Dark default, light on a light phone, `data-ak-scheme` to force one. Also holds the per-app accent and font override points. |
| `ak-base.css` | Optional reset. Does nothing until `<html class="ak-base">`. |
| `ak-components.css` | Class-based components, all prefixed `ak-`, plus the `html.eink` layer. |
| `ak-dom.js` | `AppKit.h` (build elements, text is never parsed as HTML) and `AppKit.copyText`. |
| `ak-sheet.js` | `AppKit.sheet.show`: a bottom sheet with scrim, swipe down, Escape. |
| `ak-toast.js` | `AppKit.toast`: short messages in `#ak-toasts`. |
| `ak-tabbar.js` | `AppKit.tabbar`: a bottom tab bar with badges. No routing. |
| `ak-nav.js` | `AppKit.nav.syncOverlayHistory`: Back closes the top overlay instead of leaving the app. |

Each script is a plain IIFE and adds only `window.AppKit`. See `docs/pwa-bars.md` for how the bars work and what the kit cannot fix. Open `demo/index.html` for a demo page, and `demo/design.html` for the design system.

## Design

The look is Hangry's, shared by all three apps. Each app keeps its own accent colour and may set its own font. This is additive: the v0.1.0 files, classes and variables work as before.

Load order in the page head:

    <link rel="stylesheet" href="/app-kit/ak-tokens.css">
    <link rel="stylesheet" href="/app-kit/ak-base.css">        <!-- optional -->
    <link rel="stylesheet" href="/app-kit/ak-components.css">
    <link rel="stylesheet" href="/app-kit/app-kit.css">

**Tokens.** `ak-tokens.css` defines `--ak-bg`, `--ak-text`, `--ak-muted`, `--ak-surface` (and `-2`, `-3`), `--ak-hairline`, `--ak-danger`, type (`--ak-fs-*`), space (`--ak-s1` to `--ak-s5`), radii (`--ak-radius-*`), chrome (`--ak-tab`, `--ak-phone`) and motion. Dark is the default. On a light phone only the colours change. To force a scheme, set `<html data-ak-scheme="dark">` or `"light"`. That wins over the phone setting. It also defines `--ak-safe-*`, so it works without `app-kit.css`.

**Stacking.** The chrome z-order is a token set: `--ak-z-tabbar` (20) < `--ak-z-sheet-layer` (40) < `--ak-z-toast` (60). Inside the sheet layer the scrim (`--ak-z-scrim`, 30) sits under the sheet (`--ak-z-sheet`, 31). The layer has its own z-index, so an open sheet covers the tab bar. Apps no longer need their own `.ak-sheet-layer { z-index }` rule. Keep any app fixed bars below `--ak-z-sheet-layer`.

**Contrast.** Muted, danger and accent text reach WCAG AA (4.5:1) on the page surfaces in both schemes, and the error toast too. A test checks this.

**Accent and font.** Set these after the kit CSS. Nothing else needs to change:

    :root {
      --ak-accent: #e3166b;         /* main accent */
      --ak-accent-2: #ff4d8d;       /* focus ring */
      --ak-accent-strong: #c40e52;  /* deeper accent */
      --ak-accent-ink: #ffffff;     /* text on an accent fill */
      --ak-font: Inter, system-ui, sans-serif;
      --ak-font-article: Georgia, serif;   /* Extrablatt, for long text */
    }

The defaults are Hangry pink. Light and dark each have their own accent, so an app that supports both sets it twice: in `@media (prefers-color-scheme: light)`, and for `html[data-ak-scheme="dark"]` and `html[data-ak-scheme="light"]` if it forces a scheme. Loan some, for example, sets `--ak-accent`, `--ak-accent-2` and `--ak-accent-strong` to `#00857a` in light and `#2bb3a3` in dark, and `--ak-font` to Inter if it wants it.

**Classes.** Every component class starts with `ak-` (`ak-btn`, `ak-chip`, `ak-sheet`, `ak-tabbar`, `ak-input`, `ak-grad-0` to `ak-grad-13`, and so on). The CSS never styles a bare element, so including it does not change existing markup. The reset in `ak-base.css` only applies once the page adds `ak-base` to `<html>`.

**JS helpers.** Plain scripts, no modules, no build. Load `ak-dom.js` first (the sheet and tab bar do not need it, but the demo and most apps use `AppKit.h` with them):

    <script src="/app-kit/ak-dom.js"></script>
    <script src="/app-kit/ak-sheet.js"></script>
    <script src="/app-kit/ak-toast.js"></script>
    <script src="/app-kit/ak-tabbar.js"></script>
    <script src="/app-kit/ak-nav.js"></script>

- `AppKit.h(tag, attrs, ...children)`: text is always a text node. `AppKit.copyText(text)` returns a Promise of true or false.
- `AppKit.sheet.show(node, { head, onClose, focus })` returns `{ close }`, or `null` if a sheet is already open.
- `AppKit.toast(message, { kind, ms })`. Kind `'error'` uses `role="alert"`.
- `AppKit.tabbar({ tabs, active, onSelect, badge, badgeLabel, label })` returns `{ el, update }`. The kit does no routing. The badge has `role="img"` and an aria-label. A count is named `"{text} {badgeLabel}"`, for example `"3 new"` or `"99+ new"`, and `badgeLabel` defaults to `'new'`. Custom text such as `"new"` is used as the label as it is.
- `AppKit.nav.syncOverlayHistory({ depth, onPop })`: `depth` is a number or a function that returns how many overlays are open. Call it after every render.

**Server pages (Extrablatt Kindle, legal, billing).** Include `ak-tokens.css` and `ak-components.css` only. No JS is needed. Add `class="eink"` to `<html>` for e-ink.

**E-ink.** `html.eink` (in `ak-components.css`) turns the kit greyscale and high contrast. Colours go to black and white, the accent is black, there is no blur, no shadow and no press motion, radii are 4 to 8px, and tap targets are at least 52px.

## Getting the files into an app

This repo is private. Apps copy the files with the sync script instead of installing from a git tag in CI. That keeps a GitHub token out of Railway builds. Run it on your own machine, where `gh` is logged in, and commit the result:

    scripts/sync.sh <tag> <dest-dir>

It fetches the tag with `gh api repos/Philipp0205/app-kit/tarball/<tag>` (or `git clone --depth 1 --branch <tag>` if `gh` is not usable), copies `frontend/` into the destination, and writes `<dest-dir>/VERSION` with the tag. Files that are no longer in the kit are removed. It is safe to run again.

Copy `frontend/head.html` into the page head by hand. It is a snippet, not a file to serve.

## Hangry (free-now)

Static dir: `public/app-kit`.

    scripts/sync.sh v0.1.0 public/app-kit

In the page head and before the end of the body:

    <link rel="stylesheet" href="/app-kit/app-kit.css">
    <link rel="stylesheet" href="/app-kit/install-prompt.css">
    <script src="/app-kit/theme-color.js" defer></script>
    <script src="/app-kit/install-prompt.js" defer></script>

Init, after those scripts have run. Hold the banner back until onboarding is done:

    AppKit.themeColor.start();
    AppKit.installPrompt.init({
      appName: 'Hangry',
      iconUrl: '/icons/icon-192.png',
      dismiss: { days: 3 },
      shouldShow: function () {
        return isOnboarded();   // your own check. Return false while onboarding is open.
      }
    });

`shouldShow` only holds the banner back. It cannot show it when the app is installed or the banner was closed. The kit never stores an "installed" flag, so removing the app brings the prompt back.

## Loan some (loaner)

Static dir: `public/app-kit`.

    scripts/sync.sh v0.1.0 public/app-kit

Tags:

    <link rel="stylesheet" href="/app-kit/app-kit.css">
    <link rel="stylesheet" href="/app-kit/install-prompt.css">
    <script src="/app-kit/theme-color.js"></script>
    <script src="/app-kit/install-prompt.js"></script>

Init, once, when the app starts. The banner is added to `document.body`, so a router that redraws the page does not remove it:

    AppKit.themeColor.start();
    AppKit.installPrompt.init({
      appName: 'Loan some',
      iconUrl: '/icons/icon-192.png'
    });

`theme-color.js` replaces loaner's own `theme-color.js`. It reads both `rgb(15, 28, 31)` and `rgb(15 28 31)`, so the bar no longer sticks on dark.

## Extrablatt

Static dir: `static/app-kit` (a Spring Boot app, so `src/main/resources/static/app-kit`).

    scripts/sync.sh v0.1.0 src/main/resources/static/app-kit

Tags, deferred like the app's other script:

    <link rel="stylesheet" href="/app-kit/app-kit.css">
    <script src="/app-kit/theme-color.js" defer></script>

Init. Extrablatt skips the bar colour on its e-ink layout:

    AppKit.themeColor.start({
      skip: 'html.eink',
      media: ['(max-width: 719px)']
    });

Extrablatt has no install prompt today. To add one, include `install-prompt.css` and `install-prompt.js` and call `AppKit.installPrompt.init({ appName: 'Extrablatt' })` the same way as above.

## API

`AppKit.themeColor.start(opts)`

- `skip`: a function (skip when it returns true) or a selector string such as `'html.eink'`.
- `media`: extra media queries to listen for, for example `['(max-width: 719px)']`. `(prefers-color-scheme: dark)` is always watched.

`AppKit.themeColor.toHex(value)`: turns `rgb()` or `rgba()` (comma or space form) into `'#rrggbb'`. Fully transparent and unknown values give `null`.

`AppKit.installPrompt.init(opts)`, `.show()`, `.hide()`

- `appName` (default `'this app'`), `iconUrl` (optional), `storageKey` (default `'ak-install-prompt-dismissed'`).
- `dismiss`: `'session'` (default) or `{ days: n }`.
- `shouldShow`: a function. Return false to hold the banner back.
- `mount`: the element to prepend to (default `document.body`).
- `iosNonSafari`: `'open-in-safari'` (default) or `'share-steps'`. Other iOS browsers (Chrome, Firefox, Edge, in-app) show the "open in Safari" hint by default. With `'share-steps'` they show the same Share / Add to Home Screen steps as Safari. Safari is unchanged.
- Text: `title`, `text`, `installLabel`, `closeLabel`, `iosShareStep`, `iosAddStep`, `iosSafariHint`, `genericHint`.
- `show()` forces the banner even if it was closed. It never shows when the app is installed.
- `hide()` closes the banner and records it as set by `dismiss`.

## Checks

`scripts/check.sh` runs `node --check` on `frontend/*.js`, `bash -n` and `shellcheck` (if installed) on `scripts/*.sh`, and the tests in `tests/` with `node --test`.
