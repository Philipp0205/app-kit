# app-kit chat module, 0.8.0

Files: `server/chat.ts` (`createChat`, `cleanChatText`, the push batcher, `CHAT_SQLITE_SCHEMA`), `frontend/ak-chat.js` and `frontend/ak-chat.css` (`AppKit.chat`). The server file is re-exported from `server/index.ts`. Same rules as the rest of `server/`: `node:` built-ins only, erasable TS, relative imports end in `.ts`.

## What is in and what is out

In:

- Text cleaning and the length rule (`cleanChatText`).
- A small service over a store: post, thread, mark read, unread counts, mute.
- A push batcher: many messages become one notice per recipient and chat.
- A chat pane for the browser: bubbles, a composer, a send queue with retry, a visibility-aware poller.

Out, on purpose:

- **Routes.** The app owns them and its own router.
- **Membership and permission checks.** The app checks that the user may see and post in a chat before it calls the kit. The kit trusts the `chatId` and `userId` it is given.
- **Schema.** The app implements `ChatStore` over its own tables. `CHAT_SQLITE_SCHEMA` is a suggestion the kit never runs.
- **Web push.** The batcher decides when and what. The app's `send` callback sends it. The kit has no web-push dependency.
- Reactions, attachments, edits, deletes, typing, day separators.

## Server API

    import { createChat, createChatPushBatcher } from "./app-kit/index.ts";

    const chat = createChat({ store });                // store: ChatStore
    await chat.post(chatId, { id: user.id, name: user.name }, body.text);
    await chat.thread(chatId, user.id);                // { messages, muted }
    await chat.markRead(chatId, user.id);
    await chat.unreadCounts(user.id, [chatIdA, chatIdB]);
    await chat.setMuted(chatId, user.id, true);

`createChat({ store, now?, newId?, threadLimit?, maxLength? })` throws `TypeError` for missing options, a missing store, or a `threadLimit` or `maxLength` that is not a positive integer. Defaults: `now` is `Date.now`, `newId` is `randomUUID`, `threadLimit` is `CHAT_THREAD_LIMIT` (200), `maxLength` is `CHAT_TEXT_MAX` (1000).

| Method | Behaviour |
| --- | --- |
| `post(chatId, { id, name }, text)` | Cleans `text`. On success inserts and returns `{ ok: true, message }` (the message has `id`, `chatId`, `userId`, `userName`, `body`, `createdAt`). Otherwise `{ ok: false, reason: "empty" \| "too_long" }` and nothing is stored. |
| `thread(chatId, userId)` | `{ messages, muted }`: the newest `threadLimit` messages, oldest first, and whether this user muted the chat. It does not mark the chat read. |
| `markRead(chatId, userId)` | Sets the user's read time for the chat to `now()`. |
| `unreadCounts(userId, chatIds)` | `{ [chatId]: n }`. An empty list answers `{}` without calling the store. Duplicate ids are asked once. |
| `setMuted(chatId, userId, muted)` | Stores or clears the mute. |

`cleanChatText(raw, max = 1000)` returns `{ ok: true, text }` or `{ ok: false, reason }`. A non-string is `empty`. Control characters other than tab, newline and carriage return are removed, CRLF becomes LF, the text is trimmed, and the length is counted in code points, so an emoji counts as one.

### The ChatStore contract

Methods may return a value or a Promise. Argument order is the one in `ChatStore` in `server/chat.ts`. Every method assumes the app already checked access.

| Method | Contract |
| --- | --- |
| `listMessages(chatId, limit)` | The newest `limit` messages of the chat, returned **oldest first**, each with `userName` filled from the app's users table. |
| `insertMessage({ id, chatId, userId, body, createdAt })` | Stores one row. |
| `setReadAt(userId, chatId, at)` | Upsert: the user's read time for the chat is `at`. |
| `unreadCounts(userId, chatIds)` | For each id, the number of messages by **other** users newer than the user's read time (0 if the user never read it). Every requested id is in the answer, with 0 if none. |
| `setMuted(userId, chatId, muted)` | Insert or delete the mute row. |
| `isMuted(userId, chatId)` | Whether a mute row exists. |

### SQL for the suggested schema

`CHAT_SQLITE_SCHEMA` creates `chats`, `chat_messages` (with an index on `chat_id, created_at`), `chat_reads` and `chat_mutes`. Apply it with `db.exec(CHAT_SQLITE_SCHEMA)` if it fits. `chats` needs your own owner column (for example `group_id`). `user_id` has no foreign key in the suggestion. Add `REFERENCES users(id) ON DELETE CASCADE` if you have a users table. The examples use `node:sqlite` style placeholders and assume `users(id, name)`.

