# Changelog

## 0.2.1 (unreleased)

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
