import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { HEALTH_PATH, healthHandler, isHealthRequest } from "../../server/health.ts";
import { SECURITY_HEADERS } from "../../server/http.ts";

type Reply = { status: number; headers: http.IncomingHttpHeaders; text: string };

async function withServer(fn: (request: (method: string, path: string) => Promise<Reply>) => Promise<void>): Promise<void> {
  // No router: the app's own handler runs only when the health handler declines.
  const server = http.createServer((req, res) => {
    if (healthHandler(req, res)) return;
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("app route");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const request = (method: string, path: string) =>
    new Promise<Reply>((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port, method, path }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, text: Buffer.concat(chunks).toString() }));
      });
      req.on("error", reject);
      req.end();
    });
  try {
    await fn(request);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

test("GET /api/health is 200 {ok:true} with the security headers", () =>
  withServer(async (request) => {
    const r = await request("GET", "/api/health");
    assert.equal(r.status, 200);
    assert.deepEqual(JSON.parse(r.text), { ok: true });
    assert.equal(r.headers["content-type"], "application/json; charset=utf-8");
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) assert.equal(r.headers[name], value, name);
  }));

test("HEAD /api/health is 200 with no body and the length of the GET body", () =>
  withServer(async (request) => {
    const get = await request("GET", "/api/health");
    const head = await request("HEAD", "/api/health");
    assert.equal(head.status, 200);
    assert.equal(head.text, "");
    assert.equal(head.headers["content-length"], String(Buffer.byteLength(get.text)));
  }));

test("other methods on the health path are 405 with an Allow header and an {error} body", () =>
  withServer(async (request) => {
    for (const method of ["POST", "PUT", "DELETE", "PATCH", "OPTIONS"]) {
      const r = await request(method, "/api/health");
      assert.equal(r.status, 405, method);
      assert.equal(r.headers.allow, "GET, HEAD", method);
      assert.deepEqual(JSON.parse(r.text), { error: "method not allowed" }, method);
    }
  }));

test("a query string does not change the answer", () =>
  withServer(async (request) => {
    const r = await request("GET", "/api/health?probe=1");
    assert.equal(r.status, 200);
    assert.deepEqual(JSON.parse(r.text), { ok: true });
    assert.equal((await request("POST", "/api/health?x=1")).status, 405);
  }));

test("other paths are left alone: not handled, so the app answers", () =>
  withServer(async (request) => {
    for (const p of ["/", "/api", "/api/healthz", "/api/health/", "/api/health/x", "/health", "/api/healt", "/x/api/health"]) {
      const get = await request("GET", p);
      assert.equal(get.text, "app route", p);
      const post = await request("POST", p);
      assert.equal(post.text, "app route", p);
    }
  }));

test("healthHandler returns true when it answered and false when it did not", () => {
  const calls: number[] = [];
  const fakeRes = {
    writeHead: (status: number) => void calls.push(status),
    end: () => {},
  } as unknown as http.ServerResponse;
  assert.equal(healthHandler({ url: "/api/health", method: "GET" }, fakeRes), true);
  assert.equal(healthHandler({ url: "/api/health", method: "POST" }, fakeRes), true);
  assert.deepEqual(calls, [200, 405]);
  assert.equal(healthHandler({ url: "/other", method: "GET" }, fakeRes), false);
  assert.deepEqual(calls, [200, 405], "an unhandled request writes nothing");
});

test("isHealthRequest matches the path for any method and ignores the query", () => {
  assert.equal(HEALTH_PATH, "/api/health");
  assert.equal(isHealthRequest({ url: "/api/health" }), true);
  assert.equal(isHealthRequest({ url: "/api/health?a=b" }), true);
  assert.equal(isHealthRequest({ url: "/api/health#x" }), true);
  assert.equal(isHealthRequest({ url: "/api/health/" }), false);
  assert.equal(isHealthRequest({ url: "/api/healthy" }), false);
  assert.equal(isHealthRequest({ url: "" }), false);
  assert.equal(isHealthRequest({ url: undefined }), false);
});

type Probe = { status: number; text: string; handled: boolean };

async function probeWithCheck(method: string, path: string, check: () => unknown | Promise<unknown>): Promise<Probe> {
  let handled = false;
  const server = http.createServer(async (req, res) => {
    handled = await healthHandler(req, res, check);
    if (!handled) {
      res.writeHead(200);
      res.end("app route");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    const reply = await new Promise<{ status: number; text: string }>((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port, method, path }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString() }));
      });
      req.on("error", reject);
      req.end();
    });
    return { ...reply, handled };
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

test("healthHandler without a check stays synchronous and returns a boolean", () => {
  const fakeRes = { writeHead: () => {}, end: () => {} } as unknown as http.ServerResponse;
  const result = healthHandler({ url: "/api/health", method: "GET" }, fakeRes);
  assert.equal(result, true);
  assert.equal(typeof result, "boolean");
});

test("healthHandler with a check returns a Promise<boolean>", async () => {
  const fakeRes = { writeHead: () => {}, end: () => {} } as unknown as http.ServerResponse;
  const result = healthHandler({ url: "/api/health", method: "GET" }, fakeRes, () => {});
  assert.ok(result instanceof Promise);
  assert.equal(await result, true);
  assert.equal(await healthHandler({ url: "/other", method: "GET" }, fakeRes, () => {}), false);
});

test("a passing check (sync or async) answers 200 {ok:true} on GET and HEAD", async () => {
  for (const check of [() => 1, async () => {}]) {
    const get = await probeWithCheck("GET", "/api/health", check);
    assert.equal(get.status, 200);
    assert.deepEqual(JSON.parse(get.text), { ok: true });
    assert.equal(get.handled, true);
    const head = await probeWithCheck("HEAD", "/api/health", check);
    assert.equal(head.status, 200);
    assert.equal(head.text, "");
  }
});

test("a throwing or rejecting check answers 503 {ok:false} and leaks nothing", async () => {
  const secret = "connection refused postgres://user:hunter2@db";
  const checks = [
    () => {
      throw new Error(secret);
    },
    () => Promise.reject(new Error(secret)),
  ];
  for (const check of checks) {
    const get = await probeWithCheck("GET", "/api/health", check);
    assert.equal(get.status, 503);
    assert.equal(get.text, '{"ok":false}');
    assert.equal(get.handled, true);
    const head = await probeWithCheck("HEAD", "/api/health", check);
    assert.equal(head.status, 503);
    assert.equal(head.text, "");
  }
});

test("the check does not run for other methods (405) or other paths (false)", async () => {
  let calls = 0;
  const check = () => {
    calls += 1;
    throw new Error("must not run");
  };
  const post = await probeWithCheck("POST", "/api/health", check);
  assert.equal(post.status, 405);
  assert.equal(post.handled, true);
  const other = await probeWithCheck("GET", "/api/other", check);
  assert.equal(other.text, "app route");
  assert.equal(other.handled, false);
  assert.equal(calls, 0);
});
