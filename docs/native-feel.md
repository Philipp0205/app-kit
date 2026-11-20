# Native feel

Optional pieces that make an installed app behave more like a phone app: page transitions, iOS-like sheets, touch feel, a large title, scroll memory, pull to refresh and instant screens. Zero dependencies, plain JS and CSS, no build step. Nothing here is on by default. An app that syncs this version and changes nothing looks and behaves as before.

Demo: serve the repo root (`python3 -m http.server`) and open `/demo/native/`. `?sheet=plain`, `?sheet=snap`, `?screen=detail`, `?skeleton=1`, `?toast=1` and `?menu=1` open each state directly.

## Opt in

| To get | Link | Add |
| --- | --- | --- |
| Touch feel, glass bars, large title, pull to refresh, skeletons, page slide | `ak-native.css` after `ak-components.css` | `class="ak-native"` on `<html>` (skeletons and the navbar need no class) |
| Scroll memory, large title, pull to refresh | `ak-native.js` | |
| Page transitions between screens | `ak-transition.js` | `ak-native.css` for the slide |
| Page transitions between pages (multi-page apps) | `ak-view-transitions.css` on every page | |
| Instant screens | `ak-swr.js` | |
| Sheet snaps, velocity close, scaled background | nothing new, `ak-sheet.js` and `ak-components.css` | options on `AppKit.sheet.show` |
| Tab bar extras | nothing new, `ak-tabbar.js` | options on `AppKit.tabbar` |
| Tab bar motion, popup pop | nothing new, `ak-components.css`, `ak-tabbar.js`, `ak-toast.js`, `ak-dom.js` | automatic on `AppKit.tabbar` and `AppKit.toast`, `.ak-pop` and `AppKit.pop` for your own popups |

`ak-native.css` and `ak-view-transitions.css` are not imported by `app-kit.css` or `ak-components.css`. The app links them itself.

## Page transitions

    AppKit.transition.go(function () { showDetail(); }, { direction: 'push' })
      .then(function () { /* the DOM shows the next screen */ });

- `update`: a function that changes the DOM to the next screen. It may return a Promise.
- `direction`: `'push'` (default), `'pop'` or `'none'`.
- With `document.startViewTransition`, no reduced motion and a direction other than `'none'`, `<html>` gets `data-ak-nav="push"` or `"pop"` while the browser animates, and `update` runs inside the view transition. The attribute is removed when `transition.finished` settles. In every other case `update()` is called directly and nothing animates.
- It returns a Promise that resolves after the DOM update, and rejects if `update` throws or rejects. It never throws synchronously.
- The slide (new screen in from the right, old one to -30% and dimmed, pop is the mirror, 350 ms) is in `ak-native.css`. Without that file the browser's own cross-fade plays. Reduced motion turns the animations off.
- `html.ak-native .ak-tabbar` has `view-transition-name: ak-tabbar`, so the tab bar stays put while the page slides.

### Between pages (multi-page apps)

`ak-view-transitions.css` holds `@view-transition { navigation: auto; }` and a reduced-motion guard. Link it on every page that should take part. It cannot be scoped to a class (an at-rule has no selector), which is why it is its own file.

### Edge swipe back

    var swipe = AppKit.transition.swipeBack({ onBack: function () { goBack(); } });
    swipe.destroy();

| Option | Default | Meaning |
| --- | --- | --- |
| `onBack` | required | Called once when the gesture completes. The kit does no routing. Call `AppKit.transition.go` in it. |
| `edge` | `20` | px from the left edge where a touch must start. |
| `threshold` | `0.35` | Fraction of the viewport width that commits. A flick faster than 0.5 px/ms to the right commits too. |
| `target` | first `.ak-screen`, else `document.body` | The element that follows the finger. A transform on `body` also moves its `position: fixed` children, so give the screen an `.ak-screen` (or pass `target`) and keep the tab bar outside it. |
| `force` | `false` | `true` enables it outside an installed app (demo, tests). |

It only works in an installed app (`display-mode: standalone`, or `navigator.standalone`). In a browser tab it returns a `{ destroy }` that does nothing, because the browser owns the back gesture there. Mostly vertical movement cancels it, and a cancelled drag springs back. With reduced motion the target does not move, but the gesture still calls `onBack`.

## Sheets

