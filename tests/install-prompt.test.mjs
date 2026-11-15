import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEnv } from './helpers/fake-dom.mjs';

var IPHONE_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
var IPHONE_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/124.0 Mobile/15E148 Safari/604.1';
var IPHONE_FIREFOX = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/124.0 Mobile/15E148 Safari/605.1.15';
var IPHONE_EDGE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) EdgiOS/124.0 Mobile/15E148 Safari/605.1.15';
var IPAD_DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';

var STANDALONE = '(display-mode: standalone)';
var FULLSCREEN = '(display-mode: fullscreen)';
var DAY = 24 * 60 * 60 * 1000;

function loaded(options) {
  var env = createEnv(options);
  env.load('install-prompt.js');
  return env;
}

function banner(env) {
  return env.document.getElementById('ak-install-prompt');
}

function fakeInstallEvent(outcome, options) {
  var o = options || {};
  var event = {
    defaultPrevented: false,
    prompted: 0,
    preventDefault: function () { event.defaultPrevented = true; },
    prompt: function () {
      event.prompted++;
      if (o.throws) throw new Error('refused');
      return Promise.resolve();
    },
    userChoice: Promise.resolve({ outcome: outcome })
  };
  return event;
}

function tick() {
  return new Promise(function (resolve) { setTimeout(resolve, 0); });
}

test('only window.AppKit is added to the global scope', function () {
  var env = createEnv();
  var before = Object.keys(env.window);
  env.load('install-prompt.js');
  var added = Object.keys(env.window).filter(function (k) { return before.indexOf(k) < 0; });
  assert.deepEqual(added, ['AppKit']);
  assert.deepEqual(Object.keys(env.window.AppKit.installPrompt).sort(), ['hide', 'init', 'isInstalled', 'show']);
});

test('init shows the banner at the top of body, in the flow', function () {
  var env = loaded();
  var existing = env.document.createElement('main');
  env.body.appendChild(existing);
  env.window.AppKit.installPrompt.init({ appName: 'Hangry' });
  var node = banner(env);
  assert.ok(node);
  assert.equal(env.body.firstChild, node);
  assert.equal(node.getAttribute('role'), 'region');
  assert.equal(node.getAttribute('aria-label'), 'Install Hangry');
  assert.equal(node.className, 'ak-ip');
});

test('init twice leaves one banner', function () {
  var env = loaded();
  env.window.AppKit.installPrompt.init({});
  env.window.AppKit.installPrompt.init({});
  assert.equal(env.body.querySelectorAll('#ak-install-prompt').length, 1);
  assert.equal(env.windowHandlerCount('beforeinstallprompt'), 1);
});

test('default texts mention the app name, with a generic fallback', function () {
  var env = loaded();
  env.window.AppKit.installPrompt.init({});
  assert.match(banner(env).textContent, /Install this app/);
  assert.match(banner(env).textContent, /Open your browser menu and choose Install or Add to Home screen\./);
  var named = loaded();
  named.window.AppKit.installPrompt.init({ appName: 'Loan some' });
  assert.match(banner(named).textContent, /Install Loan some/);
});

test('iconUrl adds the img, and omitting it leaves it out', function () {
  var env = loaded();
  env.window.AppKit.installPrompt.init({ iconUrl: '/icons/icon-192.png' });
  var img = banner(env).querySelector('img.ak-ip-mark');
  assert.equal(img.getAttribute('src'), '/icons/icon-192.png');
  assert.equal(img.getAttribute('alt'), '');
  var plain = loaded();
  plain.window.AppKit.installPrompt.init({});
  assert.equal(plain.document.querySelector('img'), null);
});

test('mount option decides where the banner goes', function () {
  var env = loaded();
  var holder = env.document.createElement('div');
  env.body.appendChild(holder);
  env.window.AppKit.installPrompt.init({ mount: holder });
  assert.equal(banner(env).parentNode, holder);
});

test('close button has an aria-label and hides the banner', function () {
  var env = loaded();
  env.window.AppKit.installPrompt.init({ closeLabel: 'Later' });
  var close = banner(env).querySelector('button.ak-ip-close');
  assert.equal(close.getAttribute('aria-label'), 'Later');
  close.click();
  assert.equal(banner(env), null);
});

test('text overrides are used', function () {
  var env = loaded({ userAgent: IPHONE_SAFARI });
  env.window.AppKit.installPrompt.init({
    title: 'T', text: 'X', iosShareStep: 'Press share', iosAddStep: 'Press add'
  });
  var content = banner(env).textContent;
  assert.match(content, /^TX/);
  assert.match(content, /Press share/);
  assert.match(content, /Press add/);
});

