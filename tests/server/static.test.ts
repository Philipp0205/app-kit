import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SECURITY_HEADERS } from "../../server/http.ts";
import { serveStatic, type StaticOptions } from "../../server/static.ts";

type Reply = { status: number; headers: http.IncomingHttpHeaders; text: string };

type Site = {
  /** Directory holding both the served root and its siblings. */
  base: string;
  root: string;
  get(rawPath: string, method?: string): Promise<Reply>;
  close(): Promise<void>;
};

/**
 * base/
 *   site/            <- served root
 *     index.html, app.js, style.css, logo.png, sub/page.html, vendor/lib.js
 *     link-out  -> ../secret.txt         (symlink out of the root)
 *     link-dir  -> ../site-evil          (symlink to a sibling dir)
 *     link-in   -> app.js                (symlink that stays inside)
 *   site-evil/secret.txt                 (prefix sibling: "/site-evil" starts with "/site")
 *   secret.txt
 */
async function site(options?: StaticOptions, extra?: (root: string) => void): Promise<Site> {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ak-static-")));
  const root = path.join(base, "site");
  fs.mkdirSync(path.join(root, "sub"), { recursive: true });
  fs.mkdirSync(path.join(root, "vendor"));
  fs.mkdirSync(path.join(base, "site-evil"));
  fs.writeFileSync(path.join(root, "index.html"), "<h1>home</h1>");
  fs.writeFileSync(path.join(root, "app.js"), "console.log(1)");
  fs.writeFileSync(path.join(root, "style.css"), "body{}");
  fs.writeFileSync(path.join(root, "logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  fs.writeFileSync(path.join(root, "sub", "page.html"), "<p>sub</p>");
  fs.writeFileSync(path.join(root, "vendor", "lib.js"), "lib");
  fs.writeFileSync(path.join(root, "data.unknownext"), "zzz");
  fs.writeFileSync(path.join(base, "secret.txt"), "TOP SECRET");
  fs.writeFileSync(path.join(base, "site-evil", "secret.txt"), "EVIL SECRET");
  fs.symlinkSync("../secret.txt", path.join(root, "link-out"));
  fs.symlinkSync("../secret.txt", path.join(root, "link-out.txt"));
  fs.symlinkSync("../site-evil", path.join(root, "link-dir"));
  fs.symlinkSync("app.js", path.join(root, "link-in.js"));
  extra?.(root);

  const handler = serveStatic(root, options);
  const server = http.createServer(async (req, res) => {
    // Pass the raw path, as an app that parsed the URL itself would.
    const rawPath = (req.url ?? "/").split("?")[0];
    const handled = await handler(req, res, rawPath);
    if (!handled) {
      res.writeHead(418);
      res.end("not handled");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    base,
    root,
    // http.request with a raw path, because fetch normalises "/../" and "%2e" before sending.
    get(rawPath, method = "GET") {
      return new Promise((resolve, reject) => {
        const req = http.request({ host: "127.0.0.1", port, method, path: rawPath }, (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () =>
            resolve({ status: res.statusCode ?? 0, headers: res.headers, text: Buffer.concat(chunks).toString("utf8") }),
          );
        });
        req.on("error", reject);
        req.end();
      });
    },
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(base, { recursive: true, force: true });
    },
  };
}

async function withSite(fn: (s: Site) => Promise<void>, options?: StaticOptions): Promise<void> {
  const s = await site(options);
  try {
    await fn(s);
  } finally {
    await s.close();
  }
}

function assertNoLeak(r: Reply): void {
  assert.equal(r.text.includes("SECRET"), false, `leaked: ${r.text}`);
}

test("serves a file with its content type and the security headers", () =>
  withSite(async (s) => {
    const r = await s.get("/app.js");
    assert.equal(r.status, 200);
    assert.equal(r.text, "console.log(1)");
    assert.equal(r.headers["content-type"], "text/javascript; charset=utf-8");
    assert.equal(Number(r.headers["content-length"]), 14);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      if (name === "cache-control") continue;
      assert.equal(r.headers[name], value, name);
    }
  }));

test("content types for common web files", () =>
  withSite(async (s) => {
    assert.equal((await s.get("/style.css")).headers["content-type"], "text/css; charset=utf-8");
    assert.equal((await s.get("/logo.png")).headers["content-type"], "image/png");
    assert.equal((await s.get("/sub/page.html")).headers["content-type"], "text/html; charset=utf-8");
    assert.equal((await s.get("/data.unknownext")).headers["content-type"], "application/octet-stream");
  }));

test("a file in a subdirectory is served", () =>
  withSite(async (s) => {
    const r = await s.get("/sub/page.html");
    assert.equal(r.status, 200);
    assert.equal(r.text, "<p>sub</p>");
  }));

test("the root path and an extensionless path serve index.html (SPA fallback)", () =>
  withSite(async (s) => {
    for (const p of ["/", "/settings", "/items/42", "/a/b/c"]) {
      const r = await s.get(p);
      assert.equal(r.status, 200, p);
      assert.equal(r.text, "<h1>home</h1>", p);
      assert.equal(r.headers["content-type"], "text/html; charset=utf-8", p);
    }
  }));

test("a missing file with an extension is 404 JSON, not the fallback", () =>
  withSite(async (s) => {
    for (const p of ["/missing.js", "/nope/missing.css", "/missing.png"]) {
      const r = await s.get(p);
      assert.equal(r.status, 404, p);
      assert.deepEqual(JSON.parse(r.text), { error: "not found" });
      assert.equal(r.headers["x-content-type-options"], "nosniff");
    }
  }));

test("a directory is not served as a file", () =>
  withSite(async (s) => {
    // An extensionless directory name takes the SPA fallback, never a listing.
    assert.equal((await s.get("/sub")).text, "<h1>home</h1>");
    // A directory whose name has an extension is not a file: 404.
    fs.mkdirSync(path.join(s.root, "assets.d"));
    const r = await s.get("/assets.d");
    assert.equal(r.status, 404);
    assert.deepEqual(JSON.parse(r.text), { error: "not found" });
  }));

test("the SPA fallback can be turned off", async () => {
  await withSite(
    async (s) => {
      assert.equal((await s.get("/settings")).status, 404);
      assert.equal((await s.get("/app.js")).status, 200);
    },
    { fallback: false },
  );
});

test("a custom fallback file is used", async () => {
  await withSite(
    async (s) => {
      assert.equal((await s.get("/anything")).text, "<p>sub</p>");
    },
    { fallback: "sub/page.html" },
  );
});

test("dot-dot segments are rejected: plain, encoded and mixed", () =>
  withSite(async (s) => {
    const attacks = [
      "/../secret.txt",
      "/../site-evil/secret.txt",
      "/sub/../../secret.txt",
      "/%2e%2e/secret.txt",
      "/%2E%2E/secret.txt",
      "/.%2e/secret.txt",
      "/%2e./secret.txt",
      "/sub/%2e%2e/%2e%2e/secret.txt",
      "/..%2fsecret.txt",
      "/%2e%2e%2fsecret.txt",
      "/..%5csecret.txt",
      "/%2e%2e%5csecret.txt",
      "/sub/..\\..\\secret.txt",
    ];
    for (const p of attacks) {
      const r = await s.get(p);
      assert.ok(r.status === 400 || r.status === 404, `${p} -> ${r.status}`);
      assertNoLeak(r);
    }
    // A name that merely contains two dots is fine.
    fs.writeFileSync(path.join(s.root, "a..b.js"), "dots");
    assert.equal((await s.get("/a..b.js")).text, "dots");
  }));

test("a NUL byte is rejected", () =>
  withSite(async (s) => {
    for (const p of ["/app.js%00", "/app.js%00.png", "/%00", "/sub%00/page.html"]) {
      const r = await s.get(p);
      assert.equal(r.status, 400, p);
      assert.deepEqual(JSON.parse(r.text), { error: "bad path" });
    }
  }));

test("malformed percent-encoding is rejected", () =>
  withSite(async (s) => {
    for (const p of ["/%", "/%zz", "/app%2", "/%E0%A4%A", "/%c0%af"]) {
      const r = await s.get(p);
      assert.equal(r.status, 400, p);
      assert.deepEqual(JSON.parse(r.text), { error: "bad path" });
    }
  }));

test("well-formed percent-encoding is decoded", () =>
  withSite(async (s) => {
    fs.writeFileSync(path.join(s.root, "my file.js"), "spaced");
    fs.writeFileSync(path.join(s.root, "café.js"), "accent");
    assert.equal((await s.get("/my%20file.js")).text, "spaced");
    assert.equal((await s.get("/caf%C3%A9.js")).text, "accent");
    assert.equal((await s.get("/%61pp.js")).text, "console.log(1)");
  }));

test("a prefix sibling directory (/site-evil next to /site) is not reachable", () =>
  withSite(async (s) => {
    for (const p of ["/../site-evil/secret.txt", "/%2e%2e/site-evil/secret.txt", "/link-dir/secret.txt", "/link-dir"]) {
      const r = await s.get(p);
      assertNoLeak(r);
    }
    assert.equal((await s.get("/link-dir/secret.txt")).status, 404);
  }));

test("a symlink that leaves the root is not served", () =>
  withSite(async (s) => {
    for (const p of ["/link-out.txt", "/link-dir/secret.txt"]) {
      const r = await s.get(p);
      assert.equal(r.status, 404, p);
      assertNoLeak(r);
    }
    // An extensionless symlink out of the root takes the SPA fallback and never reads the target.
    const bare = await s.get("/link-out");
    assertNoLeak(bare);
  }));

test("a symlink that stays inside the root is served", () =>
  withSite(async (s) => {
    const r = await s.get("/link-in.js");
    assert.equal(r.status, 200);
    assert.equal(r.text, "console.log(1)");
  }));

test("a symlinked fallback file that points outside the root is not served", async () => {
  const s = await site({ fallback: "link-out.txt" });
  try {
    const r = await s.get("/anything");
    assert.equal(r.status, 404);
    assertNoLeak(r);
  } finally {
    await s.close();
  }
});

test("the root itself being a symlink is fine", async () => {
  const s = await site();
  const linkRoot = path.join(s.base, "root-link");
  fs.symlinkSync(s.root, linkRoot);
  const handler = serveStatic(linkRoot);
  const server = http.createServer(async (req, res) => {
    if (!(await handler(req, res, req.url ?? "/"))) res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const port = (server.address() as AddressInfo).port;
    const r = await fetch(`http://127.0.0.1:${port}/app.js`);
    assert.equal(await r.text(), "console.log(1)");
    const out = await fetch(`http://127.0.0.1:${port}/link-out.txt`);
    assert.equal(out.status, 404);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await s.close();
  }
});

test("HEAD returns the headers and length but no body", () =>
  withSite(async (s) => {
    const r = await s.get("/app.js", "HEAD");
    assert.equal(r.status, 200);
    assert.equal(r.text, "");
    assert.equal(r.headers["content-length"], "14");
    assert.equal(r.headers["content-type"], "text/javascript; charset=utf-8");
    const spa = await s.get("/settings", "HEAD");
    assert.equal(spa.status, 200);
    assert.equal(spa.text, "");
    const missing = await s.get("/missing.js", "HEAD");
    assert.equal(missing.status, 404);
  }));

test("only GET and HEAD: other methods are not handled, and nothing is written", () =>
  withSite(async (s) => {
    for (const method of ["POST", "PUT", "DELETE", "PATCH", "OPTIONS"]) {
      const r = await s.get("/app.js", method);
      assert.equal(r.status, 418, method);
      assert.equal(r.text, "not handled", method);
    }
  }));

test("cache-control: no-cache by default for html and other files", () =>
  withSite(async (s) => {
    assert.equal((await s.get("/app.js")).headers["cache-control"], "no-cache");
    assert.equal((await s.get("/")).headers["cache-control"], "no-cache");
    assert.equal((await s.get("/logo.png")).headers["cache-control"], "no-cache");
  }));

test("cache-control is configurable for html, for other files, and per path", async () => {
  await withSite(
    async (s) => {
      assert.equal((await s.get("/")).headers["cache-control"], "no-store");
      assert.equal((await s.get("/sub/page.html")).headers["cache-control"], "no-store");
      assert.equal((await s.get("/settings")).headers["cache-control"], "no-store");
      assert.equal((await s.get("/app.js")).headers["cache-control"], "public, max-age=3600");
      assert.equal((await s.get("/logo.png")).headers["cache-control"], "public, max-age=3600");
      assert.equal((await s.get("/vendor/lib.js")).headers["cache-control"], "public, max-age=604800, immutable");
    },
    {
      htmlCacheControl: "no-store",
      cacheControl: "public, max-age=3600",
      cacheFor: (rel) => (rel.startsWith("vendor/") ? "public, max-age=604800, immutable" : undefined),
    },
  );
});

test("extra content types can be added", async () => {
  await withSite(
    async (s) => {
      assert.equal((await s.get("/data.unknownext")).headers["content-type"], "application/x-custom");
    },
    { mime: { ".unknownext": "application/x-custom" } },
  );
});

test("a missing root answers 404 instead of throwing", async () => {
  const handler = serveStatic(path.join(os.tmpdir(), "ak-static-does-not-exist"));
  const server = http.createServer(async (req, res) => {
    await handler(req, res, req.url ?? "/");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const port = (server.address() as AddressInfo).port;
    assert.equal((await fetch(`http://127.0.0.1:${port}/app.js`)).status, 404);
    assert.equal((await fetch(`http://127.0.0.1:${port}/`)).status, 404);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
