import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

var ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
var SYNC = path.join(ROOT, 'scripts', 'sync.sh');

// Each test gets a scratch dir with a fake gh and git first on PATH, so nothing touches the network.
function scratch(options) {
  var o = options || {};
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-sync-'));
  var bin = path.join(dir, 'bin');
  var tree = path.join(dir, 'kit-tree');
  fs.mkdirSync(bin);
  fs.mkdirSync(path.join(tree, 'frontend'), { recursive: true });
  fs.writeFileSync(path.join(tree, 'frontend', 'a.js'), 'a1\n');
  fs.mkdirSync(path.join(tree, 'frontend', 'sub'));
  fs.writeFileSync(path.join(tree, 'frontend', 'sub', 'b.css'), 'b1\n');

  // The tarball has one top-level directory, like GitHub's.
  var top = path.join(dir, 'owner-app-kit-abc123');
  var tarball = path.join(dir, 'kit.tar.gz');
  function pack() {
    fs.rmSync(top, { recursive: true, force: true });
    fs.cpSync(tree, top, { recursive: true });
    var r = spawnSync('tar', ['-czf', tarball, '-C', dir, 'owner-app-kit-abc123']);
    assert.equal(r.status, 0);
  }
  pack();

  var log = path.join(dir, 'calls.log');
  var ghAuth = o.ghLoggedIn === false ? 'exit 1' : 'exit 0';
  if (!o.noGh) {
    fs.writeFileSync(path.join(bin, 'gh'), [
      '#!/usr/bin/env bash',
      'echo "gh $*" >>"' + log + '"',
      'if [ "$1" = auth ]; then ' + ghAuth + '; fi',
      'if [ "$1" = api ]; then',
      '  if [ "$2" = "repos/Philipp0205/app-kit/tarball/v9.9.9" ]; then cat "' + tarball + '"; exit 0; fi',
      '  echo "Not Found" >&2; exit 1',
      'fi',
      'exit 1', ''
    ].join('\n'), { mode: 0o755 });
  }
  var gitBody = o.gitWorks
    ? 'dest="${!#}"; cp -R "' + tree + '/." "$dest"; exit 0'
    : 'echo "fatal: no network in tests" >&2; exit 128';
  fs.writeFileSync(path.join(bin, 'git'), [
    '#!/usr/bin/env bash',
    'echo "git $*" >>"' + log + '"',
    gitBody, ''
  ].join('\n'), { mode: 0o755 });

  return {
    dir: dir,
    tree: tree,
    pack: pack,
    dest: path.join(dir, 'app', 'public', 'app-kit'),
    calls: function () { return fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : ''; },
    run: function (args) {
      return spawnSync('bash', [SYNC].concat(args), {
        encoding: 'utf8',
        env: { PATH: bin + ':/usr/bin:/bin', HOME: dir, TMPDIR: dir }
      });
    },
    cleanup: function () { fs.rmSync(dir, { recursive: true, force: true }); }
  };
}

