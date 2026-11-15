import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEnv } from './helpers/fake-dom.mjs';

var ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
var BASE = 'https://paypal.me/appkitdemo';
// The kit runs in a vm context, so its TypeError is not this realm's TypeError.
var TYPE_ERROR = { name: 'TypeError' };
var REDUCED = { media: { '(prefers-reduced-motion: reduce)': true } };

function donateEnv(options) {
  var env = createEnv(options);
  ['ak-dom.js', 'ak-sheet.js', 'ak-donate.js'].forEach(function (f) { env.load(f); });
  return env;
}

function open(env, extra) {
  var opts = { url: BASE, appName: 'Loan some' };
  Object.keys(extra || {}).forEach(function (k) { opts[k] = extra[k]; });
  return env.window.AppKit.donate.show(opts);
}

// ---------- URL validation ----------

test('donate: accepts paypal.me and www.paypal.com https urls', function () {
  var env = donateEnv();
  var donate = env.window.AppKit.donate;
  [
    'https://paypal.me/Name',
    'https://PayPal.Me/name',
    'https://www.paypal.me/name',
    'https://WWW.PayPal.Me/name',
    'https://www.paypal.com/donate/?hosted_button_id=x'
  ].forEach(function (url) {
    assert.equal(donate.button({ url: url }).tagName, 'BUTTON', url);
  });
});

test('donate: rejects every other url', function () {
  var env = donateEnv();
  var donate = env.window.AppKit.donate;
  [
    'http://paypal.me/name',
    'http://www.paypal.me/name',
    'https://paypal.com/name',
    'https://example.com/',
    'https://paypal.me.evil.com/name',
    'javascript:alert(1)',
    '',
    '   ',
    'not a url',
    null,
    undefined,
    42,
    { href: BASE }
  ].forEach(function (url) {
    assert.throws(function () { donate.button({ url: url }); }, TYPE_ERROR, String(url));
    assert.throws(function () { donate.show({ url: url, appName: 'x' }); }, TYPE_ERROR, String(url));
  });
  assert.throws(function () { donate.button({}); }, TYPE_ERROR);
  assert.throws(function () { donate.show({ appName: 'x' }); }, TYPE_ERROR);
  assert.equal(env.document.querySelector('.ak-sheet'), null);
});

// ---------- amounts ----------

test('donate: amount chips link to {url}/{amount}EUR with one trailing slash stripped', function () {
  var env = donateEnv();
  open(env, { url: BASE + '/', amounts: [3, 5, 2.5] });
  var chips = env.document.querySelectorAll('.ak-chip');
  assert.deepEqual(chips.map(function (c) { return c.getAttribute('href'); }), [
    'https://paypal.me/appkitdemo/3EUR',
    'https://paypal.me/appkitdemo/5EUR',
    'https://paypal.me/appkitdemo/2.5EUR'
  ]);
  assert.deepEqual(chips.map(function (c) { return c.textContent; }), ['3 \u20AC', '5 \u20AC', '2.5 \u20AC']);
  chips.forEach(function (c) {
    assert.equal(c.tagName, 'A');
    assert.equal(c.getAttribute('target'), '_blank');
    assert.match(c.getAttribute('rel'), /\bnoopener\b/);
    assert.match(c.getAttribute('rel'), /\bnoreferrer\b/);
  });
});

test('donate: amount chips work for www.paypal.me with and without a trailing slash', function () {
  var env = donateEnv();
  open(env, { url: 'https://www.paypal.me/name/', amounts: [5] });
  assert.equal(env.document.querySelector('.ak-chip').getAttribute('href'), 'https://www.paypal.me/name/5EUR');
  assert.equal(env.document.querySelector('.ak-sheet-dock').querySelector('.ak-btn').getAttribute('href'), 'https://www.paypal.me/name/');

  var env2 = donateEnv();
  open(env2, { url: 'https://www.paypal.me/name', amounts: [5] });
  assert.equal(env2.document.querySelector('.ak-chip').getAttribute('href'), 'https://www.paypal.me/name/5EUR');
});

test('donate: a url without a trailing slash gets the same chip link', function () {
  var env = donateEnv();
  open(env, { amounts: [5] });
  assert.equal(env.document.querySelector('.ak-chip').getAttribute('href'), 'https://paypal.me/appkitdemo/5EUR');
});

test('donate: omitting amounts renders no chip', function () {
  var env = donateEnv();
  open(env);
  assert.equal(env.document.querySelector('.ak-chip'), null);
  assert.equal(env.document.querySelector('.ak-donate-amounts'), null);
});

test('donate: bad amounts throw and open no sheet', function () {
  var env = donateEnv();
  [[], 'five', 5, null, [0], [-1], [NaN], [Infinity], ['5'], [3, null], [{}]].forEach(function (amounts) {
    assert.throws(function () { open(env, { amounts: amounts }); }, TYPE_ERROR, JSON.stringify(amounts));
  });
  assert.equal(env.document.querySelector('.ak-sheet'), null);
});

// ---------- text ----------

test('donate: shows the default note with the app name', function () {
  var env = donateEnv();
  open(env);
  assert.equal(
    env.document.querySelector('.ak-donate-note').textContent,
    'Loan some is free. Running the server costs money; if it helps you, a small tip keeps it going. Totally optional.'
  );
});

