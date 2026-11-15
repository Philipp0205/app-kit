# Changelog

## Unreleased

### 0.1.0

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