/* ---------- Variants ---------- */

test('ios in Safari: numbered Share steps with an inline svg icon and sr-only text', function () {
  var env = loaded({ userAgent: IPHONE_SAFARI });
  env.window.AppKit.installPrompt.init({ appName: 'Hangry' });
  var node = banner(env);
  assert.equal(node.getAttribute('data-variant'), 'ios');
  var steps = node.querySelector('ol.ak-ip-steps');
  assert.equal(steps.children.length, 2);
  assert.match(steps.children[0].textContent, /Tap Share/);
  assert.match(steps.children[1].textContent, /Add to Home Screen/);
  var share = steps.querySelector('.ak-ip-share');
  assert.match(share.innerHTML, /<svg/);
  assert.match(steps.querySelector('.ak-ip-sr').textContent, /square with an arrow/);
  assert.equal(node.querySelector('.ak-ip-hint'), null);
});

test('ios outside Safari shows the open-in-Safari hint, not the steps', function () {
  [IPHONE_CHROME, IPHONE_FIREFOX, IPHONE_EDGE].forEach(function (ua) {
    var env = loaded({ userAgent: ua });
    env.window.AppKit.installPrompt.init({ appName: 'Hangry' });
    var node = banner(env);
    assert.equal(node.getAttribute('data-variant'), 'ios');
    assert.equal(node.querySelector('ol'), null);
    assert.equal(node.querySelector('.ak-ip-hint').textContent, 'Open this page in Safari to install Hangry.');
  });
});

function assertSteps(node) {
  assert.equal(node.getAttribute('data-variant'), 'ios');
  var steps = node.querySelector('ol.ak-ip-steps');
  assert.ok(steps);
  assert.equal(steps.children.length, 2);
  assert.match(steps.children[0].textContent, /Tap Share/);
  assert.match(steps.children[1].textContent, /Add to Home Screen/);
  assert.equal(node.querySelector('.ak-ip-hint'), null);
}

function assertHint(node) {
  assert.equal(node.getAttribute('data-variant'), 'ios');
  assert.equal(node.querySelector('ol'), null);
  assert.equal(node.querySelector('.ak-ip-hint').textContent, 'Open this page in Safari to install Hangry.');
}

test('iosNonSafari: default and open-in-safari keep the hint in iPhone Chrome', function () {
  [{}, { iosNonSafari: 'open-in-safari' }].forEach(function (extra) {
    var env = loaded({ userAgent: IPHONE_CHROME });
    env.window.AppKit.installPrompt.init(Object.assign({ appName: 'Hangry' }, extra));
    assertHint(banner(env));
  });
});

test('iosNonSafari: an unknown value falls back to the hint', function () {
  var env = loaded({ userAgent: IPHONE_CHROME });
  env.window.AppKit.installPrompt.init({ appName: 'Hangry', iosNonSafari: 'nope' });
  assertHint(banner(env));
});

test('iosNonSafari: share-steps shows the steps, not the hint, in iPhone Chrome, Firefox and Edge', function () {
  [IPHONE_CHROME, IPHONE_FIREFOX, IPHONE_EDGE].forEach(function (ua) {
    var env = loaded({ userAgent: ua });
    env.window.AppKit.installPrompt.init({ appName: 'Hangry', iosNonSafari: 'share-steps' });
    var node = banner(env);
    assertSteps(node);
    assert.match(node.querySelector('.ak-ip-share').innerHTML, /<svg/);
    assert.doesNotMatch(node.textContent, /Open this page in Safari/);
  });
});

test('iosNonSafari: Safari shows the steps with either value', function () {
  [{}, { iosNonSafari: 'open-in-safari' }, { iosNonSafari: 'share-steps' }].forEach(function (extra) {
    var env = loaded({ userAgent: IPHONE_SAFARI });
    env.window.AppKit.installPrompt.init(Object.assign({ appName: 'Hangry' }, extra));
    assertSteps(banner(env));
  });
});

test('iosNonSafari: does not change the generic variant on a non-iOS browser', function () {
  var env = loaded();
  env.window.AppKit.installPrompt.init({ iosNonSafari: 'share-steps' });
  assert.equal(banner(env).getAttribute('data-variant'), 'generic');
  assert.equal(banner(env).querySelector('ol'), null);
});

test('iosSafariHint can be overridden', function () {
  var env = loaded({ userAgent: IPHONE_CHROME });
  env.window.AppKit.installPrompt.init({ iosSafariHint: 'Use Safari please' });
  assert.equal(banner(env).querySelector('.ak-ip-hint').textContent, 'Use Safari please');
});

