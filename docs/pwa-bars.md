# PWA bars

How the status bar and the system bars of an installed app get their colour,
and what the kit cannot fix.

## What the kit does

- `frontend/head.html` has four `theme-color` metas as the no-JS default.
- `AppKit.themeColor.start()` swaps them for one meta with the colour the page
  really paints, and keeps it in sync with light/dark and width changes.
- `html.ak-status-strip` in `app-kit.css` paints a strip under the status bar
  of an installed app, so scrolling text does not run under the clock.

The glass bars from `ak-native.css` (`docs/native-feel.md`) do not change
this. They set no `background` on `html` or `body`, so `theme-color.js` still
reads the real page colour. `AppKit.sheet` with `scaleBackground` scales the app
root, not `html` or `body`, for the same reason.

## Android bakes in the manifest colours

When a user installs the app, Android bakes the manifest `theme_color` and
`background_color` into the WebAPK. Chrome refreshes them at most once every
24 hours. It only does it when the app is closed, the phone is on wifi, and it
is charging.

So a change to the manifest colours does not show up soon. Users have to
reinstall the app to see it promptly.

Set both manifest colours to the page colour. If the app is dark by default,
use the dark page colour. `scripts/manifest.mjs` writes both manifest colours
from one `color` (see `docs/service-worker.md`).

## Chrome 152 to 155

These versions have bugs with the bar colours. A reported workaround is the
flag `chrome://flags/#web-app-short-edges-cutout-mode`. It is a user setting,
so the kit cannot turn it on.

## Firefox on Android

Firefox on Android paints the system bars in its own colour. It ignores the
`theme-color` meta. See bugzilla 1964220 and 1922023.

It is only fixed behind the "composable toolbar" secret settings. The kit
cannot fix this. Nothing in the page changes it.

## Do not cache the manifest for long

Serve the manifest with one of these:

- `Cache-Control: max-age=0, must-revalidate`
- `Cache-Control: no-cache`

Version the link, `/manifest.webmanifest?v=1`, and bump `v` whenever the file
changes. The new URL is a new cache key, so browsers that kept the old copy
fetch the current one.
