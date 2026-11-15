import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  generateRecoveryCode,
  hashSecret,
  needsEmail,
  normalizeEmail,
  normalizeRecoveryCode,
} from "../../server/auth-code.ts";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

test("generateRecoveryCode: XXXX-XXXX-XXXX from the 32-character alphabet", () => {
  for (let i = 0; i < 200; i++) {
    const code = generateRecoveryCode();
    assert.match(code, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    for (const char of code.replaceAll("-", "")) assert.ok(ALPHABET.includes(char), char);
  }
  assert.equal(/[IO01]/.test(ALPHABET), false);
});

test("generateRecoveryCode: 1000 codes are all different", () => {
  const codes = new Set<string>();
  for (let i = 0; i < 1000; i++) codes.add(generateRecoveryCode());
  assert.equal(codes.size, 1000);
});

test("generateRecoveryCode: every alphabet character shows up (no dead characters)", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 400; i++) for (const char of generateRecoveryCode().replaceAll("-", "")) seen.add(char);
  assert.equal(seen.size, ALPHABET.length);
});

test("normalizeRecoveryCode: accepts lowercase, spaces, dashes and other separators", () => {
  assert.equal(normalizeRecoveryCode("ABCD-EFGH-JKLM"), "ABCD-EFGH-JKLM");
  assert.equal(normalizeRecoveryCode("abcd-efgh-jklm"), "ABCD-EFGH-JKLM");
  assert.equal(normalizeRecoveryCode("  abcd efgh jklm  "), "ABCD-EFGH-JKLM");
  assert.equal(normalizeRecoveryCode("abcdefghjklm"), "ABCD-EFGH-JKLM");
  assert.equal(normalizeRecoveryCode("ab-cd.ef_gh/jk lm"), "ABCD-EFGH-JKLM");
  assert.equal(normalizeRecoveryCode("2345-6789-ABCD"), "2345-6789-ABCD");
});

test("normalizeRecoveryCode: wrong length and characters outside the alphabet give null", () => {
  assert.equal(normalizeRecoveryCode(""), null);
  assert.equal(normalizeRecoveryCode("ABCD-EFGH-JKL"), null);
  assert.equal(normalizeRecoveryCode("ABCD-EFGH-JKLMN"), null);
  for (const bad of ["I", "O", "0", "1"]) {
    assert.equal(normalizeRecoveryCode(`ABCD-EFGH-JKL${bad}`), null, bad);
  }
  assert.equal(normalizeRecoveryCode("ABCD-EFGH-JKLÄ"), null);
  assert.equal(normalizeRecoveryCode("----"), null);
});

test("every generated code survives normalizeRecoveryCode unchanged", () => {
  for (let i = 0; i < 100; i++) {
    const code = generateRecoveryCode();
    assert.equal(normalizeRecoveryCode(code), code);
    assert.equal(normalizeRecoveryCode(code.toLowerCase()), code);
  }
});

test("hashSecret: known sha256 vector, stable, inputs differ", () => {
  assert.equal(hashSecret("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(hashSecret(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.equal(hashSecret("same"), hashSecret("same"));
  assert.notEqual(hashSecret("a"), hashSecret("b"));
  assert.notEqual(hashSecret("ABCD"), hashSecret("abcd"));
  // utf8, not latin1
  assert.equal(hashSecret("é"), createHash("sha256").update(Buffer.from([0xc3, 0xa9])).digest("hex"));
  assert.notEqual(hashSecret("é"), hashSecret("e"));
});

test("normalizeEmail: trims and lowercases", () => {
  assert.equal(normalizeEmail("  Ann@Example.COM \n"), "ann@example.com");
  assert.equal(normalizeEmail("a.b+tag@sub.example.org"), "a.b+tag@sub.example.org");
});

test("normalizeEmail: rejects malformed addresses", () => {
  for (const bad of [
    "",
    "   ",
    "plain",
    "no-at.example.com",
    "a@b",
    "a@@b.com",
    "a@b@c.com",
    "@b.com",
    "a@.com",
    "a@b.",
    "a@b..com",
    "a b@c.com",
    "a@b c.com",
  ]) {
    assert.equal(normalizeEmail(bad), null, JSON.stringify(bad));
  }
  assert.equal(normalizeEmail(undefined as unknown as string), null);
});

test("normalizeEmail: at most 254 characters", () => {
  const domain = "@example.com";
  const ok = "a".repeat(254 - domain.length) + domain;
  assert.equal(ok.length, 254);
  assert.equal(normalizeEmail(ok), ok);
  assert.equal(normalizeEmail("a" + ok), null);
});

test("needsEmail: only a null email needs one", () => {
  assert.equal(needsEmail({ email: "a@b.co" }), false);
  assert.equal(needsEmail({ email: null }), true);
});