test('an iPad that sends a Mac user agent is ios', function () {
  var env = loaded({ userAgent: IPAD_DESKTOP_UA, maxTouchPoints: 5 });
  env.window.AppKit.installPrompt.init({});
  assert.equal(banner(env).getAttribute('data-variant'), 'ios');
  var mac = loaded({ userAgent: IPAD_DESKTOP_UA, maxTouchPoints: 0 });
  mac.window.AppKit.installPrompt.init({});
  assert.equal(banner(mac).getAttribute('data-variant'), 'generic');
});

test('generic variant shows the browser menu hint', function () {
  var env = loaded();
  env.window.AppKit.installPrompt.init({ genericHint: 'Use the menu' });
  var node = banner(env);
  assert.equal(node.getAttribute('data-variant'), 'generic');
  assert.equal(node.querySelector('.ak-ip-hint').textContent, 'Use the menu');
  assert.equal(node.querySelector('.ak-ip-install'), null);
});

test('beforeinstallprompt is prevented, kept, and switches to the install variant', function () {
  var env = loaded();
  env.window.AppKit.installPrompt.init({ installLabel: 'Get it' });
  assert.equal(banner(env).getAttribute('data-variant'), 'generic');
  var event = fakeInstallEvent('accepted');
  env.fireWindow('beforeinstallprompt', event);
  assert.equal(event.defaultPrevented, true);
  var node = banner(env);
  assert.equal(node.getAttribute('data-variant'), 'install');
  assert.equal(node.querySelector('button.ak-ip-install').textContent, 'Get it');
  assert.equal(node.querySelector('.ak-ip-hint'), null);
});

test('an event that fired before init is still used', function () {
  var env = loaded();
  var event = fakeInstallEvent('accepted');
  env.fireWindow('beforeinstallprompt', event);
  assert.equal(event.defaultPrevented, true);
  assert.equal(banner(env), null);
  env.window.AppKit.installPrompt.init({});
  assert.equal(banner(env).getAttribute('data-variant'), 'install');
});

test('install button calls prompt and hides the banner when accepted', async function () {
  var env = loaded();
  env.window.AppKit.installPrompt.init({});
  var event = fakeInstallEvent('accepted');
  env.fireWindow('beforeinstallprompt', event);
  banner(env).querySelector('button.ak-ip-install').click();
  assert.equal(event.prompted, 1);
  await tick();
  assert.equal(banner(env), null);
});

test('install button falls back to the generic hint when declined', async function () {
  var env = loaded();
  env.window.AppKit.installPrompt.init({});
  var event = fakeInstallEvent('dismissed');
  env.fireWindow('beforeinstallprompt', event);
  banner(env).querySelector('button.ak-ip-install').click();
  await tick();
  var node = banner(env);
  assert.ok(node);
  assert.equal(node.getAttribute('data-variant'), 'generic');
  assert.equal(node.querySelector('button.ak-ip-install'), null);
  assert.ok(node.querySelector('.ak-ip-hint'));
});

test('install button falls back to the generic hint when prompt throws', async function () {
  var env = loaded();
  env.window.AppKit.installPrompt.init({});
  env.fireWindow('beforeinstallprompt', fakeInstallEvent('accepted', { throws: true }));
  banner(env).querySelector('button.ak-ip-install').click();
  await tick();
  assert.equal(banner(env).getAttribute('data-variant'), 'generic');
});

test('appinstalled hides the banner, and it stays hidden', function () {
  var env = loaded();
  env.window.AppKit.installPrompt.init({});
  assert.ok(banner(env));
  env.fireWindow('appinstalled');
  assert.equal(banner(env), null);
  env.window.AppKit.installPrompt.init({});
  assert.equal(banner(env), null);
  env.window.AppKit.installPrompt.show();
  assert.equal(banner(env), null);
});

/* ---------- Installed detection ---------- */

test('standalone display mode hides the banner', function () {
  var env = loaded({ media: { [STANDALONE]: true } });
  env.window.AppKit.installPrompt.init({});
  assert.equal(banner(env), null);
  assert.equal(env.window.AppKit.installPrompt.isInstalled(), true);
});

test('fullscreen display mode hides the banner', function () {
  var env = loaded({ media: { [FULLSCREEN]: true } });
  env.window.AppKit.installPrompt.init({});
  assert.equal(banner(env), null);
  assert.equal(env.window.AppKit.installPrompt.isInstalled(), true);
});

