import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import {
  DEFAULT_JSON_MAX_BYTES,
  errorBody,
  HttpError,
  readBody,
  readJson,
  SECURITY_HEADERS,
  sendEmpty,
  sendError,
  sendJson,
} from "../../server/http.ts";

type Reply = { status: number; headers: http.IncomingHttpHeaders; text: string; socketPort: number | undefined };

type Harness = {
  port: number;
  /** Bytes the handler saw on the request after it answered, per request path. */
  seenBytes: Map<string, number>;
  logged: unknown[];
  request(method: string, path: string, body?: string | Buffer, headers?: Record<string, string>): Promise<Reply>;
  close(): Promise<void>;
};

async function harness(): Promise<Harness> {
  const seenBytes = new Map<string, number>();
  const logged: unknown[] = [];
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    // Count every byte that reaches the request, whether or not the handler kept it.
    let total = 0;
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      seenBytes.set(url.pathname, total);
    });
    try {
      if (url.pathname === "/json") {
        const max = url.searchParams.get("max");
        const body = await readJson(req, max ? { max: Number(max) } : undefined);
        sendJson(res, 200, { got: body });
      } else if (url.pathname === "/raw") {
        const message = url.searchParams.get("message");
        const buffer = await readBody(req, Number(url.searchParams.get("max") ?? 10), message ? { message } : undefined);
        sendJson(res, 200, { length: buffer.length, text: buffer.toString("utf8") });
      } else if (url.pathname === "/undefined") {
        sendJson(res, 200, undefined);
      } else if (url.pathname === "/http-error") {
        throw new HttpError(404, "no such thing", "missing");
      } else if (url.pathname === "/unknown-error") {
        throw new Error("SELECT * FROM users failed at /srv/app/db.ts:12 password=hunter2");
      } else if (url.pathname === "/extra") {
        sendJson(res, 429, { error: "slow down" }, { "retry-after": "30", "cache-control": "private" });
      } else if (url.pathname === "/empty") {
        sendEmpty(res, 204);
      } else if (url.pathname === "/no-content-json") {
        sendJson(res, 204, { ignored: true });
      } else {
        sendJson(res, 200, { ok: true });
      }
    } catch (error) {
      sendError(res, error, (e) => logged.push(e));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });

  function request(method: string, path: string, body?: string | Buffer, headers: Record<string, string> = {}): Promise<Reply> {
    return new Promise((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port, method, path, agent, headers }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            text: Buffer.concat(chunks).toString("utf8"),
            socketPort: req.socket?.localPort,
          }),
        );
      });
      req.on("error", reject);
      if (body !== undefined) req.write(body);
      req.end();
    });
  }

  return {
    port,
    seenBytes,
    logged,
    request,
    async close() {
      agent.destroy();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

async function withServer(fn: (h: Harness) => Promise<void>): Promise<void> {
  const h = await harness();
  try {
    await fn(h);
  } finally {
    await h.close();
  }
}

test("readJson parses an object body", () =>
  withServer(async (h) => {
    const r = await h.request("POST", "/json", JSON.stringify({ a: 1, b: ["x"] }));
    assert.equal(r.status, 200);
    assert.deepEqual(JSON.parse(r.text), { got: { a: 1, b: ["x"] } });
  }));

test("readJson: an empty body is {}", () =>
  withServer(async (h) => {
    const r = await h.request("POST", "/json");
    assert.equal(r.status, 200);
    assert.deepEqual(JSON.parse(r.text), { got: {} });
    const blank = await h.request("POST", "/json", "   \n");
    assert.deepEqual(JSON.parse(blank.text), { got: {} });
  }));

test("readJson: invalid JSON is 400 with an {error} body", () =>
  withServer(async (h) => {
    const r = await h.request("POST", "/json", "{not json");
    assert.equal(r.status, 400);
    assert.deepEqual(JSON.parse(r.text), { error: "invalid JSON" });
  }));

test("readJson: arrays, strings and null are 400, not objects", () =>
  withServer(async (h) => {
    for (const body of ["[1,2]", '"text"', "null", "42"]) {
      const r = await h.request("POST", "/json", body);
      assert.equal(r.status, 400, body);
      assert.deepEqual(JSON.parse(r.text), { error: "expected a JSON object" }, body);
    }
  }));

test("readJson: default cap is 16 KiB", () =>
  withServer(async (h) => {
    assert.equal(DEFAULT_JSON_MAX_BYTES, 16 * 1024);
    const pad = (n: number) => JSON.stringify({ s: "x".repeat(n - 8) });
    const fits = pad(16 * 1024);
    assert.equal(Buffer.byteLength(fits), 16 * 1024);
    assert.equal((await h.request("POST", "/json", fits)).status, 200);
    const over = pad(16 * 1024 + 1);
    const r = await h.request("POST", "/json", over);
    assert.equal(r.status, 413);
    assert.deepEqual(JSON.parse(r.text), { error: "body too large" });
  }));

test("readJson: a per-call max is honoured in both directions", () =>
  withServer(async (h) => {
    const big = JSON.stringify({ s: "y".repeat(40_000) });
    assert.equal((await h.request("POST", "/json", big)).status, 413);
    assert.equal((await h.request("POST", "/json?max=65536", big)).status, 200);
    const small = JSON.stringify({ s: "z".repeat(100) });
    assert.equal((await h.request("POST", "/json?max=50", small)).status, 413);
  }));

test("an oversize body gets 413 and the same keep-alive connection answers the next request", () =>
  withServer(async (h) => {
    const big = Buffer.alloc(2 * 1024 * 1024, "a");
    const first = await h.request("POST", "/json?max=1024", big);
    assert.equal(first.status, 413);
    const second = await h.request("POST", "/json", JSON.stringify({ ok: 1 }));
    assert.equal(second.status, 200);
    assert.deepEqual(JSON.parse(second.text), { got: { ok: 1 } });
    assert.equal(second.socketPort, first.socketPort, "the connection was reused");
  }));

test("an oversize body is drained: every byte is read off the socket, none is returned", () =>
  withServer(async (h) => {
    const big = Buffer.alloc(1024 * 1024, "b");
    const r = await h.request("POST", "/raw?max=100", big);
    assert.equal(r.status, 413);
    assert.equal(r.text.includes("bbbb"), false, "no part of the body is echoed");
    // The handler answered long before the upload ended, yet the whole body was consumed.
    const next = await h.request("GET", "/ping");
    assert.equal(next.status, 200);
    assert.equal(h.seenBytes.get("/raw"), big.length);
  }));

test("an oversize chunked body (no Content-Length) is 413 and is read to the end", () =>
  withServer(async (h) => {
    const r = await new Promise<Reply>((resolve, reject) => {
      const req = http.request(
        { host: "127.0.0.1", port: h.port, method: "POST", path: "/raw?max=64", headers: { "transfer-encoding": "chunked", connection: "close" } },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () =>
            resolve({ status: res.statusCode ?? 0, headers: res.headers, text: Buffer.concat(chunks).toString(), socketPort: undefined }),
          );
        },
      );
      req.on("error", reject);
      for (let i = 0; i < 20; i++) req.write("c".repeat(100));
      req.end();
    });
    assert.equal(r.status, 413);
    assert.equal(h.seenBytes.get("/raw"), 2000);
  }));

