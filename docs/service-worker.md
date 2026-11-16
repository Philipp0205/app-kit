# Service worker and manifest

The kit ships one reusable service worker script, a page-side helper that reports updates, and a script that writes `manifest.webmanifest`. They replace the hand-written `sw.js` each app kept, with its hand-versioned cache name. The behaviour follows page-match's worker: network-first shell, cache-first vendor files, `/api/` never touched, no automatic `skipWaiting`.

Zero dependencies, plain JS, no build step. Push is not part of this (planned for v0.6.0). Apps add their own `push` and `notificationclick` listeners.

## Adopt it

1. Sync the frontend files (`ak-sw.js` and `ak-sw-register.js` come with them):

        scripts/sync.sh v0.5.0 public/app-kit

2. Write your own tiny `sw.js` in the scope root (`public/sw.js`):

        importScripts('/app-kit/ak-sw.js');
        AppKitSW.setup({
          version: 'v1',
          prefix: 'pm',
          shell: ['/', '/style.css', '/app.js', '/manifest.webmanifest', '/icons/icon-192.png'],
          networkOnly: ['/api/'],
          runtime: [{ match: '/vendor/', cache: 'vendor', strategy: 'cache-first' }],
          offlineFallback: '/',
        });

3. Register it from the page:

        <script src="/app-kit/ak-sw-register.js"></script>
        <script>
          AppKit.sw.register({ url: '/sw.js', scope: '/', onUpdate: function (update) {
            // show your own "update available" UI, and on the user's tap:
            update.apply();
          } });
        </script>

4. Generate the manifest (see "Manifest script" below) and commit it.
5. Put `frontend/head.html` in the page head (it links the manifest). Bump its `?v=` whenever the manifest changes.

Bump `version` in `sw.js` whenever the precached files change. That is the whole release step for the worker.

## `AppKitSW.setup(options)`

Call it synchronously while `sw.js` is first evaluated (browsers only accept event listeners added then). It registers `install`, `activate`, `fetch` and `message` listeners and returns `{ shellCache }`, the name of the shell cache. The script adds only `self.AppKitSW`.

| Option | Default | Meaning |
| --- | --- | --- |
| `version` | required | Non-empty string. Part of the shell cache name. Missing or empty throws `TypeError`. |
| `prefix` | `'ak'` | Letters, digits, `_` and `-` only, else `TypeError`. Every kit cache is named `prefix-...`. |
| `shell` | `[]` | URLs precached on install with `cache.addAll`, as `new Request(url, { cache: 'reload' })` so the HTTP cache is bypassed. If any URL fails, the whole install fails (standard `addAll` behaviour) and the old worker stays in charge. Keep the list to files that really exist. |
| `networkOnly` | `['/api/']` | Pathname prefixes the worker does not handle. The listener returns without `respondWith`, so the browser goes straight to the network: no cache read, no cache write, no stale fallback. |
| `runtime` | `[]` | Rules `{ match, cache, strategy }`. `match`: a pathname-prefix string, a RegExp (tested on the pathname) or a function `(url: URL) => boolean`. `cache`: a short name (same characters as `prefix`), required. `strategy`: `'cache-first'` (default) or `'network-first'`, anything else throws `TypeError`. The first matching rule wins. |
| `offlineFallback` | `'/'` | A navigation that fails offline and is not cached gets this page from the shell cache. It should be one of the `shell` URLs. The kit does not check that. |

## Fetch order

The worker never touches non-GET requests, cross-origin requests or requests with a `Range` header. For the rest, in this order:

1. The pathname starts with a `networkOnly` prefix: not handled.
2. A `runtime` rule matches: its strategy, in its own cache. Only status 200 is stored (never 206, errors or opaque responses).
   - `cache-first`: the cache, else the network and store.
   - `network-first`: the network and store, else the cache.
3. Otherwise the shell logic, network-first. On a 200 response the cache entry is refreshed only when the request is already in the shell cache, so only precached URLs are stored and unknown URLs pass through uncached. On a network failure: the cached match of the request, else for a navigation the `offlineFallback` page, else the network error is rethrown (the browser shows its own offline page).

`event.respondWith` is wrapped in try/catch, so an app listener that already answered the event cannot make the kit's listener throw. The kit never calls `stopImmediatePropagation`.

## Cache names and cleanup

- Shell cache: `prefix-shell-version`, for example `pm-shell-v3`.
- Runtime cache: `prefix-` plus the rule's `cache`, for example `pm-vendor`. It is not versioned, so a large vendor cache survives shell version bumps. An app that wants it versioned puts the version in the `cache` name (`cache: 'vendor-v2'`).

On `activate` the worker deletes every cache whose name starts with `prefix-` and is not the current shell cache or a current runtime cache. Caches of other prefixes are never touched. Then it calls `clients.claim()`, so the very first install controls the page without a reload. This is fixed behaviour, not an option.

**Moving from a hand-written worker.** Set `prefix` to the old name stem. loaner's `loaner-v22` becomes `prefix: 'loaner'`, and the first activation of the new worker removes `loaner-v22` too.

## Updates

The new worker installs next to the old one and waits. The kit does not call `skipWaiting()` on install. An automatic takeover would swap the worker (and its cached files) under a page that loaded the old ones, so a half-old, half-new app is possible. The app decides when to switch.