test('navigator.standalone === true hides the banner', function () {
  var env = loaded({ userAgent: IPHONE_SAFARI, standalone: true });
  env.window.AppKit.installPrompt.init({});
  assert.equal(banner(env), null);
  assert.equal(env.window.AppKit.installPrompt.isInstalled(), true);
});

test('navigator.standalone === false is not installed', function () {
  var env = loaded({ userAgent: IPHONE_SAFARI, standalone: false });
  env.window.AppKit.installPrompt.init({});
  assert.ok(banner(env));
  assert.equal(env.window.AppKit.installPrompt.isInstalled(), false);
});

test('a browser tab (display-mode: browser) is not installed', function () {
  var env = loaded({ media: { '(display-mode: browser)': true } });
  assert.equal(env.window.AppKit.installPrompt.isInstalled(), false);
});

test('without matchMedia it is simply not installed', function () {
  var env = loaded({ noMatchMedia: true });
  env.window.AppKit.installPrompt.init({});
  assert.ok(banner(env));
});

test('show does not force the banner when installed', function () {
  var env = loaded({ media: { [STANDALONE]: true } });
  env.window.AppKit.installPrompt.init({});
  env.window.AppKit.installPrompt.show();
  assert.equal(banner(env), null);
});

test('nothing named installed is written to localStorage or sessionStorage', function () {
  var env = loaded({ media: { [STANDALONE]: true } });
  env.window.AppKit.installPrompt.init({ dismiss: { days: 3 } });
  env.fireWindow('appinstalled');
  assert.equal(env.window.localStorage.length, 0);
  assert.equal(env.window.sessionStorage.length, 0);
  var tab = loaded();
  tab.window.AppKit.installPrompt.init({ dismiss: { days: 3 } });
  tab.fireWindow('beforeinstallprompt', fakeInstallEvent('accepted'));
  tab.fireWindow('appinstalled');
  assert.equal(tab.window.localStorage.length, 0);
  assert.equal(tab.window.sessionStorage.length, 0);
});

test('an uninstall brings the prompt back: no stored installed flag', function () {
  var env = loaded();
  env.window.AppKit.installPrompt.init({});
  env.fireWindow('appinstalled');
  // A new page load in the browser (the app was uninstalled): storage is the only thing that survives.
  var again = createEnv();
  again.window.localStorage = env.window.localStorage;
  again.window.sessionStorage = env.window.sessionStorage;
  again.load('install-prompt.js');
  again.window.AppKit.installPrompt.init({});
  assert.ok(banner(again));
});

/* ---------- Dismissal ---------- */

test('dismiss defaults to session storage under the default key', function () {
  var env = loaded();
  env.window.AppKit.installPrompt.init({});
  env.window.AppKit.installPrompt.hide();
  assert.equal(banner(env), null);
  assert.equal(env.window.sessionStorage.getItem('ak-install-prompt-dismissed'), '1');
  assert.equal(env.window.localStorage.length, 0);
});

test('session dismissal survives a reload in the same session', function () {
  var env = loaded();
  env.window.AppKit.installPrompt.init({});
  banner(env).querySelector('button.ak-ip-close').click();
  var again = createEnv();
  again.window.sessionStorage = env.window.sessionStorage;
  again.load('install-prompt.js');
  again.window.AppKit.installPrompt.init({});
  assert.equal(banner(again), null);
});

test('a new session (empty sessionStorage) shows the banner again', function () {
  var env = loaded();
  env.window.AppKit.installPrompt.init({});
  env.window.AppKit.installPrompt.hide();
  var fresh = loaded();
  fresh.window.AppKit.installPrompt.init({});
  assert.ok(banner(fresh));
});

test('storageKey option is used', function () {
  var env = loaded();
  env.window.AppKit.installPrompt.init({ storageKey: 'my-key' });
  env.window.AppKit.installPrompt.hide();
  assert.equal(env.window.sessionStorage.getItem('my-key'), '1');
  assert.equal(env.window.sessionStorage.getItem('ak-install-prompt-dismissed'), null);
});

test('dismiss { days } writes an expiry timestamp to localStorage', function () {
  var env = loaded();
  env.window.AppKit.installPrompt.init({ dismiss: { days: 7 } });
  var before = Date.now();
  env.window.AppKit.installPrompt.hide();
  var until = Number(env.window.localStorage.getItem('ak-install-prompt-dismissed'));
  assert.ok(until >= before + 7 * DAY - 1000 && until <= Date.now() + 7 * DAY + 1000);
  assert.equal(env.window.sessionStorage.length, 0);
});

