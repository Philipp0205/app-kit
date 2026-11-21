import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as kit from "../../server/index.ts";

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "server");

test("index.ts re-exports every module's public API", () => {
  const expected = [
    // rate-limit
    "createRateLimiter",
    // client-key
    "clientKey",
    // time
    "isoDate", "addDays", "isCalendarDate", "daysBetween", "isTimeZone", "assertTimeZone",
    "zonedParts", "zonedDateTime", "endOfDay",
    // http
    "HttpError", "SECURITY_HEADERS", "DEFAULT_JSON_MAX_BYTES", "sendJson", "sendEmpty",
    "readBody", "readJson", "errorBody", "sendError",
    // csp
    "buildCsp", "CSP_DEFAULTS",
    // static
    "serveStatic",
    // health
    "healthHandler", "isHealthRequest", "HEALTH_PATH",
    // shutdown
    "installGracefulShutdown",
    // auth-code, mailer, auth
    "generateRecoveryCode", "normalizeRecoveryCode", "hashSecret", "normalizeEmail", "needsEmail",
    "resendMailer", "stubMailer", "MailerError", "createAuth",
    // chat
    "createChat", "cleanChatText", "CHAT_TEXT_MAX", "CHAT_THREAD_LIMIT", "CHAT_SQLITE_SCHEMA",
    "createChatPushBatcher", "nextChatPushDelay", "CHAT_PUSH_WINDOW_MS", "CHAT_PUSH_GAP_MS",
  ];
  for (const name of expected) assert.ok(name in kit, `${name} is exported from index.ts`);
});

test("the kit leaves label formatters out", () => {
  for (const name of ["shortDate", "dayLabel", "clockLabel", "noticeDay"]) {
    assert.equal(name in kit, false, name);
  }
});

test("the kit does not export a router or an app wrapper", () => {
  for (const name of Object.keys(kit)) {
    assert.equal(/router|createApp|handler$/i.test(name) && name !== "healthHandler", false, name);
  }
});

test("every .ts file in server/ is importable on its own", async () => {
  const files = fs.readdirSync(SERVER_DIR).filter((f) => f.endsWith(".ts"));
  assert.ok(files.length >= 12);
  for (const file of files) {
    await import(path.join(SERVER_DIR, file));
  }
});

test("server/ uses only node: built-ins, relative .ts imports, and erasable syntax", () => {
  const files = fs.readdirSync(SERVER_DIR).filter((f) => f.endsWith(".ts"));
  for (const file of files) {
    const source = fs.readFileSync(path.join(SERVER_DIR, file), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const match of code.matchAll(/(?:from|import)\s+["']([^"']+)["']/g)) {
      const spec = match[1];
      const ok = spec.startsWith("node:") || (spec.startsWith("./") && spec.endsWith(".ts"));
      assert.ok(ok, `${file}: import "${spec}" must be node: or a relative .ts path`);
    }
    assert.equal(/^\s*(export\s+)?(declare\s+)?(const\s+)?enum\s/m.test(code), false, `${file}: enum`);
    assert.equal(/^\s*(export\s+)?(declare\s+)?namespace\s/m.test(code), false, `${file}: namespace`);
    assert.equal(/import\s+\w+\s*=\s*require/.test(code), false, `${file}: import = require`);
    assert.equal(/constructor\s*\([^)]*\b(public|private|protected|readonly)\s/.test(code), false, `${file}: parameter property`);
  }
});

test("there is no package.json in the repo", () => {
  const root = path.resolve(SERVER_DIR, "..");
  assert.equal(fs.existsSync(path.join(root, "package.json")), false);
});