`AppKit.sheet.show(node, { head, onClose, focus })` works as before. New, all optional:

- A downward flick faster than 0.5 px/ms on the head (after at least 10 px) closes the sheet, even when the drag is under 72 px.
- `snaps`: heights as fractions of the viewport, for example `[0.5, 1]`. `'half'` and `'full'` are accepted for 0.5 and 1. Values outside 0..1 are dropped, the list is sorted, and no valid value means no snaps.
- `snap`: the index in the sorted list the sheet opens at. Default `0`.
- Dragging the head moves between snaps. On release the sheet rests at the nearest snap, and a flick goes to the next snap in its direction. Dragging more than 72 px below the lowest snap, or a fast flick down from the lowest snap, closes.
- `sheet.snapTo(index)` moves to a snap. It does nothing without snaps. The sheet is laid out at its highest snap and moved with a transform, so below the highest snap the lower content is off screen until the sheet is dragged up.
- `scaleBackground`: an element (the app root) that scales down behind the sheet, iOS style. It gets `ak-sheet-behind` and `<html>` gets `ak-sheet-scaled`. The CSS is in `ak-components.css`. Keep the tab bar and toasts outside that element: a transform makes it the containing block of its `position: fixed` children. With reduced motion it does not scale. The kit never sets `html` or `body` background.
- Sheets slide up on open and down on close (`--ak-duration-sheet`, 220 ms). Closing continues from where the sheet is: after a partial drag, in the middle of the open animation, or at the half snap, it slides down from that offset to off screen with no jump back to rest first. With reduced motion the sheet is removed at once.

## Touch feel

Everything below is under `html.ak-native`.

- Tap highlight off on interactive elements, `touch-action: manipulation` on buttons, links, `[role=button]`, `.ak-tab` and labels (no 300 ms delay, no double-tap zoom).
- `user-select: none` and `-webkit-touch-callout: none` on chrome only: buttons, `.ak-tab`, `.ak-tabbar`, `.ak-navbar`, `.ak-sheet-head`, `.ak-grabber`, `[role=button]`. Never on inputs, text areas, selects, editable elements or general text.
- Instant press state: `:active` on buttons and `[role=button]` goes to opacity 0.6 with no transition, then fades back. `.ak-pressable` dips with a small scale instead. Tab bar items (`.ak-tabbar .ak-tab`) are the exception: they are not dimmed and the button itself does not scale (that would move the tap target). The icon dips to scale 0.9 instead, see "Tab bar motion".
- `ak-native.js` adds one passive `touchstart` no-op listener on `document`. iOS Safari only applies `:active` when the page has a touch listener.
- Bounce: `html.ak-no-bounce` sets `overscroll-behavior: none` on `html` and `body`. `.ak-contain` sets `overscroll-behavior: contain` on a scroller. There is no global rule.

## Tab bar motion

These rules are in `ak-components.css`, so they work without `html.ak-native` too.

- `.ak-tab-icon`: the icon, sized `--ak-tab-icon-size` (26px) in width and height. `AppKit.tabbar` puts the class on every icon: a DOM node keeps its other classes and gets `ak-tab-icon` added, a string is wrapped in `<span class="ak-tab-icon">`, no icon means nothing is added. A string is set as text, so an inline SVG markup string shows up as text, not as an icon. Pass inline SVG icons as DOM nodes (a real SVG element, or one built with `AppKit.h`).
- Press: `.ak-tabbar .ak-tab:active .ak-tab-icon` scales to 0.9 (`--ak-duration-press`, ease-out). It springs back with `--ak-duration` and `--ak-ease-spring`.
- Landing: when `update({ active })` switches to a different tab, the new `.ak-tab` gets `ak-tab-in` until its animation ends. The label colour goes from `--ak-muted` to `--ak-text` (180 ms) and the icon scales 0.86 to 1 (`ak-tab-icon-in`, 220 ms, `--ak-ease-spring`). It is not added on the first render, on an `update` with the same `active` (badge-only or re-render), when the active tab is tapped again, or with reduced motion. There is no option for it.
- `.ak-page-in`: opacity 0 to 1 over 160 ms and nothing else, so scroll and map measurements do not move. The kit never sets it by itself. Put it on the page that was just shown.
- For an app with its own tab bar and pages: `AppKit.tabbar.animateIn(el)` adds `ak-tab-in` and `AppKit.tabbar.animatePage(el)` adds `ak-page-in`, each removed on `animationend` (of the element itself). A second call while the class is on plays again. They work without calling `AppKit.tabbar({...})`, do nothing for a missing element or with reduced motion, and never throw.
- Reduced motion: no tab-in, icon-in or page-in, no press transform and no icon transition.

    var bar = AppKit.tabbar({ tabs: tabs, active: 'home', onSelect: function (id) {
      show(id); bar.update({ active: id }); AppKit.tabbar.animatePage(document.getElementById('page'));
    } });

