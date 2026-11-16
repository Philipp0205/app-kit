#!/usr/bin/env node
// Writes manifest.webmanifest from a small app-owned JSON config.
//
//   node scripts/manifest.mjs manifest.config.json [--out public/manifest.webmanifest]
//
// Node built-ins only. See docs/service-worker.md for the config keys.
// Exit codes: 0 written, 1 the config or the icons are wrong (nothing written),
// 2 usage mistake.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KEYS = ['name', 'short_name', 'description', 'lang', 'color', 'start_url', 'scope', 'publicDir'];
const USAGE = 'usage: node scripts/manifest.mjs <config.json> [--out <file>]';

const ICONS = [
  { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
  { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
  { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
];

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function fail(problems) {
  const error = new Error(problems.join('\n'));
  error.problems = problems;
  return error;
}

// Returns the manifest object for a config. Throws an Error with .problems.
export function buildManifest(config) {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    throw fail(['config must be a JSON object']);
  }
  const problems = [];
  for (const key of Object.keys(config)) {
    if (!KEYS.includes(key)) problems.push(`unknown key "${key}"`);
  }
  for (const key of KEYS) {
    if (config[key] !== undefined && typeof config[key] !== 'string') {
      problems.push(`"${key}" must be a string`);
    }
  }
  if (typeof config.name !== 'string' || config.name === '') problems.push('"name" is required');
  if (typeof config.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(config.color)) {
    problems.push('"color" is required and must be #rrggbb');
  }
  const startUrl = config.start_url ?? '/';
  const scope = config.scope ?? '/';
  if (typeof startUrl === 'string' && typeof scope === 'string') {
    let pathname = null;
    try {
      pathname = new URL(startUrl, 'http://localhost').pathname;
    } catch {
      problems.push('"start_url" is not a valid URL');
    }
    if (pathname !== null && !pathname.startsWith(scope)) {
      problems.push(`"start_url" (${startUrl}) is not inside "scope" (${scope})`);
    }
  }
  if (problems.length > 0) throw fail(problems);

  const color = config.color.toLowerCase();
  const manifest = {
    name: config.name,
    short_name: config.short_name ?? config.name,
  };
  if (config.description !== undefined) manifest.description = config.description;
  if (config.lang !== undefined) manifest.lang = config.lang;
  manifest.start_url = startUrl;
  manifest.scope = scope;
  manifest.display = 'standalone';
  manifest.background_color = color;
  manifest.theme_color = color;
  manifest.icons = ICONS.map((icon) => ({ ...icon }));
  return manifest;
}

// Reads width and height from the IHDR chunk. Returns { width, height } or null
// when the buffer is not a PNG.
export function readPngSize(buffer) {
  if (!buffer || buffer.length < 24) return null;
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (buffer[i] !== PNG_SIGNATURE[i]) return null;
  }
  if (buffer.toString('latin1', 12, 16) !== 'IHDR') return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

// Checks every icon of the manifest. Returns a list of problems (empty is ok).
export function validateIcons(manifest, publicDir) {
  const problems = [];
  for (const icon of manifest.icons) {
    const file = path.join(publicDir, icon.src);
    let header;
    try {
      const fd = fs.openSync(file, 'r');
      try {
        header = Buffer.alloc(24);
        const read = fs.readSync(fd, header, 0, 24, 0);
        header = header.subarray(0, read);
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      problems.push(`${icon.src}: file not found at ${file}`);
      continue;
    }
    const size = readPngSize(header);
    if (!size) {
      problems.push(`${icon.src}: not a PNG`);
      continue;
    }
    const [width, height] = icon.sizes.split('x').map(Number);
    if (size.width !== width || size.height !== height) {
      problems.push(`${icon.src}: is ${size.width}x${size.height}, expected ${icon.sizes}`);
    }
  }
  return problems;
}

function usage(message) {
  if (message) process.stderr.write(`${message}\n`);
  process.stderr.write(`${USAGE}\n`);
  return 2;
}

export function main(argv) {
  let configPath = null;
  let out = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--out') {
      out = argv[++i];
      if (!out) return usage('--out needs a file');
    } else if (arg.startsWith('-')) {
      return usage(`unknown flag ${arg}`);
    } else if (configPath === null) {
      configPath = arg;
    } else {
      return usage(`unexpected argument ${arg}`);
    }
  }
  if (configPath === null) return usage('missing config file');

  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (error) {
    return usage(`cannot read ${configPath}: ${error.message}`);
  }

  try {
    const manifest = buildManifest(config);
    const publicDir = path.resolve(path.dirname(configPath), config.publicDir ?? 'public');
    const problems = validateIcons(manifest, publicDir);
    if (problems.length > 0) throw fail(problems);
    const target = out ?? path.join(publicDir, 'manifest.webmanifest');
    fs.mkdirSync(path.dirname(path.resolve(target)), { recursive: true });
    fs.writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`);
    process.stdout.write(`wrote ${target}\n`);
    return 0;
  } catch (error) {
    if (!error.problems) throw error;
    process.stderr.write(`${error.problems.join('\n')}\n`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
