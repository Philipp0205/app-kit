# Java conventions

What the TypeScript server modules do, written down so a Java app (extrablatt) can match it. Nothing here is shared code. It is a spec. Extrablatt already follows the limiter and client-IP rules below, and this page records them so the three apps do not drift.

## Rate limiter

Reference: `server/rate-limit.ts` (TypeScript), extrablatt `RateLimiter.java`.

- **Fixed window per key, in memory.** The first hit for a key starts a window of `windowMs`. Hits in that window are counted. A hit is allowed while `count <= limit`, so the first `limit` hits pass and the rest are refused until the window ends. The window does not slide and later hits do not extend it. A key whose window has ended starts a new one.
- **`hit(key, now)`** counts one request and says whether it is allowed. A refused hit still counts, but it only matters inside the current window. The next window starts from zero.
- **`resetIn(key, now)`** is the milliseconds until the key's window ends, `0` for an unknown or expired key. It does not count a hit. Use it for `Retry-After`.
- **Bounded memory.** At most `maxKeys` keys are held (default 10,000). Expired windows are pruned. When the map is full of live windows, the oldest key is dropped, so a flood of distinct keys costs constant memory.
- **In-memory only.** State resets on restart and is per instance. That is accepted while each app runs as one replica.

Extrablatt: `RateLimiter.tryAcquire(key, maxHits, window)` is the same fixed window (`count <= maxHits`, a new window once `now >= expiresAt`) with the same default of 10,000 keys, plus periodic sweeps of expired entries. It differs in small ways that do not change behaviour for callers: the window length is passed per call instead of fixed per limiter, a window shorter than one second is raised to one second, it drops the least recently used key instead of the oldest-inserted one, and it has no public `resetIn`. Add `resetIn` only if a feature needs `Retry-After`.

## Client key (client IP)

Reference: `server/client-key.ts`, extrablatt `ClientIpResolver.java`.

- Behind a proxy that **appends** to `X-Forwarded-For` (Railway does), the **rightmost** hop is the address the proxy actually accepted. Values to its left are whatever the caller sent and are never trusted. Never take the leftmost hop.
- Several `X-Forwarded-For` header lines are one list in order, so the last hop of the last line wins.
- Use the header only when the request really came through your own proxy. A server that can be reached directly must ignore it and use the socket address, because a caller can send any header.
- With no usable header, use the **socket address** (`getRemoteAddr()` in a servlet). A hop that is empty, longer than 128 characters or contains whitespace or `/` is not used.
- If nothing is available, use a fixed fallback such as `unknown`, so all unknown callers share one bucket instead of failing.

Extrablatt goes further than the TypeScript version. `ClientIpResolver` trusts the header only when the socket peer is a trusted proxy (private ranges, plus Cloudflare's ranges), then walks the header from the right, skipping trusted proxies, and uses the first address that is not one. It never reads `CF-Connecting-IP` and never does a DNS lookup. That is the same rule (rightmost, never the leftmost, socket fallback) with a stricter definition of "trusted proxy". Keep it. The TypeScript version is the simple form for apps whose only proxy is Railway's, which appends one hop.

## Health

- `GET /api/health` returns `200` with `{"ok":true}`. `HEAD` is allowed and has no body. Any other method on that path is `405` with `Allow: GET, HEAD`. It does not check the database.
- Extrablatt keeps Spring Boot Actuator at `/actuator/health` as its health endpoint. That does not change. If a shared tool wants one URL for all three apps, add an optional `/api/health` alias that returns `{"ok":true}`. It needs no more than a small controller, and must not require a login.

## Errors

- Errors are JSON: `{"error": "<message>"}`. The message is meant for the caller and must not contain internals.
- Status codes: `400` for a body that is not valid JSON or not an object, `404` for an unknown path or file, `405` for a wrong method, `413` for a body over the limit, `429` for the rate limit (with `Retry-After` in seconds), `500` for anything unexpected.
- An unexpected error is `500` with the fixed message `internal error`. Log the real error on the server and never put its message, a stack trace or an SQL fragment in the response.
- Body limits: JSON bodies default to 16 KiB. A route that needs more sets its own cap. A body over the cap is `413`, and the rest of the upload is read and discarded, not buffered, so the connection can answer.

Extrablatt: `GlobalExceptionHandler` is where error mapping lives in the Java app. This page is a target for its `/api` error bodies, and its current response shape was not checked when this was written. Check it before relying on the match.

## Security headers

Every response carries these. `Content-Type` is set per response.

| Header | Value |
| --- | --- |
| `Cache-Control` | `no-store` (JSON and API). Static files default to `no-cache`. |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `no-referrer` |
| `X-Frame-Options` | `DENY` |

The `Content-Security-Policy` is per app, because the allowlists are. The TypeScript default is `default-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'`, and an app adds only the sources it needs. Extrablatt sets its own policy in Spring Security's config. Keep `object-src 'none'`, `base-uri 'self'` and `frame-ancestors 'none'` in it where the app allows. `X-Frame-Options: DENY` is the older twin of `frame-ancestors 'none'`.