## Popups

`.ak-pop` pops an element in: opacity 0 to 1 and scale 0.96 to 1, `--ak-pop-duration` (140 ms) with `--ak-pop-ease`, from `transform-origin: 50% 50%` (set another origin on your popup for a menu that opens from a corner). `.ak-pop-out` plays the reverse. Only opacity and transform change, so nothing shifts.

- `AppKit.toast` pops in by itself. After its stay time (`ms`) it pops out and is removed when that ends. The stay time does not include the 140 ms.
- `.ak-card-menu` pops in by itself whenever `hidden` is removed. It cannot pop out through CSS alone, because `[hidden]` is `display: none`.
- `AppKit.pop.in(el)` (in `ak-dom.js`) removes `hidden`, adds `ak-pop` and plays it again if it was already on. `AppKit.pop.out(el)` adds `ak-pop-out`, waits for `animationend` of the element itself (140 ms fallback), then sets `hidden` on an element that had it or on an `.ak-card-menu`, and removes any other element from the DOM. It returns a Promise. Both ignore a missing element and never throw.
- `ak-toast.js` uses `AppKit.pop.out` when `ak-dom.js` is loaded, and does the same by itself when it is not.
- Reduced motion: fade only, no scale. `out` still fades.

    AppKit.pop.in(menu);                    // show
    AppKit.pop.out(menu).then(function () { /* menu is hidden now */ });

## System look

- `html.ak-system-font` sets `--ak-font` and `--ak-font-article` to the system stack (`-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`) and turns on `-webkit-font-smoothing: antialiased`. For apps that override `--ak-font` but want the system font back.
- Dark mode already works: `ak-tokens.css` follows `prefers-color-scheme`, and `data-ak-scheme="dark"` or `"light"` on `<html>` forces one. The new `--ak-glass` token (a 72% page colour) is defined for both, and for e-ink it is solid white.
- Translucent bars: under `html.ak-native` the tab bar is `var(--ak-glass)` with `saturate(180%) blur(20px)`. Without `backdrop-filter` support both bars fall back to an opaque `var(--ak-bg)`. Outside `html.ak-native`, `.ak-tabbar` is unchanged.

### Large title

    <header class="ak-navbar"><span class="ak-navbar-title" aria-hidden="true">Closet</span></header>
    <h1 class="ak-large-title">Closet</h1>

    AppKit.largeTitle(document.querySelector('.ak-large-title'), { navbar, scroller })

`.ak-navbar` is sticky at the top (padding for the safe area) and translucent. Its hairline and small title are hidden until the large title has scrolled under it, then `ak-collapsed` is set and they fade in. `opts.navbar` defaults to the nearest `.ak-navbar` before the title among its siblings, else `document.querySelector('.ak-navbar')`. `opts.scroller` defaults to the window. It uses `IntersectionObserver`, and a passive scroll listener (once per frame) where that is missing. Returns `{ destroy }`.

## Scrolling

- `AppKit.scroll.memory({ el })` returns `{ save(key), restore(key), forget(key) }`. `el` defaults to the page. `save` stores the scroll position in memory and in `sessionStorage` under `ak-scroll:` + key (when storage works). `restore` sets it, `0` for an unknown key, and returns it.
- `AppKit.scroll.toTop(el, { smooth })`: scrolls to 0. Smooth, unless reduced motion or `smooth: false`.
- `AppKit.tabbar` gets, all optional: `onReselect(id)` (the tab that is already active was tapped; `onSelect` is still called for that tap, as before), `scrollTopOnReselect: true` (on the same tap, scroll to the top, with `AppKit.scroll.toTop` if loaded, else by itself), `scroller` (what scrolls, default the window) and `rememberScroll: true`. With `rememberScroll`, a tap on another tab saves the position of the active one, and `update({ active })` restores the position of the new one. Call `update` after you have drawn the new tab. Without these options the tab bar is unchanged.