test('donate: custom text replaces the default note', function () {
  var env = donateEnv();
  open(env, { text: 'Danke fuer deine Unterstuetzung.' });
  assert.equal(env.document.querySelector('.ak-donate-note').textContent, 'Danke fuer deine Unterstuetzung.');
});

test('donate: appName and text with HTML characters stay text', function () {
  var env = donateEnv();
  open(env, { appName: 'Loan some <img>' });
  assert.equal(env.document.querySelector('img'), null);
  assert.ok(env.document.querySelector('.ak-sheet').textContent.indexOf('Loan some <img> is free.') >= 0);

  var env2 = donateEnv();
  open(env2, { text: 'Tip <b>now</b>' });
  assert.equal(env2.document.querySelector('b'), null);
  assert.equal(env2.document.querySelector('.ak-donate-note').textContent, 'Tip <b>now</b>');
});

// ---------- sheet structure ----------

test('donate: the head holds the grabber and is the drag handle', function () {
  var env = donateEnv();
  open(env);
  var head = env.document.querySelector('.ak-sheet-head');
  assert.ok(head);
  assert.ok(head.querySelector('.ak-grabber'));
  assert.ok(head.listeners.pointerdown && head.listeners.pointerdown.length > 0);
});

test('donate: the primary link is an a.ak-btn to the base url that opens a new tab safely', function () {
  var env = donateEnv();
  open(env, { amounts: [5] });
  var link = env.document.querySelector('.ak-sheet-dock').querySelector('.ak-btn');
  assert.equal(link.tagName, 'A');
  assert.match(link.className, /\bak-btn\b/);
  assert.match(link.className, /\bak-btn-accent\b/);
  assert.equal(link.getAttribute('href'), BASE);
  assert.equal(link.getAttribute('target'), '_blank');
  assert.match(link.getAttribute('rel'), /\bnoopener\b/);
  assert.match(link.getAttribute('rel'), /\bnoreferrer\b/);
  assert.equal(link.textContent, 'Donate with PayPal');
});

test('donate: show returns { close }, and a second show while open returns null', function () {
  var env = donateEnv(REDUCED);
  var first = open(env);
  assert.equal(typeof first.close, 'function');
  assert.equal(open(env), null);
  assert.equal(env.document.querySelectorAll('.ak-sheet').length, 1);
  first.close();
  assert.equal(env.document.querySelector('.ak-sheet'), null);
  assert.ok(open(env));
});

test('donate: a blank or missing appName throws', function () {
  var env = donateEnv();
  var donate = env.window.AppKit.donate;
  ['', '   ', null, undefined, 7].forEach(function (appName) {
    assert.throws(function () { donate.show({ url: BASE, appName: appName }); }, TYPE_ERROR, String(appName));
  });
  assert.throws(function () { donate.show({ url: BASE }); }, TYPE_ERROR);
});

// ---------- button ----------

test('donate: button is button.ak-btn with type button and the default label', function () {
  var env = donateEnv();
  var btn = env.window.AppKit.donate.button({ url: BASE });
  assert.equal(btn.tagName, 'BUTTON');
  assert.equal(btn.className, 'ak-btn');
  assert.equal(btn.getAttribute('type'), 'button');
  assert.equal(btn.textContent, 'Donate');
});

test('donate: button takes a custom label, and ignores an empty or non-string one', function () {
  var env = donateEnv();
  var donate = env.window.AppKit.donate;
  assert.equal(donate.button({ url: BASE, label: 'Spenden' }).textContent, 'Spenden');
  assert.equal(donate.button({ url: BASE, label: '' }).textContent, 'Donate');
  assert.equal(donate.button({ url: BASE, label: 5 }).textContent, 'Donate');
});

test('donate: clicking the button does not open a sheet by itself', function () {
  var env = donateEnv();
  var btn = env.window.AppKit.donate.button({ url: BASE });
  env.body.appendChild(btn);
  btn.click();
  assert.equal(env.document.querySelector('.ak-sheet'), null);
  assert.equal(env.document.querySelector('.ak-sheet-layer'), null);
});

// ---------- source and dependencies ----------

test('donate: the source never builds HTML from strings', function () {
  var source = fs.readFileSync(path.join(ROOT, 'frontend', 'ak-donate.js'), 'utf8');
  assert.equal(source.indexOf('innerHTML'), -1);
  assert.equal(source.indexOf('insertAdjacentHTML'), -1);
  assert.equal(source.indexOf('document.write'), -1);
});

test('donate: without AppKit.h or AppKit.sheet it throws an error naming the script', function () {
  var alone = createEnv();
  alone.load('ak-donate.js');
  assert.throws(function () { alone.window.AppKit.donate.button({ url: BASE }); }, /ak-dom\.js/);
  assert.throws(function () { alone.window.AppKit.donate.show({ url: BASE, appName: 'x' }); }, /ak-dom\.js/);

  var noSheet = createEnv();
  noSheet.load('ak-dom.js');
  noSheet.load('ak-donate.js');
  assert.throws(function () { noSheet.window.AppKit.donate.button({ url: BASE }); }, /ak-sheet\.js/);
  assert.throws(function () { noSheet.window.AppKit.donate.show({ url: BASE, appName: 'x' }); }, /ak-sheet\.js/);
});

test('donate: loading twice keeps the first export', function () {
  var env = donateEnv();
  var first = env.window.AppKit.donate;
  env.load('ak-donate.js');
  assert.equal(env.window.AppKit.donate, first);
});
