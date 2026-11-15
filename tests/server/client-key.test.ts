import assert from "node:assert/strict";
import test from "node:test";
import { clientKey } from "../../server/client-key.ts";

const socket = { remoteAddress: "10.0.0.9" };

test("the rightmost hop wins over a spoofed leftmost", () => {
  const req = { headers: { "x-forwarded-for": "6.6.6.6, 1.2.3.4, 203.0.113.7" }, socket };
  assert.equal(clientKey(req), "203.0.113.7");
});

test("a single hop is used as is", () => {
  assert.equal(clientKey({ headers: { "x-forwarded-for": "203.0.113.7" }, socket }), "203.0.113.7");
});

test("whitespace and empty parts around hops are ignored", () => {
  assert.equal(clientKey({ headers: { "x-forwarded-for": "  6.6.6.6 ,  203.0.113.7   " }, socket }), "203.0.113.7");
  assert.equal(clientKey({ headers: { "x-forwarded-for": "6.6.6.6,203.0.113.7,, ," }, socket }), "203.0.113.7");
});

test("an empty or blank header falls back to the socket address", () => {
  assert.equal(clientKey({ headers: { "x-forwarded-for": "" }, socket }), "10.0.0.9");
  assert.equal(clientKey({ headers: { "x-forwarded-for": "   " }, socket }), "10.0.0.9");
  assert.equal(clientKey({ headers: { "x-forwarded-for": " , , " }, socket }), "10.0.0.9");
});

test("a missing header falls back to the socket address", () => {
  assert.equal(clientKey({ headers: {}, socket }), "10.0.0.9");
  assert.equal(clientKey({ headers: { "x-forwarded-for": undefined }, socket }), "10.0.0.9");
});

test("an array header (repeated lines) is read as one list, last line last", () => {
  const req = { headers: { "x-forwarded-for": ["6.6.6.6", "198.51.100.2, 203.0.113.7"] }, socket };
  assert.equal(clientKey(req), "203.0.113.7");
});

test("a spoofed first header line cannot win over the proxy's last line", () => {
  const req = { headers: { "x-forwarded-for": ["9.9.9.9", "203.0.113.7"] }, socket };
  assert.equal(clientKey(req), "203.0.113.7");
});

test("an empty array header falls back to the socket address", () => {
  assert.equal(clientKey({ headers: { "x-forwarded-for": [] }, socket }), "10.0.0.9");
});

test("nothing available gives 'unknown'", () => {
  assert.equal(clientKey({ headers: {} }), "unknown");
  assert.equal(clientKey({ headers: {}, socket: {} }), "unknown");
  assert.equal(clientKey({ headers: {}, socket: null }), "unknown");
  assert.equal(clientKey({ headers: {}, socket: { remoteAddress: "" } }), "unknown");
});

test("a rightmost hop that is not a plain address is not used", () => {
  const long = "a".repeat(129);
  assert.equal(clientKey({ headers: { "x-forwarded-for": `1.2.3.4, ${long}` }, socket }), "10.0.0.9");
  assert.equal(clientKey({ headers: { "x-forwarded-for": "1.2.3.4, a/b" }, socket }), "10.0.0.9");
  assert.equal(clientKey({ headers: { "x-forwarded-for": "1.2.3.4, a\tb" }, socket }), "10.0.0.9");
});

test("IPv6 hops pass through", () => {
  assert.equal(clientKey({ headers: { "x-forwarded-for": "6.6.6.6, 2001:db8::1" }, socket }), "2001:db8::1");
});

test("works with a real http request shape", async () => {
  const { default: http } = await import("node:http");
  const server = http.createServer((req, res) => {
    res.end(clientKey(req));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address() as import("node:net").AddressInfo;
    const plain = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(await plain.text(), "127.0.0.1");
    const forwarded = await fetch(`http://127.0.0.1:${port}/`, { headers: { "x-forwarded-for": "6.6.6.6, 203.0.113.7" } });
    assert.equal(await forwarded.text(), "203.0.113.7");
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
