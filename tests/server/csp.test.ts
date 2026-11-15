import assert from "node:assert/strict";
import test from "node:test";
import { buildCsp, CSP_DEFAULTS } from "../../server/csp.ts";

function directives(csp: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const part of csp.split("; ")) {
    const space = part.indexOf(" ");
    map.set(space < 0 ? part : part.slice(0, space), space < 0 ? "" : part.slice(space + 1));
  }
  return map;
}

test("defaults are strict", () => {
  const d = directives(buildCsp());
  assert.equal(d.get("default-src"), "'self'");
  assert.equal(d.get("object-src"), "'none'");
  assert.equal(d.get("base-uri"), "'self'");
  assert.equal(d.get("frame-ancestors"), "'none'");
  assert.equal(d.size, 4);
});

test("the default header string is exactly the four directives", () => {
  assert.equal(buildCsp(), "default-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
  assert.equal(buildCsp({}), buildCsp());
});

test("per-directive allowlists are added", () => {
  const d = directives(
    buildCsp({
      "script-src": ["'self'", "https://cdn.example.com"],
      "style-src": ["'self'", "'unsafe-inline'"],
      "img-src": ["'self'", "data:", "blob:"],
      "connect-src": ["'self'", "https://api.example.com", "wss://live.example.com"],
      "font-src": ["'self'"],
      "worker-src": ["'self'", "blob:"],
    }),
  );
  assert.equal(d.get("script-src"), "'self' https://cdn.example.com");
  assert.equal(d.get("style-src"), "'self' 'unsafe-inline'");
  assert.equal(d.get("img-src"), "'self' data: blob:");
  assert.equal(d.get("connect-src"), "'self' https://api.example.com wss://live.example.com");
  assert.equal(d.get("font-src"), "'self'");
  assert.equal(d.get("worker-src"), "'self' blob:");
  // The strict defaults are still there.
  assert.equal(d.get("object-src"), "'none'");
});

test("a passed directive replaces its default instead of merging", () => {
  const d = directives(buildCsp({ "default-src": ["'none'"], "frame-ancestors": ["'self'"] }));
  assert.equal(d.get("default-src"), "'none'");
  assert.equal(d.get("frame-ancestors"), "'self'");
});

test("false drops a default, true adds a value-less directive, undefined changes nothing", () => {
  const d = directives(buildCsp({ "frame-ancestors": false, "upgrade-insecure-requests": true, "img-src": undefined }));
  assert.equal(d.has("frame-ancestors"), false);
  assert.equal(d.get("upgrade-insecure-requests"), "");
  assert.equal(d.has("img-src"), false);
  assert.ok(buildCsp({ "upgrade-insecure-requests": true }).endsWith("; upgrade-insecure-requests"));
});

test("the result has no trailing separator and no empty directive", () => {
  const csp = buildCsp({ "script-src": ["'self'"] });
  assert.equal(csp.endsWith(";"), false);
  assert.equal(csp.includes(";;"), false);
  assert.equal(csp.includes("; ;"), false);
});

test("sources that would inject a directive or a second policy are rejected", () => {
  const attacks = [
    "https://a.example.com; script-src *",
    "https://a.example.com;",
    "https://a.example.com, https://b.example.com",
    "'self'\nscript-src *",
    "'self'\r\nx-injected: 1",
    "'self' https://b.example.com",
    "'self'\tx",
    "",
    " ",
    "\u2028script-src *",
    "https://a\u0000.example.com",
  ];
  for (const source of attacks) {
    assert.throws(() => buildCsp({ "script-src": [source] }), /invalid CSP source/, JSON.stringify(source));
  }
});

test("a non-string source is rejected", () => {
  assert.throws(() => buildCsp({ "script-src": [42 as unknown as string] }), /invalid CSP source/);
  assert.throws(() => buildCsp({ "script-src": [null as unknown as string] }), /invalid CSP source/);
});

test("directive names that would inject are rejected", () => {
  for (const name of ["script-src; img-src *", "script src", "Script-Src", "", "a,b", "x\ny", "-lead", "1abc"]) {
    assert.throws(() => buildCsp({ [name]: ["'self'"] }), /invalid CSP directive name/, JSON.stringify(name));
  }
});

test("an empty source list and a non-array value are rejected", () => {
  assert.throws(() => buildCsp({ "img-src": [] }), /no sources/);
  assert.throws(() => buildCsp({ "img-src": "'self'" as unknown as string[] }), /must be an array/);
});

test("one bad value throws even when the others are fine, and nothing partial is returned", () => {
  assert.throws(() => buildCsp({ "img-src": ["'self'"], "script-src": ["x; y"] }));
});

test("the kit hard-codes no third-party hosts", () => {
  const csp = buildCsp();
  assert.equal(/https?:/.test(csp), false);
  assert.equal(Object.values(CSP_DEFAULTS).flat().some((v) => /\./.test(v)), false);
});

test("buildCsp does not mutate its defaults or its input", () => {
  const input = { "script-src": ["'self'"] };
  const frozen = JSON.stringify(CSP_DEFAULTS);
  buildCsp(input);
  buildCsp({ "default-src": ["'none'"] });
  assert.equal(JSON.stringify(CSP_DEFAULTS), frozen);
  assert.deepEqual(input, { "script-src": ["'self'"] });
  assert.equal(directives(buildCsp()).get("default-src"), "'self'");
});
