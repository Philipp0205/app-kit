/*
 * Demo for the v0.6.0 native feel pieces. Serve the repo root and open /demo/native/.
 * URL parameters, so each state can be opened directly:
 *   ?sheet=plain   ?sheet=snap   ?screen=detail   ?skeleton=1 (skeletons stay, no fetch)
 */
(function () {
  'use strict';

  var params = new URLSearchParams(window.location.search);
  var app = document.getElementById('app');
  var content = document.getElementById('tab-content');
  var main = document.getElementById('screen-main');
  var detail = document.getElementById('screen-detail');
  var current = 'home';
  var swipe = null;
  var refreshed = 0;

  function h(tag, attrs, children) {
    var el = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') { el.textContent = attrs[k]; } else { el.setAttribute(k, attrs[k]); }
    });
    (children || []).forEach(function (c) { el.appendChild(c); });
    return el;
  }

  function button(label, onClick, cls) {
    var b = h('button', { 'class': cls || 'ak-btn ak-btn-secondary', type: 'button', text: label });
    b.addEventListener('click', onClick);
    return b;
  }

  function section(title, nodes) {
    return h('div', { 'class': 'demo-section' }, [h('h2', { text: title })].concat(nodes));
  }

  function row(title, sub) {
    var r = h('button', { 'class': 'ak-row ak-pressable', type: 'button' }, [
      h('div', { 'class': 'ak-row-grow' }, [h('p', { 'class': 'ak-row-title', text: title }), h('p', { 'class': 'ak-row-sub', text: sub })])
    ]);
    return r;
  }

  function rows(prefix, count) {
    var list = h('div', { 'class': 'ak-list' });
    for (var i = 1; i <= count; i++) {
      list.appendChild(row(prefix + ' ' + i, 'Row ' + i + ' of ' + count));
    }
    return list;
  }

  // ---------- sheets ----------

  function sheetNode(title, paragraphs) {
    var body = h('div', { 'class': 'ak-sheet-scroll demo-sheet-body' });
    for (var i = 0; i < paragraphs; i++) {
      body.appendChild(h('p', { text: 'Sheet line ' + (i + 1) + '. Drag the handle up and down.' }));
    }
    return h('div', { 'class': 'ak-sheet' }, [
      h('div', { 'class': 'ak-sheet-head' }, [h('div', { 'class': 'ak-grabber' }), h('h2', { 'class': 'ak-row-title', text: title })]),
      body
    ]);
  }

  function openPlain() {
    AppKit.sheet.show(sheetNode('Plain sheet', 4));
  }

  function openSnap() {
    AppKit.sheet.show(sheetNode('Snap sheet', 24), { snaps: [0.5, 1], snap: 0, scaleBackground: app });
  }

  // ---------- screens ----------

  function showDetail(direction) {
    return AppKit.transition.go(function () {
      main.hidden = true;
      detail.hidden = false;
      window.scrollTo(0, 0);
    }, { direction: direction || 'push' }).then(function () {
      if (!swipe) {
        swipe = AppKit.transition.swipeBack({ onBack: back, target: detail, force: true });
      }
    });
  }

  function back() {
    if (swipe) { swipe.destroy(); swipe = null; }
    return AppKit.transition.go(function () {
      detail.hidden = true;
      main.hidden = false;
      detail.style.transform = '';
      bar.update({ active: current });
    }, { direction: 'pop' });
  }

  document.getElementById('btn-back').addEventListener('click', back);

  // ---------- skeleton + swr ----------

  function skeletonRow() {
    return h('div', { 'class': 'demo-skel-row', 'aria-hidden': 'true' }, [
      h('div', { 'class': 'ak-skeleton ak-skeleton-circle' }),
      h('div', { 'class': 'demo-skel-text' }, [
        h('div', { 'class': 'ak-skeleton ak-skeleton-line' }),
        h('div', { 'class': 'ak-skeleton ak-skeleton-line ak-skeleton-short' })
      ])
    ]);
  }

  function fakeFetch() {
    return new Promise(function (resolve) {
      setTimeout(function () {
        resolve([
          { title: 'Loaded item A', sub: 'From the fake fetcher' },
          { title: 'Loaded item B', sub: 'Cached in localStorage' },
          { title: 'Loaded item C', sub: 'Reload: this shows at once' }
        ]);
      }, 1200);
    });
  }

  function fillFeed(feed) {
    feed.setAttribute('aria-busy', 'true');
    feed.textContent = '';
    for (var i = 0; i < 3; i++) { feed.appendChild(skeletonRow()); }
    if (params.get('skeleton') === '1') {
      return Promise.resolve();
    }
    return AppKit.swr('demo-feed', fakeFetch, function (items, info) {
      feed.textContent = '';
      items.forEach(function (it) { feed.appendChild(row(it.title, it.sub + (info.stale ? ' (stale)' : ''))); });
      feed.setAttribute('aria-busy', 'false');
    });
  }

  // ---------- tabs ----------

  function renderHome() {
    var feed = h('div', { 'class': 'ak-list', id: 'feed' });
    var node = h('div', {}, [
      section('Sheets', [
        h('div', { 'class': 'demo-buttons' }, [
          button('Open sheet', openPlain),
          button('Open snap sheet', openSnap),
          button('Push detail', function () { showDetail('push'); }),
          button('Light / dark', toggleScheme)
        ]),
        h('p', { 'class': 'demo-note', text: 'Pull the list down to refresh. Tap the active tab to scroll to the top.' })
      ]),
      section('Skeleton, then swr', [feed]),
      section('List', [rows('Item', 30)])
    ]);
    content.textContent = '';
    content.appendChild(node);
    fillFeed(feed);
  }

  function renderLibrary() {
    content.textContent = '';
    content.appendChild(section('Library', [rows('Library item', 40)]));
  }

  function renderSettings() {
    content.textContent = '';
    content.appendChild(section('Settings', [
      h('div', { 'class': 'demo-buttons' }, [button('Light / dark', toggleScheme)]),
      h('p', { 'class': 'demo-note', text: 'Each tab keeps its own scroll position (rememberScroll).' }),
      rows('Setting', 30)
    ]));
  }

  var renderers = { home: renderHome, library: renderLibrary, settings: renderSettings };

  function toggleScheme() {
    var root = document.documentElement;
    var dark = root.getAttribute('data-ak-scheme') === 'dark' ||
      (!root.getAttribute('data-ak-scheme') && window.matchMedia('(prefers-color-scheme: dark)').matches);
    root.setAttribute('data-ak-scheme', dark ? 'light' : 'dark');
  }

  var bar = AppKit.tabbar({
    tabs: [
      { id: 'home', label: 'Home', icon: 'H' },
      { id: 'library', label: 'Library', icon: 'L' },
      { id: 'settings', label: 'Settings', icon: 'S' }
    ],
    active: 'home',
    rememberScroll: true,
    scrollTopOnReselect: true,
    onSelect: function (id) {
      if (id === current) { return; }
      current = id;
      renderers[id]();
      bar.update({ active: id });
    }
  });
  document.getElementById('tabbar-host').appendChild(bar.el);

  // ---------- native feel ----------

  AppKit.largeTitle(document.getElementById('large-title'));

  AppKit.pullToRefresh({
    onRefresh: function () {
      return new Promise(function (resolve) {
        setTimeout(function () {
          refreshed += 1;
          var note = document.querySelector('.demo-note');
          if (note) { note.textContent = 'Refreshed ' + refreshed + ' time(s).'; }
          resolve();
        }, 900);
      });
    }
  });

  renderHome();

  if (params.get('screen') === 'detail') { showDetail('none'); }
  if (params.get('sheet') === 'snap') { openSnap(); }
  if (params.get('sheet') === 'plain') { openPlain(); }
})();