test('sync copies frontend/ into dest and writes VERSION with the tag only', function () {
  var s = scratch();
  try {
    var r = s.run(['v9.9.9', s.dest]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(fs.readFileSync(path.join(s.dest, 'a.js'), 'utf8'), 'a1\n');
    assert.equal(fs.readFileSync(path.join(s.dest, 'sub', 'b.css'), 'utf8'), 'b1\n');
    assert.equal(fs.readFileSync(path.join(s.dest, 'VERSION'), 'utf8'), 'v9.9.9');
    assert.match(s.calls(), /gh api repos\/Philipp0205\/app-kit\/tarball\/v9\.9\.9/);
    assert.equal(/git clone/.test(s.calls()), false);
  } finally { s.cleanup(); }
});

test('sync removes stale kit files but keeps VERSION, and is idempotent', function () {
  var s = scratch();
  try {
    assert.equal(s.run(['v9.9.9', s.dest]).status, 0);
    fs.writeFileSync(path.join(s.dest, 'old.js'), 'stale');
    fs.mkdirSync(path.join(s.dest, 'gone'));
    fs.writeFileSync(path.join(s.dest, 'gone', 'x.css'), 'stale');
    assert.equal(s.run(['v9.9.9', s.dest]).status, 0);
    assert.equal(fs.existsSync(path.join(s.dest, 'old.js')), false);
    assert.equal(fs.existsSync(path.join(s.dest, 'gone')), false);
    assert.equal(fs.existsSync(path.join(s.dest, 'a.js')), true);
    assert.equal(fs.readFileSync(path.join(s.dest, 'VERSION'), 'utf8'), 'v9.9.9');
    var listing = fs.readdirSync(s.dest).sort();
    assert.deepEqual(listing, ['VERSION', 'a.js', 'sub']);
  } finally { s.cleanup(); }
});

test('sync picks up changed and removed files from the new tag', function () {
  var s = scratch();
  try {
    assert.equal(s.run(['v9.9.9', s.dest]).status, 0);
    fs.writeFileSync(path.join(s.tree, 'frontend', 'a.js'), 'a2\n');
    fs.rmSync(path.join(s.tree, 'frontend', 'sub'), { recursive: true });
    s.pack();
    assert.equal(s.run(['v9.9.9', s.dest]).status, 0);
    assert.equal(fs.readFileSync(path.join(s.dest, 'a.js'), 'utf8'), 'a2\n');
    assert.equal(fs.existsSync(path.join(s.dest, 'sub')), false);
  } finally { s.cleanup(); }
});

test('sync fails with a usage message on wrong arguments', function () {
  var s = scratch();
  try {
    var none = s.run([]);
    assert.notEqual(none.status, 0);
    assert.match(none.stderr, /usage: scripts\/sync\.sh <tag> <dest-dir>/);
    var one = s.run(['v9.9.9']);
    assert.notEqual(one.status, 0);
    var three = s.run(['v9.9.9', s.dest, 'extra']);
    assert.notEqual(three.status, 0);
    var bad = s.run(['--evil', s.dest]);
    assert.notEqual(bad.status, 0);
    assert.equal(s.calls(), '');
    assert.equal(fs.existsSync(s.dest), false);
  } finally { s.cleanup(); }
});

test('sync with gh not logged in falls back to git, and fails clearly if that fails too', function () {
  var s = scratch({ ghLoggedIn: false });
  try {
    var r = s.run(['v9.9.9', s.dest]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /gh is not logged in/);
    assert.match(r.stderr, /gh auth login/);
    assert.match(s.calls(), /git clone --quiet --depth 1 --branch v9\.9\.9/);
    assert.equal(fs.existsSync(s.dest), false);
  } finally { s.cleanup(); }
});

test('sync with gh missing says so and tries git', function (t) {
  var s = scratch({ noGh: true, gitWorks: true });
  try {
    var r = s.run(['v9.9.9', s.dest]);
    if (!/gh is not installed/.test(r.stderr)) {
      // A real gh sits in /usr/bin or /bin on this machine, so gh cannot be hidden.
      t.skip('a real gh is on the minimal PATH');
      return;
    }
    assert.equal(r.status, 0, r.stderr);
    assert.equal(fs.readFileSync(path.join(s.dest, 'VERSION'), 'utf8'), 'v9.9.9');
    assert.equal(fs.readFileSync(path.join(s.dest, 'a.js'), 'utf8'), 'a1\n');
  } finally { s.cleanup(); }
});

test('sync falls back to git clone when gh is logged out and git works', function () {
  var s = scratch({ ghLoggedIn: false, gitWorks: true });
  try {
    var r = s.run(['v9.9.9', s.dest]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(fs.readFileSync(path.join(s.dest, 'a.js'), 'utf8'), 'a1\n');
    assert.equal(fs.readFileSync(path.join(s.dest, 'VERSION'), 'utf8'), 'v9.9.9');
  } finally { s.cleanup(); }
});

test('a failed fetch leaves dest untouched', function () {
  var s = scratch();
  try {
    assert.equal(s.run(['v9.9.9', s.dest]).status, 0);
    fs.writeFileSync(path.join(s.dest, 'keep.js'), 'keep');
    var r = s.run(['v0.0.0', s.dest]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /could not fetch/);
    assert.equal(fs.readFileSync(path.join(s.dest, 'keep.js'), 'utf8'), 'keep');
    assert.equal(fs.readFileSync(path.join(s.dest, 'VERSION'), 'utf8'), 'v9.9.9');
  } finally { s.cleanup(); }
});