test("readBody returns the exact bytes at the cap and rejects one byte over", () =>
  withServer(async (h) => {
    const ok = await h.request("POST", "/raw?max=10", "0123456789");
    assert.equal(ok.status, 200);
    assert.deepEqual(JSON.parse(ok.text), { length: 10, text: "0123456789" });
    const over = await h.request("POST", "/raw?max=10", "0123456789A");
    assert.equal(over.status, 413);
  }));

test("sendJson with an undefined body sends the JSON null", () =>
  withServer(async (h) => {
    const r = await h.request("GET", "/undefined");
    assert.equal(r.status, 200);
    assert.equal(r.text, "null");
    assert.equal(Number(r.headers["content-length"]), 4);
  }));

test("readBody: the 413 message is configurable and defaults to 'body too large'", () =>
  withServer(async (h) => {
    const custom = await h.request("POST", "/raw?max=5&message=too%20big%20for%20here", "0123456789");
    assert.equal(custom.status, 413);
    assert.deepEqual(JSON.parse(custom.text), { error: "too big for here" });
    const fallback = await h.request("POST", "/raw?max=5", "0123456789");
    assert.equal(fallback.status, 413);
    assert.deepEqual(JSON.parse(fallback.text), { error: "body too large" });
  }));

test("sendJson sends the shared security headers and a JSON content type", () =>
  withServer(async (h) => {
    const r = await h.request("GET", "/ping");
    assert.equal(r.status, 200);
    assert.equal(r.headers["content-type"], "application/json; charset=utf-8");
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      assert.equal(r.headers[name], value, name);
    }
    assert.equal(r.headers["cache-control"], "no-store");
    assert.equal(r.headers["x-content-type-options"], "nosniff");
    assert.equal(r.headers["referrer-policy"], "no-referrer");
    assert.equal(r.headers["x-frame-options"], "DENY");
    assert.equal(Number(r.headers["content-length"]), Buffer.byteLength(r.text));
  }));

