import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildManifest, readPngSize, validateIcons } from '../scripts/manifest.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'scripts', 'manifest.mjs');
const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Signature + IHDR chunk only. The header reader needs nothing more.
function pngHeader(width, height) {
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write('IHDR', 4, 'latin1');
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);
  ihdr[16] = 8;
  ihdr[17] = 2;
  return Buffer.concat([SIGNATURE, ihdr]);
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ak-manifest-'));
}

function writeIcons(publicDir, overrides) {
  const sizes = {
    'icon-192.png': 192,
    'icon-512.png': 512,
    'icon-512-maskable.png': 512,
    ...(overrides || {}),
  };
  fs.mkdirSync(path.join(publicDir, 'icons'), { recursive: true });
  for (const [name, size] of Object.entries(sizes)) {
    if (size === null) continue;
    fs.writeFileSync(path.join(publicDir, 'icons', name), Buffer.isBuffer(size) ? size : pngHeader(size, size));
  }
}

function problemsOf(fn) {
  try {
    fn();
  } catch (error) {
    return error.problems;
  }
  assert.fail('expected an error');
}

const MIN = { name: 'page match', color: '#FAFAF7' };

// ---------- buildManifest ----------

test('build: defaults', function () {
  const m = buildManifest(MIN);
  assert.equal(m.name, 'page match');
  assert.equal(m.short_name, 'page match');
  assert.equal(m.start_url, '/');
  assert.equal(m.scope, '/');
  assert.equal(m.display, 'standalone');
  assert.equal('description' in m, false);
  assert.equal('lang' in m, false);
  assert.deepEqual(m.icons, [
    { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ]);
});

test('build: overrides', function () {
  const m = buildManifest({
    name: 'Loan some', short_name: 'Loaner', description: 'Lend things', lang: 'de',
    color: '#0F1C1F', start_url: '/app/', scope: '/app/', publicDir: 'static',
  });
  assert.equal(m.name, 'Loan some');
  assert.equal(m.short_name, 'Loaner');
  assert.equal(m.description, 'Lend things');
  assert.equal(m.lang, 'de');
  assert.equal(m.start_url, '/app/');
  assert.equal(m.scope, '/app/');
  assert.equal('publicDir' in m, false);
});

test('build: both colours equal the lowercased colour', function () {
  const m = buildManifest(MIN);
  assert.equal(m.background_color, '#fafaf7');
  assert.equal(m.theme_color, '#fafaf7');
});

test('build: name and colour are required', function () {
  assert.match(problemsOf(() => buildManifest({ color: '#000000' })).join('\n'), /"name" is required/);
  assert.match(problemsOf(() => buildManifest({ name: 'x' })).join('\n'), /"color"/);
  assert.match(problemsOf(() => buildManifest({ name: '', color: '#000000' })).join('\n'), /"name"/);
});

test('build: a bad colour is an error', function () {
  ['#fff', 'fafaf7', '#gggggg', '#fafaf7ff', 'red', 5].forEach((color) => {
    assert.match(problemsOf(() => buildManifest({ name: 'x', color })).join('\n'), /"color"/, String(color));
  });
});

test('build: an unknown key is an error', function () {
  const problems = problemsOf(() => buildManifest({ ...MIN, short_nane: 'typo', display: 'browser' }));
  assert.deepEqual(problems, ['unknown key "short_nane"', 'unknown key "display"']);
});

test('build: start_url outside scope is an error', function () {
  assert.match(problemsOf(() => buildManifest({ ...MIN, start_url: '/other/', scope: '/app/' })).join('\n'), /start_url/);
  assert.match(problemsOf(() => buildManifest({ ...MIN, start_url: '/', scope: '/app/' })).join('\n'), /start_url/);
  assert.doesNotThrow(() => buildManifest({ ...MIN, start_url: '/app/?from=home', scope: '/app/' }));
});

test('build: all problems are reported together', function () {
  const problems = problemsOf(() => buildManifest({ color: 'x', extra: 1, start_url: '/a', scope: '/b' }));
  assert.equal(problems.length, 4);
});

test('build: a config that is not an object is an error', function () {
  assert.ok(problemsOf(() => buildManifest(null)).length > 0);
  assert.ok(problemsOf(() => buildManifest([])).length > 0);
});

// ---------- readPngSize ----------

test('readPngSize reads width and height from the header', function () {
  assert.deepEqual(readPngSize(pngHeader(192, 192)), { width: 192, height: 192 });
  assert.deepEqual(readPngSize(pngHeader(512, 256)), { width: 512, height: 256 });
});

test('readPngSize returns null for anything that is not a PNG', function () {
  assert.equal(readPngSize(Buffer.from('GIF89a............................')), null);
  assert.equal(readPngSize(Buffer.alloc(0)), null);
  assert.equal(readPngSize(SIGNATURE), null);
  const noIhdr = pngHeader(1, 1);
  noIhdr.write('IDAT', 12, 'latin1');
  assert.equal(readPngSize(noIhdr), null);
});

// ---------- validateIcons ----------

test('validateIcons: ok on correct fixtures', function () {
  const dir = tempDir();
  writeIcons(dir);
  assert.deepEqual(validateIcons(buildManifest(MIN), dir), []);
});

test('validateIcons: a missing file, a wrong size and a non-PNG are reported together', function () {
  const dir = tempDir();
  writeIcons(dir, { 'icon-192.png': null, 'icon-512.png': 256, 'icon-512-maskable.png': Buffer.from('not a png at all, just text') });
  const problems = validateIcons(buildManifest(MIN), dir);
  assert.equal(problems.length, 3);
  assert.match(problems[0], /icon-192\.png.*not found/);
  assert.match(problems[1], /icon-512\.png.*256x256.*512x512/);
  assert.match(problems[2], /icon-512-maskable\.png.*not a PNG/);
});

test('validateIcons: width and height both have to match', function () {
  const dir = tempDir();
  writeIcons(dir, { 'icon-512.png': pngHeader(512, 500) });
  const problems = validateIcons(buildManifest(MIN), dir);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /512x500/);
});