### Pull to refresh

    var ptr = AppKit.pullToRefresh({ onRefresh: function () { return reload(); } });

| Option | Default | Meaning |
| --- | --- | --- |
| `onRefresh` | required | Returns a Promise or a value. A rejection is not reported: handle errors inside it. |
| `el` | the page | The scroller. |
| `threshold` | `64` | px the finger must pull down. |
| `minMs` | `700` | Least ms the spinner stays once a refresh starts. `0` hides as soon as `onRefresh` settles. Omitted or not a number `>= 0` means `700`. |

A pull starts only when the scroller is at `scrollTop` 0 and the finger moves down more than sideways. The `.ak-ptr` indicator follows with resistance. On release past the threshold it stays, with `ak-ptr-loading`, until `onRefresh` has settled and `minMs` has elapsed, so a fast refresh is not just a flash. The hold also applies when the refresh rejects, throws, or returns a plain value. A second refresh cannot start meanwhile, the hold included. Under reduced motion the hold is kept (a still spinner is not motion), but the hide does not slide or fade. `--ak-ptr-progress` and `--ak-ptr-y` are registered `@property`s in `ak-native.css`, so the hide eases out over 320 ms instead of snapping. While bound, the scroller has `overscroll-behavior-y: contain`, so the browser's own refresh does not also fire. `destroy()` restores it, clears a pending hold and removes the indicator.

## Instant screens

    AppKit.swr('closet', function () { return fetch('/api/closet').then(function (r) { return r.json(); }); },
      function (data, info) { draw(data); },     // info: { stale: true, age } or { stale: false }
      { maxAge: 60000, onError: function (err) { /* optional */ } });

Stale while revalidate, with the cache in `localStorage` under `ak-swr:` + key (`{ t, v }`).

1. With a cached value, `render(value, { stale: true, age })` runs synchronously, before the fetch.
2. `fetcher()` runs. On success the value is stored and `render(value, { stale: false })` runs, unless its JSON equals the cached JSON.
3. On failure `onError(err)` is called if given. With no cache the returned Promise rejects. With a cache it resolves with the cached value.

`maxAge` (ms): a cached value older than that is not rendered, but is still replaced. Concurrent calls with the same key share one fetch. `AppKit.swr.clear(key)` removes one key, `AppKit.swr.clear()` every `ak-swr:` key. A `localStorage` that throws (private mode, quota, bad JSON) just means no cache.

Values must be JSON-serialisable. Nothing user-specific is cleared for you: call `AppKit.swr.clear()` on sign-out.

### With the service worker

`ak-sw.js` leaves `/api/` network-only by default, so API JSON is never cached by the worker, and swr owns the data cache in `localStorage`. The two do not overlap, and swr does not use Cache Storage. Do not add a `runtime` rule for the same API URLs if you want swr's freshness rules. See `docs/service-worker.md`.

### Skeletons

No `html.ak-native` needed, these are explicit classes: `.ak-skeleton` (block), `.ak-skeleton-line` (text-height line, `.ak-skeleton-short` for 60% width), `.ak-skeleton-circle`, `.ak-skeleton-card`. The shimmer stops under reduced motion. Put `aria-hidden="true"` on each skeleton and `aria-busy="true"` on the container that is loading:

    <div aria-busy="true">
      <div class="ak-skeleton ak-skeleton-line" aria-hidden="true"></div>
      <div class="ak-skeleton ak-skeleton-line ak-skeleton-short" aria-hidden="true"></div>
    </div>

## Limits

- No haptics. iOS web has no vibration API, and the kit does not fake it.
- No native controls. These are CSS and JS imitations.
- The edge swipe works only in an installed app. In Safari the browser owns that gesture.
- View Transitions: Safari 18+ and Chrome 111+ for `startViewTransition`. Cross-document transitions: Safari 18.2+ and Chrome 126+. Elsewhere `go` calls `update()` at once, and `ak-view-transitions.css` does nothing.
- `backdrop-filter` is missing in some browsers: the bars fall back to an opaque background.
- Reduced motion: no slide, no sheet or background scale, no shimmer or spinner animation, instant scroll, no tab bar motion, popups fade without scale.
