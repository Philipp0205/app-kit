import assert from "node:assert/strict";
import test from "node:test";
import { MailerError, resendMailer, stubMailer } from "../../server/mailer.ts";

const message = { to: "ann@example.com", subject: "Hi", text: "plain", html: "<p>plain</p>" };

type Call = { url: string; init: RequestInit };

function fakeFetch(status: number, responseBody = "{}") {
  const calls: Call[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(responseBody, { status });
  }) as typeof fetch;
  return { fn, calls };
}

test("resendMailer POSTs the message to Resend with a Bearer key and a JSON body", async () => {
  const { fn, calls } = fakeFetch(200);
  const mailer = resendMailer({ apiKey: "re_key", from: "App <app@example.com>", fetch: fn });
  await mailer.send(message);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.resend.com/emails");
  assert.equal(calls[0].init.method, "POST");
  const headers = new Headers(calls[0].init.headers);
  assert.equal(headers.get("authorization"), "Bearer re_key");
  assert.equal(headers.get("content-type"), "application/json");
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
    from: "App <app@example.com>",
    to: "ann@example.com",
    subject: "Hi",
    text: "plain",
    html: "<p>plain</p>",
  });
});

test("resendMailer: a non-2xx answer throws MailerError with the status and not the response body", async () => {
  const { fn } = fakeFetch(422, '{"message":"secret detail ann@example.com re_key"}');
  const mailer = resendMailer({ apiKey: "re_key", from: "a@example.com", fetch: fn });
  await assert.rejects(
    () => mailer.send(message),
    (error: unknown) => {
      assert.ok(error instanceof MailerError);
      assert.ok(error instanceof Error);
      assert.equal(error.name, "MailerError");
      assert.equal(error.status, 422);
      assert.match(error.message, /422/);
      assert.equal(/secret detail|ann@example\.com|re_key/.test(error.message), false);
      return true;
    },
  );
});

test("resendMailer: a network failure from fetch is not swallowed", async () => {
  const failing = (async () => {
    throw new TypeError("fetch failed");
  }) as typeof fetch;
  await assert.rejects(() => resendMailer({ apiKey: "k", from: "a@b.co", fetch: failing }).send(message), TypeError);
});

test("stubMailer records the messages it was given", async () => {
  const mailer = stubMailer();
  assert.deepEqual(mailer.sent, []);
  await mailer.send(message);
  await mailer.send({ ...message, to: "bob@example.com" });
  assert.equal(mailer.sent.length, 2);
  assert.deepEqual(mailer.sent[0], message);
  assert.equal(mailer.sent[1].to, "bob@example.com");
});