// ---------- CLI ----------

function cli(args, cwd) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8' });
}

test('cli: writes the manifest to <publicDir>/manifest.webmanifest', function () {
  const dir = tempDir();
  writeIcons(path.join(dir, 'public'));
  fs.writeFileSync(path.join(dir, 'manifest.config.json'), JSON.stringify(MIN));
  const r = cli(['manifest.config.json'], dir);
  assert.equal(r.status, 0, r.stderr);
  const text = fs.readFileSync(path.join(dir, 'public', 'manifest.webmanifest'), 'utf8');
  assert.ok(text.endsWith('}\n'));
  assert.ok(text.startsWith('{\n  "name"'), 'two space indent');
  assert.deepEqual(JSON.parse(text), buildManifest(MIN));
});

test('cli: publicDir is relative to the config file, --out overrides the target', function () {
  const dir = tempDir();
  fs.mkdirSync(path.join(dir, 'conf'));
  writeIcons(path.join(dir, 'conf', 'static'));
  fs.writeFileSync(path.join(dir, 'conf', 'app.json'), JSON.stringify({ ...MIN, publicDir: 'static' }));
  const out = path.join(dir, 'build', 'm.webmanifest');
  const r = cli(['conf/app.json', '--out', out], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(fs.readFileSync(out, 'utf8')).name, 'page match');
  assert.equal(fs.existsSync(path.join(dir, 'conf', 'static', 'manifest.webmanifest')), false);
});

test('cli: a problem exits 1, prints one per line and writes nothing', function () {
  const dir = tempDir();
  writeIcons(path.join(dir, 'public'), { 'icon-192.png': null, 'icon-512.png': 100 });
  fs.writeFileSync(path.join(dir, 'manifest.config.json'), JSON.stringify(MIN));
  const r = cli(['manifest.config.json'], dir);
  assert.equal(r.status, 1);
  assert.equal(r.stderr.trim().split('\n').length, 2);
  assert.equal(fs.existsSync(path.join(dir, 'public', 'manifest.webmanifest')), false);
});

test('cli: a config error exits 1 and writes nothing', function () {
  const dir = tempDir();
  writeIcons(path.join(dir, 'public'));
  fs.writeFileSync(path.join(dir, 'manifest.config.json'), JSON.stringify({ ...MIN, typo: 1 }));
  const r = cli(['manifest.config.json'], dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unknown key "typo"/);
  assert.equal(fs.existsSync(path.join(dir, 'public', 'manifest.webmanifest')), false);
});

test('cli: usage mistakes exit 2 with a usage line', function () {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'broken.json'), '{ nope');
  [[], ['missing.json'], ['broken.json'], ['--bogus'], ['a.json', 'b.json'], ['a.json', '--out']].forEach((args) => {
    const r = cli(args, dir);
    assert.equal(r.status, 2, args.join(' '));
    assert.match(r.stderr, /usage: node scripts\/manifest\.mjs/);
  });
});

test('the demo manifest is what the script makes from the demo config', function () {
  const demo = path.join(ROOT, 'demo', 'sw');
  const config = JSON.parse(fs.readFileSync(path.join(demo, 'manifest.config.json'), 'utf8'));
  const onDisk = JSON.parse(fs.readFileSync(path.join(demo, 'manifest.webmanifest'), 'utf8'));
  assert.deepEqual(onDisk, buildManifest(config));
  assert.deepEqual(validateIcons(onDisk, demo), []);
});