test("SECURITY_HEADERS holds exactly the shared set, and no content-type", () => {
  assert.deepEqual(Object.keys(SECURITY_HEADERS).sort(), [
    "cache-control",
    "referrer-policy",
    "x-content-type-options",
    "x-frame-options",
  ]);
  assert.throws(() => {
    "use strict";
    (SECURITY_HEADERS as Record<string, string>)["cache-control"] = "public";
  }, TypeError);
});

test("sendJson extra headers are added and may override the defaults", () =>
  withServer(async (h) => {
    const r = await h.request("GET", "/extra");
    assert.equal(r.status, 429);
    assert.equal(r.headers["retry-after"], "30");
    assert.equal(r.headers["cache-control"], "private");
    assert.equal(r.headers["x-content-type-options"], "nosniff");
  }));

test("sendEmpty sends headers and no body", () =>
  withServer(async (h) => {
    const r = await h.request("GET", "/empty");
    assert.equal(r.status, 204);
    assert.equal(r.text, "");
    assert.equal(r.headers["x-content-type-options"], "nosniff");
    assert.equal(r.headers["cache-control"], "no-store");
    const viaJson = await h.request("GET", "/no-content-json");
    assert.equal(viaJson.status, 204);
    assert.equal(viaJson.text, "");
  }));

test("an HttpError is mapped to its status and {error: message}", () =>
  withServer(async (h) => {
    const r = await h.request("GET", "/http-error");
    assert.equal(r.status, 404);
    assert.deepEqual(JSON.parse(r.text), { error: "no such thing" });
    assert.equal(r.headers["x-content-type-options"], "nosniff");
    assert.equal(h.logged.length, 0, "expected errors are not logged as failures");
  }));

test("an unknown error is a 500 {error:'internal error'} and its message does not leak", () =>
  withServer(async (h) => {
    const r = await h.request("GET", "/unknown-error");
    assert.equal(r.status, 500);
    assert.deepEqual(JSON.parse(r.text), { error: "internal error" });
    assert.equal(/SELECT|hunter2|db\.ts/.test(r.text), false);
    assert.equal(h.logged.length, 1);
    assert.match((h.logged[0] as Error).message, /hunter2/, "the real error still reaches the log hook");
  }));

test("errorBody: HttpError keeps status and message, anything else is internal error", () => {
  assert.deepEqual(errorBody(new HttpError(409, "taken")), { status: 409, body: { error: "taken" } });
  assert.deepEqual(errorBody(new Error("secret")), { status: 500, body: { error: "internal error" } });
  assert.deepEqual(errorBody("a string"), { status: 500, body: { error: "internal error" } });
  assert.deepEqual(errorBody(undefined), { status: 500, body: { error: "internal error" } });
  // A plain object that only looks like an HttpError does not get to pick the status.
  assert.deepEqual(errorBody({ status: 418, message: "teapot" }), { status: 500, body: { error: "internal error" } });
});

test("HttpError has explicit status, message and optional code", () => {
  const withCode = new HttpError(400, "bad", "bad_input");
  assert.equal(withCode.status, 400);
  assert.equal(withCode.message, "bad");
  assert.equal(withCode.code, "bad_input");
  assert.ok(withCode instanceof Error);
  assert.equal(new HttpError(500, "x").code, undefined);
});

test("sendError ends a response that has already started instead of writing a second one", async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.write("partial");
    sendError(res, new Error("late failure"), () => {});
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const port = (server.address() as AddressInfo).port;
    const r = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(r.status, 200);
    assert.equal(await r.text(), "partial");
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
