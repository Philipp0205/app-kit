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

Each script is a plain IIFE and adds only `window.AppKit`. See `docs/pwa-bars.md` for how the bars work and what the kit cannot fix. Open `demo/index.html` for a demo page.

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
- Text: `title`, `text`, `installLabel`, `closeLabel`, `iosShareStep`, `iosAddStep`, `iosSafariHint`, `genericHint`.
- `show()` forces the banner even if it was closed. It never shows when the app is installed.
- `hide()` closes the banner and records it as set by `dismiss`.

## Checks

`scripts/check.sh` runs `node --check` on `frontend/*.js`, `bash -n` and `shellcheck` (if installed) on `scripts/*.sh`, and the tests in `tests/` with `node --test`.