`listMessages(chatId, limit)`: take the newest rows, then put them oldest first.

    SELECT id, chat_id AS chatId, user_id AS userId, userName, body, created_at AS createdAt
    FROM (
      SELECT m.id, m.chat_id, m.user_id, u.name AS userName, m.body, m.created_at
      FROM chat_messages m
      JOIN users u ON u.id = m.user_id
      WHERE m.chat_id = ?
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT ?
    )
    ORDER BY created_at ASC, id ASC;

If you do not have a `users` row for every author, use `LEFT JOIN` and `COALESCE(u.name, '')`.

`insertMessage(message)`:

    INSERT INTO chat_messages (id, chat_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?);

`setReadAt(userId, chatId, at)`:

    INSERT INTO chat_reads (user_id, chat_id, read_at) VALUES (?, ?, ?)
    ON CONFLICT (user_id, chat_id) DO UPDATE SET read_at = excluded.read_at;

`unreadCounts(userId, chatIds)`: one query for all ids, then fill 0 for the ids that have no row.

    SELECT m.chat_id AS chatId, COUNT(*) AS n
    FROM chat_messages m
    LEFT JOIN chat_reads r ON r.chat_id = m.chat_id AND r.user_id = ?
    WHERE m.chat_id IN (?, ?, ...)            -- one placeholder per id
      AND m.user_id <> ?
      AND m.created_at > COALESCE(r.read_at, 0)
    GROUP BY m.chat_id;

`setMuted(userId, chatId, muted)`:

    -- muted = true
    INSERT OR IGNORE INTO chat_mutes (user_id, chat_id) VALUES (?, ?);
    -- muted = false
    DELETE FROM chat_mutes WHERE user_id = ? AND chat_id = ?;

`isMuted(userId, chatId)`:

    SELECT 1 FROM chat_mutes WHERE user_id = ? AND chat_id = ?;   -- a row means muted

## Push batcher

`createChatPushBatcher({ send, stillEligible?, format?, windowMs?, gapMs?, now?, setTimer?, clearTimer?, log? })` returns `{ schedule, flush, pending, dispose }`. It throws `TypeError` if `send` is missing.

    const batcher = createChatPushBatcher({
      send: (push) => webPush.sendTo(push.userId, { title: groupName(push.chatId), body: push.body }),
      stillEligible: async (chatId, userId) => isMember(chatId, userId) && !(await store.isMuted(userId, chatId)),
    });

    // after a successful chat.post(...)
    batcher.schedule({ chatId, recipients: memberIds.filter((id) => id !== user.id && !muted.has(id)), body: `${user.name}: ${message.body}` });

    // on shutdown
    await batcher.flush(true);
    batcher.dispose();

Semantics:

- **One slot per recipient and chat.** `schedule` opens a slot for each recipient, or adds 1 to the count of the slot that is already open. The first message's preview (cut to 140 characters, by code points) is kept as `firstBody`.
- **Window.** A new slot fires after `CHAT_PUSH_WINDOW_MS` (15 s). Messages that arrive before it fires only raise the count.
- **Gap.** Two pushes to the same recipient for the same chat are at least `CHAT_PUSH_GAP_MS` (60 s) apart. If the last push was less than the gap ago, the slot waits for the rest of the gap, but never less than the window. A different chat or a different recipient is not held back. `nextChatPushDelay(lastSentAt, now, windowMs, gapMs)` is that rule as a function.
- **The push.** `send` gets `{ chatId, userId, count, firstBody, body }`. `body` is `firstBody` for one message and `"{count} new messages"` for more, unless you pass `format(count, firstBody)`.
- **Eligibility.** `stillEligible(chatId, userId)` is asked when the slot fires. If it answers false, the slot is dropped, nothing is sent, and no gap is recorded. Use it for "left the group" and "muted since".
- **Errors.** A `send` or `stillEligible` that throws or rejects is caught. It is logged as `chat: push failed (<ErrorName>)`, with the error name only and never the message, and the slot is dropped. A failed timer never becomes an unhandled rejection. `log` defaults to `console.error`.
- **flush.** `flush()` fires the slots that are due. `flush(true)` fires every slot at once, for shutdown. A slot that is busy sending is never fired twice.
- **dispose.** Clears all timers and drops all slots. A send that is in the middle of its eligibility check is aborted.
- **Timers.** The default timer is `setTimeout`, unref'd, so a pending slot does not keep the process alive. Pass `setTimer` and `clearTimer` and `now` for tests. In-memory only: a restart drops open slots.

## Frontend

    <link rel="stylesheet" href="/app-kit/ak-tokens.css">
    <link rel="stylesheet" href="/app-kit/ak-chat.css">
    <script src="/app-kit/ak-chat.js"></script>