test('dismiss { days } keeps the banner away until the expiry', function () {
  var storage = createEnv().window.localStorage;
  storage.setItem('ak-install-prompt-dismissed', String(Date.now() + DAY));
  var env = createEnv();
  env.window.localStorage = storage;
  env.load('install-prompt.js');
  env.window.AppKit.installPrompt.init({ dismiss: { days: 7 } });
  assert.equal(banner(env), null);
});

test('dismiss { days } shows the banner again after the expiry and clears the key', function () {
  var storage = createEnv().window.localStorage;
  storage.setItem('ak-install-prompt-dismissed', String(Date.now() - 1000));
  var env = createEnv();
  env.window.localStorage = storage;
  env.load('install-prompt.js');
  env.window.AppKit.installPrompt.init({ dismiss: { days: 7 } });
  assert.ok(banner(env));
  assert.equal(storage.getItem('ak-install-prompt-dismissed'), null);
});

test('a garbage stored value does not hide the banner', function () {
  var storage = createEnv().window.localStorage;
  storage.setItem('ak-install-prompt-dismissed', 'yes');
  var env = createEnv();
  env.window.localStorage = storage;
  env.load('install-prompt.js');
  env.window.AppKit.installPrompt.init({ dismiss: { days: 7 } });
  assert.ok(banner(env));
});

test('blocked storage does not throw, and the banner is still hidden on this page', function () {
  var env = loaded();
  var blocked = {
    getItem: function () { throw new Error('blocked'); },
    setItem: function () { throw new Error('blocked'); },
    removeItem: function () { throw new Error('blocked'); }
  };
  env.window.sessionStorage = blocked;
  env.window.localStorage = blocked;
  env.window.AppKit.installPrompt.init({});
  assert.ok(banner(env));
  assert.doesNotThrow(function () { env.window.AppKit.installPrompt.hide(); });
  assert.equal(banner(env), null);
  env.window.AppKit.installPrompt.init({ dismiss: { days: 2 } });
  assert.equal(banner(env), null);
});

test('show forces the banner even when dismissed, and init is not forced', function () {
  var env = loaded();
  env.window.AppKit.installPrompt.init({});
  env.window.AppKit.installPrompt.hide();
  assert.equal(banner(env), null);
  env.window.AppKit.installPrompt.show();
  assert.ok(banner(env));
  env.window.AppKit.installPrompt.hide();
  assert.equal(banner(env), null);
  env.window.AppKit.installPrompt.init({});
  assert.equal(banner(env), null);
});

/* ---------- shouldShow ---------- */

test('shouldShow returning false keeps the banner away', function () {
  var env = loaded();
  env.window.AppKit.installPrompt.init({ shouldShow: function () { return false; } });
  assert.equal(banner(env), null);
});

test('shouldShow returning true or nothing still shows it', function () {
  var env = loaded();
  env.window.AppKit.installPrompt.init({ shouldShow: function () { return true; } });
  assert.ok(banner(env));
  var other = loaded();
  other.window.AppKit.installPrompt.init({ shouldShow: function () {} });
  assert.ok(other.document.getElementById('ak-install-prompt'));
});

test('shouldShow true does not override installed or dismissed', function () {
  var installed = loaded({ media: { [STANDALONE]: true } });
  installed.window.AppKit.installPrompt.init({ shouldShow: function () { return true; } });
  assert.equal(banner(installed), null);
  var env = loaded();
  env.window.AppKit.installPrompt.init({});
  env.window.AppKit.installPrompt.hide();
  env.window.AppKit.installPrompt.init({ shouldShow: function () { return true; } });
  assert.equal(banner(env), null);
});

test('show() forces past a shouldShow that says no', function () {
  var env = loaded();
  env.window.AppKit.installPrompt.init({ shouldShow: function () { return false; } });
  assert.equal(banner(env), null);
  env.window.AppKit.installPrompt.show();
  assert.ok(banner(env));
});

test('a throwing shouldShow does not break init', function () {
  var env = loaded();
  assert.doesNotThrow(function () {
    env.window.AppKit.installPrompt.init({ shouldShow: function () { throw new Error('boom'); } });
  });
});

test('init waits for the body when the script runs in the head', function () {
  var env = createEnv({ bodyless: true });
  env.document.readyState = 'loading';
  env.load('install-prompt.js');
  env.window.AppKit.installPrompt.init({});
  assert.equal(banner(env), null);
  var body = env.document.createElement('body');
  env.html.appendChild(body);
  env.document.body = body;
  env.fireDocument('DOMContentLoaded');
  assert.ok(banner(env));
});