- `AppKit.sw.register(opts)` returns a Promise of the `ServiceWorkerRegistration`, or `null` when service workers are unsupported or registering fails. It never rejects: the page works without a worker. Defaults: `url: '/sw.js'`, `scope: '/'`. It waits for the window `load` event if the page is still loading.
- `onUpdate(update)` runs when a new worker is installed and waiting while an older worker already controls the page: either `registration.waiting` at registration time, or after `updatefound` once the installing worker reaches `installed`. It does not run on the very first install, and runs at most once per waiting worker. `update` is `{ registration, apply }`.
- `update.apply()` posts `{ type: 'SKIP_WAITING' }` to the waiting worker (`ak-sw.js` calls `self.skipWaiting()` for that message and for nothing else) and reloads the page once on the next `controllerchange`. A guard prevents a reload loop.
- `AppKit.sw.applyUpdate(registration)` is the same action for a registration.

An app may skip `apply()`: the waiting worker takes over when all tabs are closed, on the next visit. The kit has no update banner. Build your own UI in `onUpdate`. `demo/sw/` has a minimal one.

## Server notes

- `sw.js`: `Content-Type: text/javascript`, `Cache-Control: no-cache` (so a new version is seen at once). Serve it from the scope root. The scope of a worker is the directory of its script, unless the response has a `Service-Worker-Allowed` header.
- `manifest.webmanifest`: `Content-Type: application/manifest+json`, and `no-cache` (see `docs/pwa-bars.md`). Bump `?v=` in the `<link rel="manifest">` from `frontend/head.html` whenever it changes.
- Same origin only. The worker handles nothing cross-origin, and `importScripts('/app-kit/ak-sw.js')` must come from the same origin as well.
- `demo/sw/serve.mjs` is a working reference for all of the above.

## What not to cache

- `/api` and anything per user: keep `networkOnly`, which is the default.
- Private feeds. Add their prefix to `networkOnly`.
- Large vendor files (for example OCR data of several MB): not in `shell`, which would block the install. Use a `runtime` rule, so they are fetched on first use and then kept.
- 206 range responses: the worker ignores `Range` requests and never stores a 206.

## Your own listeners

Push is v0.6.0, or app-owned until then: add your own `push` and `notificationclick` listeners in `sw.js`. For a `fetch` listener of your own that should answer first, register it before calling `setup()`. The kit's listener then sees an event that is already answered, and its `respondWith` error is caught.

    importScripts('/app-kit/ak-sw.js');
    self.addEventListener('push', function (event) { /* ... */ });
    AppKitSW.setup({ version: 'v1', prefix: 'loaner', shell: ['/'] });

## Workbox apps skip this

Hangry (free-now) already builds its worker with Workbox on `sw/sw.js` (vite-pwa). It has no `public/sw.js`. The kit worker and Workbox must not both control one scope, so Hangry keeps its Workbox build. It can still load `ak-sw-register.js` for the update UI, but only if its worker handles the `SKIP_WAITING` message.

## Example: page-match

page-match's `spike/web/sw.js` becomes:

    importScripts('/app-kit/ak-sw.js');
    AppKitSW.setup({
      version: 'v1',
      prefix: 'pm',
      shell: ['/', '/style.css', '/app.js', '/manifest.webmanifest', '/icons/icon-192.png'],
      networkOnly: ['/api/'],
      runtime: [{ match: '/vendor/', cache: 'vendor', strategy: 'cache-first' }],
      offlineFallback: '/',
    });

The caches are `pm-shell-v1` and `pm-vendor`, as before. The shell stays network-first, `/vendor/*` is cache-first and filled on first use, and a navigation offline falls back to the cached `/`.

## Manifest script

`scripts/manifest.mjs` writes `manifest.webmanifest` from a small config. Node built-ins only. Apps do not sync it (`sync.sh` copies only `frontend/` and `server/`). Run it from a checkout of the tag, and commit the generated manifest:

    git clone --depth 1 --branch v0.5.0 https://github.com/Philipp0205/app-kit /tmp/app-kit
    node /tmp/app-kit/scripts/manifest.mjs manifest.config.json [--out public/manifest.webmanifest]

Config (JSON, app-owned):

    { "name": "page match", "short_name": "page match", "description": "...", "lang": "en",
      "color": "#fafaf7", "start_url": "/", "scope": "/", "publicDir": "public" }

| Key | Required | Default | Meaning |
| --- | --- | --- | --- |
| `name` | yes | | App name. |
| `color` | yes | | `#rrggbb`, written lowercase. Becomes both `background_color` and `theme_color` (the rule in `docs/pwa-bars.md`: both manifest colours equal the page colour; if the app is dark by default, use the dark page colour). |
| `short_name` | no | `name` | |
| `description` | no | left out | |
| `lang` | no | left out | |
| `start_url` | no | `/` | Its pathname must start with `scope`. |
| `scope` | no | `/` | |
| `publicDir` | no | `public` | Resolved relative to the config file's directory. |

Unknown keys are an error, so a typo does not pass silently. The output has `display: "standalone"` and three fixed icons: `/icons/icon-192.png` (192x192, any), `/icons/icon-512.png` (512x512, any) and `/icons/icon-512-maskable.png` (512x512, maskable). Pretty JSON with 2 spaces and a trailing newline. The default `--out` is `<publicDir>/manifest.webmanifest`.

Before it writes, it checks that each icon exists at `<publicDir>` plus its `src`, is a PNG, and has the declared size (it reads the header bytes only). It reports all problems, one per line on stderr, and writes nothing.

| Exit code | Meaning |
| --- | --- |
| 0 | The manifest was written. |
| 1 | The config or the icons have problems. Nothing was written. |
| 2 | Usage mistake (missing or unreadable config, bad flag). A usage line is printed. |

**Icon generation is not included.** It would need an image library, and the kit has no dependencies. Make the three PNGs with your own tool. The maskable icon needs about 10% padding on each side as a safe zone: keep the art inside the central 80%.