ES5, no build step, adds only `window.AppKit.chat`. The CSS uses kit tokens only, so light and dark come from `ak-tokens.css`.

    var chat = AppKit.chat.mount(document.getElementById('pane'), {
      meId: me.id,
      load: function () { return api('/api/groups/' + id + '/chat'); },        // { messages } or an array
      send: function (text) { return api('/api/groups/' + id + '/chat', { text: text }); },   // the saved message
      markRead: function () { return api('/api/groups/' + id + '/chat/read', {}); }
    });
    // later: chat.destroy();

`mount(el, opts)` builds a `.ak-chat` wrapper inside `el`, loads once, then polls. It throws `TypeError` if `el`, `meId`, `load` or `send` is missing. It returns `{ refresh, setMessages, send, destroy }`.

| Option | Default | Meaning |
| --- | --- | --- |
| `meId` | required | Your user id. Your messages are `.is-me`. |
| `load()` | required | A Promise of `{ messages: [...] }` or an array of `{ id, userId, userName, body, createdAt }`. A rejected load is ignored and the poller tries again. A slow older load never overwrites a newer one. |
| `send(text)` | required | A Promise of the saved message. A rejection marks the bubble failed. |
| `markRead()` | none | Called after a load that brought new messages from others, while the page is visible. If the page is hidden it waits until the next load while visible. |
| `poll` | on | `false` turns polling off. |
| `pollMs` | 3000 | Poll interval. |
| `maxLength` | 1000 | Longer text disables the send button. Counted in code points. |
| `placeholder` | `Message` | Textarea placeholder. |
| `labels` | `{ send: 'Send', sending: 'Sending…', failed: 'Not sent. Tap to retry.', empty: 'No messages yet.' }` | Any key may be replaced. |
| `formatTime(ms)` | `HH:MM` | Time under a saved bubble. |

Controller: `refresh()` loads now and returns a Promise that never rejects. `setMessages(list)` replaces the server part of the list. `send(text)` sends as if typed. `destroy()` stops the poller, removes the listeners and the DOM it created. After `destroy` every call does nothing.

Behaviour:

- Text is always set with `textContent`. Newlines show through `white-space: pre-wrap`.
- Enter sends, Shift+Enter is a newline, Enter while composing (IME) does nothing. The send button is disabled for empty or over-long text.
- A send shows a `.is-pending` bubble at once and clears the input. Sends go out one at a time, in order. On success the bubble becomes the saved message. A message that also comes back from the poll is shown once. On a rejection the bubble is `.is-failed` with `role="button"` and `tabindex="0"`. A tap, Enter or Space retries it. Local pending and failed bubbles stay after the server messages.
- The list sticks to the bottom on your own send, on the first load, and on new messages when you were within 80px of the bottom. Otherwise the scroll position is left alone. When the pane gets shorter (the keyboard opens, a window or `visualViewport` resize), a list that was at the bottom stays there.
- The list is rebuilt only when the messages or their states change.

Classes: `.ak-chat`, `.ak-chat-list`, `.ak-chat-empty`, `.ak-chat-msg` with `.is-me`, `.is-them`, `.is-pending`, `.is-failed`, `.ak-chat-name` (only on the first message of a run from another user), `.ak-chat-body`, `.ak-chat-time`, `.ak-chat-note`, `.ak-chat-composer`, `.ak-chat-input`, `.ak-chat-send`. The pane fills its parent (`height: 100%`), so give the host element a height. The textarea font is at least 16px so iOS does not zoom, and the composer respects the safe-area insets.

### AppKit.chat.poll

`AppKit.chat.poll(fn, { ms: 3000 })` returns `{ start, stop, running }`. It calls `fn` every `ms`, never overlaps (it waits for a returned Promise), ignores errors, pauses while `document.hidden`, runs `fn` at once when the page is visible again, and `stop()` removes its `visibilitychange` listener. `mount` uses it.

## Wiring example

The routes are the app's. Each one checks the membership first. These are the group routes of an app with one chat per group (Loan some):

| Route | Calls |
| --- | --- |
| `GET /api/groups/:id/chat` | `chat.thread(chatIdOf(id), user.id)` |
| `POST /api/groups/:id/chat` | `chat.post(...)`, then `batcher.schedule(...)` on success. 400 with `reason` otherwise. |
| `POST /api/groups/:id/chat/read` | `chat.markRead(...)` |
| `POST /api/groups/:id/chat/mute` | `chat.setMuted(...)` |
| `GET /api/chat/unread?ids=a,b` | `chat.unreadCounts(user.id, ids)`, with the ids filtered to the groups the user is in. |

Mapping note: a Hangry circle chat is the same thing as one Loan some group chat. Use the circle or group id (or a `chats.id` row that has a `group_id` column) as `chatId`. Extrablatt is Java and does not take the TypeScript module.
