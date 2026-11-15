import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createEnv } from './helpers/fake-dom.mjs';

function load() {
  var env = createEnv();
  env.load('ak-whats-new.js');
  return env;
}

// The helpers run inside a vm context, so their arrays and objects have another realm's
// prototypes and deepStrictEqual would call them different. wn() hands back host-realm copies
// of the results. raw() gives the helpers as they are, for the tests about identity.
function plain(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function raw() {
  return load().window.AppKit.whatsNew;
}

function wn() {
  var real = raw();
  var wrapped = {};
  Object.keys(real).forEach(function (name) {
    wrapped[name] = function () { return plain(real[name].apply(null, arguments)); };
  });
  return wrapped;
}

function entry(id, extra) {
  return Object.assign({ id: id, date: '2026-11-01', title: 'T ' + id, bullets: ['b ' + id] }, extra || {});
}

function ids(list) {
  return list.map(function (e) { return e.id; });
}

test('only window.AppKit is added to the global scope, with the six helpers', function () {
  var env = createEnv();
  var before = Object.keys(env.window);
  env.load('ak-whats-new.js');
  var added = Object.keys(env.window).filter(function (k) { return before.indexOf(k) < 0; });
  assert.deepEqual(added, ['AppKit']);
  assert.deepEqual(Object.keys(env.window.AppKit.whatsNew).sort(), [
    'formatEntryDate', 'latestId', 'newerSeen', 'normalizeEntries', 'unseenEntries', 'validId'
  ]);
});

test('loading it twice keeps the first copy, and it shares window.AppKit with other helpers', function () {
  var env = createEnv();
  env.load('ak-toast.js');
  env.load('ak-whats-new.js');
  var first = env.window.AppKit.whatsNew;
  env.load('ak-whats-new.js');
  assert.equal(env.window.AppKit.whatsNew, first);
  assert.equal(typeof env.window.AppKit.toast, 'function');
});

test('validId: lowercase letters, digits and dashes, 1 to 64 characters', function () {
  var validId = wn().validId;
  assert.equal(validId('2026-11-14'), true);
  assert.equal(validId('reminders'), true);
  assert.equal(validId('a'), true);
  assert.equal(validId('2026-09-13-licensing'), true);
  assert.equal(validId('a'.repeat(64)), true);
  assert.equal(validId('a'.repeat(65)), false);
  assert.equal(validId(''), false);
  assert.equal(validId('Upper'), false);
  assert.equal(validId('has space'), false);
  assert.equal(validId('under_score'), false);
  assert.equal(validId('dot.dot'), false);
  assert.equal(validId('slash/slash'), false);
  assert.equal(validId('line\nbreak'), false);
  assert.equal(validId('a\n'), false);
  assert.equal(validId('<script>'), false);
  assert.equal(validId('caf\u00e9'), false);
});

test('validId: only strings', function () {
  var validId = wn().validId;
  [null, undefined, 12, true, {}, [], ['a']].forEach(function (v) {
    assert.equal(validId(v), false, String(v));
  });
});

test('normalizeEntries: keeps good entries in order', function () {
  var n = wn().normalizeEntries;
  var out = n([entry('c'), entry('b'), entry('a')]);
  assert.deepEqual(ids(out), ['c', 'b', 'a']);
  assert.deepEqual(out[0], { id: 'c', date: '2026-11-01', title: 'T c', bullets: ['b c'] });
});

test('normalizeEntries: a repeated id keeps the first entry and drops the later ones', function () {
  var n = wn().normalizeEntries;
  var out = n([entry('x', { title: 'first' }), entry('y'), entry('x', { title: 'second' }), entry('x', { title: 'third' })]);
  assert.deepEqual(ids(out), ['x', 'y']);
  assert.equal(out[0].title, 'first');
});

test('normalizeEntries: a dropped invalid entry does not claim its id', function () {
  var n = wn().normalizeEntries;
  var out = n([entry('x', { bullets: [] }), entry('x', { title: 'good' })]);
  assert.deepEqual(ids(out), ['x']);
  assert.equal(out[0].title, 'good');
});

test('normalizeEntries: drops entries with a bad id', function () {
  var n = wn().normalizeEntries;
  var out = n([entry('ok'), entry('Bad Id'), entry(''), entry('x'.repeat(65)), entry(undefined), entry(7)]);
  assert.deepEqual(ids(out), ['ok']);
});

test('normalizeEntries: drops entries with a blank or missing title', function () {
  var n = wn().normalizeEntries;
  var out = n([entry('a', { title: '' }), entry('b', { title: '   ' }), entry('c', { title: null }), entry('d', { title: 5 }), entry('e')]);
  assert.deepEqual(ids(out), ['e']);
});

test('normalizeEntries: drops entries with bad bullets', function () {
  var n = wn().normalizeEntries;
  var out = n([
    entry('a', { bullets: [] }),
    entry('b', { bullets: 'text' }),
    entry('c', { bullets: ['ok', ''] }),
    entry('d', { bullets: ['ok', '  '] }),
    entry('e', { bullets: ['ok', 3] }),
    entry('f', { bullets: null }),
    entry('g', { bullets: ['one', 'two'] })
  ]);
  assert.deepEqual(ids(out), ['g']);
});

test('normalizeEntries: dates must be real ISO calendar days', function () {
  var n = wn().normalizeEntries;
  var out = n([
    entry('good', { date: '2026-11-15' }),
    entry('leap', { date: '2028-02-29' }),
    entry('human', { date: '13 September 2026' }),
    entry('slash', { date: '2026/11/15' }),
    entry('feb30', { date: '2026-02-30' }),
    entry('nonleap', { date: '2026-02-29' }),
    entry('month13', { date: '2026-13-01' }),
    entry('time', { date: '2026-11-15T10:00:00Z' }),
    entry('empty', { date: '' }),
    entry('num', { date: 20261115 }),
    entry('none', { date: undefined })
  ]);
  assert.deepEqual(ids(out), ['good', 'leap']);
});

test('normalizeEntries: junk items and non-arrays give an empty or smaller list, never a throw', function () {
  var n = wn().normalizeEntries;
  assert.deepEqual(n(null), []);
  assert.deepEqual(n(undefined), []);
  assert.deepEqual(n({}), []);
  assert.deepEqual(n('text'), []);
  assert.deepEqual(n({ releases: [entry('a')] }), [], 'a wrapper object is not unwrapped here');
  assert.deepEqual(n([]), []);
  assert.deepEqual(ids(n([null, undefined, 3, 'x', [], entry('ok')])), ['ok']);
});

test('normalizeEntries: returns copies with only the four fields, so edits do not reach the input', function () {
  var n = raw().normalizeEntries;
  var input = [entry('a', { extra: 'drop me', html: '<b>' })];
  var out = n(input);
  assert.deepEqual(Object.keys(out[0]).sort(), ['bullets', 'date', 'id', 'title']);
  out[0].bullets.push('changed');
  out[0].title = 'changed';
  assert.deepEqual(input[0].bullets, ['b a']);
  assert.equal(input[0].title, 'T a');
});

test('latestId: the first entry, or null', function () {
  var latestId = wn().latestId;
  assert.equal(latestId([entry('new'), entry('old')]), 'new');
  assert.equal(latestId([entry('only')]), 'only');
  assert.equal(latestId([]), null);
  assert.equal(latestId(null), null);
  assert.equal(latestId(undefined), null);
  assert.equal(latestId('abc'), null);
  assert.equal(latestId([null]), null);
});

// The seen-id rules. Documented in docs/whats-new.md:
//   empty / missing seen id  -> every entry (nothing has been seen)
//   unknown non-empty seen id -> no entries (a newer build wrote it, or the entry was trimmed)
var LIST = [entry('d'), entry('c'), entry('b'), entry('a')];

test('unseenEntries: every entry newer than the seen id, newest first', function () {
  var unseen = wn().unseenEntries;
  assert.deepEqual(ids(unseen(LIST, 'b')), ['d', 'c']);
  assert.deepEqual(ids(unseen(LIST, 'c')), ['d']);
  assert.deepEqual(ids(unseen(LIST, 'a')), ['d', 'c', 'b']);
});

test('unseenEntries: seen is the newest entry gives nothing', function () {
  assert.deepEqual(wn().unseenEntries(LIST, 'd'), []);
});

test('unseenEntries: an empty, missing or non-string seen id gives ALL entries', function () {
  var unseen = wn().unseenEntries;
  ['', null, undefined, 0, false].forEach(function (seen) {
    assert.deepEqual(ids(unseen(LIST, seen)), ['d', 'c', 'b', 'a'], JSON.stringify(seen));
  });
  assert.deepEqual(ids(unseen(LIST)), ['d', 'c', 'b', 'a']);
});

test('unseenEntries: an unknown non-empty seen id gives NO entries', function () {
  var unseen = wn().unseenEntries;
  assert.deepEqual(unseen(LIST, 'zzz'), []);
  assert.deepEqual(unseen(LIST, 'e'), [], 'an id newer than anything in this build');
  assert.deepEqual(unseen(LIST, 'D'), [], 'ids are compared exactly');
  assert.deepEqual(unseen(LIST, ' d'), []);
});

test('unseenEntries: an empty or invalid list gives nothing whatever the seen id', function () {
  var unseen = wn().unseenEntries;
  assert.deepEqual(unseen([], ''), []);
  assert.deepEqual(unseen([], 'a'), []);
  assert.deepEqual(unseen(null, ''), []);
  assert.deepEqual(unseen(undefined, 'a'), []);
  assert.deepEqual(unseen('abc', ''), []);
});

test('unseenEntries: returns a new array, and does not modify the list', function () {
  var unseen = raw().unseenEntries;
  var all = unseen(LIST, '');
  assert.notEqual(all, LIST);
  all.pop();
  assert.equal(LIST.length, 4);
  var some = unseen(LIST, 'a');
  some.length = 0;
  assert.equal(LIST.length, 4);
});

test('unseenEntries: after the person sees the latest, nothing is unseen', function () {
  var h = wn();
  var seen = h.latestId(LIST);
  assert.deepEqual(h.unseenEntries(LIST, seen), []);
  var grown = [entry('e')].concat(LIST);
  assert.deepEqual(ids(h.unseenEntries(grown, seen)), ['e']);
});

test('formatEntryDate: ISO date to "5 Nov 2026"', function () {
  var f = wn().formatEntryDate;
  assert.equal(f('2026-11-05'), '5 Nov 2026');
  assert.equal(f('2026-01-01'), '1 Jan 2026');
  assert.equal(f('2026-12-31'), '31 Dec 2026');
  assert.equal(f('2028-02-29'), '29 Feb 2028');
});

test('formatEntryDate: invalid input is shown as written, never thrown or NaN', function () {
  var f = wn().formatEntryDate;
  assert.equal(f('2026-02-30'), '2026-02-30');
  assert.equal(f('2026-13-01'), '2026-13-01');
  assert.equal(f('2026-00-10'), '2026-00-10');
  assert.equal(f('13 September 2026'), '13 September 2026');
  assert.equal(f('yesterday'), 'yesterday');
  assert.equal(f('2026-11-5'), '2026-11-5');
  assert.equal(f(''), '');
  assert.equal(f(null), '');
  assert.equal(f(undefined), '');
  assert.equal(f(20261105), '20261105');
});

test('formatEntryDate: a locale uses Intl, the date is not shifted by the local timezone', function () {
  var f = wn().formatEntryDate;
  var de = f('2026-11-05', 'de');
  assert.match(de, /5\.? ?Nov/);
  assert.match(de, /2026/);
  var us = f('2026-01-01', 'en-US');
  assert.match(us, /Jan 1, 2026/);
  assert.match(f('2026-12-31', 'en-GB'), /31 Dec 2026/);
});

test('formatEntryDate: an unknown locale or an invalid one falls back to the English form', function () {
  var f = wn().formatEntryDate;
  assert.equal(f('2026-11-05', 'not a locale!!'), '5 Nov 2026');
  assert.equal(f('2026-11-05', ''), '5 Nov 2026');
  assert.equal(f('nope', 'de'), 'nope');
});

test('newerSeen: of two known ids, the one nearer the top of the list', function () {
  var newer = wn().newerSeen;
  assert.equal(newer('b', 'c', LIST), 'c');
  assert.equal(newer('c', 'b', LIST), 'c');
  assert.equal(newer('d', 'a', LIST), 'd');
  assert.equal(newer('a', 'd', LIST), 'd');
  assert.equal(newer('c', 'c', LIST), 'c');
});

test('newerSeen: an empty id loses to any other, and two empties give null', function () {
  var newer = wn().newerSeen;
  assert.equal(newer('', 'b', LIST), 'b');
  assert.equal(newer('b', '', LIST), 'b');
  assert.equal(newer(null, 'a', LIST), 'a');
  assert.equal(newer('a', undefined, LIST), 'a');
  assert.equal(newer('', '', LIST), null);
  assert.equal(newer(null, undefined, LIST), null);
});

test('newerSeen: an unknown id counts as newer than any known one, the same as unseenEntries', function () {
  var h = wn();
  assert.equal(h.newerSeen('d', 'future', LIST), 'future');
  assert.equal(h.newerSeen('future', 'd', LIST), 'future');
  assert.equal(h.newerSeen('', 'future', LIST), 'future');
  assert.equal(h.newerSeen('future-a', 'future-b', LIST), 'future-a', 'two unknown ids: the first wins');
  // Consistent with unseenEntries: the merged id shows nothing, so the newer side is never replayed.
  assert.deepEqual(h.unseenEntries(LIST, h.newerSeen('d', 'future', LIST)), []);
});

test('newerSeen: with no usable list, known ids cannot be ranked, so the first wins', function () {
  var newer = wn().newerSeen;
  assert.equal(newer('a', 'b', []), 'a');
  assert.equal(newer('a', 'b', null), 'a');
  assert.equal(newer('', 'b', null), 'b');
});

test('the helpers work together on a real-shaped changelog', function () {
  var h = wn();
  var raw = [
    entry('2026-11-14-reminders', { date: '2026-11-14' }),
    entry('2026-11-05', { date: '2026-11-05' }),
    entry('2026-11-05', { title: 'duplicate' }),
    { id: 'broken' }
  ];
  var list = h.normalizeEntries(raw);
  assert.deepEqual(ids(list), ['2026-11-14-reminders', '2026-11-05']);
  assert.equal(h.latestId(list), '2026-11-14-reminders');
  assert.deepEqual(ids(h.unseenEntries(list, '2026-11-05')), ['2026-11-14-reminders']);
  assert.equal(h.formatEntryDate(list[0].date), '14 Nov 2026');
});

test('docs/whats-new.md example entries pass normalizeEntries', function () {
  var doc = fs.readFileSync(new URL('../docs/whats-new.md', import.meta.url), 'utf8');
  var block = /```json\n(\[[\s\S]*?\n\])\n```/.exec(doc);
  assert.ok(block, 'the doc has a JSON example');
  var parsed = JSON.parse(block[1]);
  var list = wn().normalizeEntries(parsed);
  assert.equal(list.length, parsed.length, 'every documented example entry is valid');
  assert.ok(list.length >= 2);
});
