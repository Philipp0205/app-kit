import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEnv } from './helpers/fake-dom.mjs';

function tick() {
  return new Promise(function (resolve) { setImmediate(resolve); });
}

async function settle() {
  for (var i = 0; i < 6; i++) await tick();
}

function deferred() {
  var d = {};
  d.promise = new Promise(function (resolve, reject) { d.resolve = resolve; d.reject = reject; });
  return d;
}

function msg(id, userId, userName, body, at) {
  return { id: id, userId: userId, userName: userName, body: body, createdAt: at || 1000 };
}

// Mounts a chat in a fresh fake page. Polling is off unless the test asks for it.
async function setup(options) {
  var o = options || {};
  var env = createEnv();
  env.load('ak-chat.js');
  var host = env.document.createElement('div');
  env.body.appendChild(host);
  var calls = { load: 0, send: [], markRead: 0 };
  var current = o.messages || [];
  var opts = {
    meId: 'me',
    poll: o.poll === true ? undefined : false,
    load: function () { calls.load += 1; return Promise.resolve({ messages: current.slice() }); },
    send: o.send || function (text) {
      calls.send.push(text);
      return Promise.resolve(msg('srv-' + calls.send.length, 'me', 'Me', text, 2000));
    },
    markRead: function () { calls.markRead += 1; return Promise.resolve(); },
    formatTime: function () { return '10:00'; }
  };
  Object.keys(o.opts || {}).forEach(function (k) { opts[k] = o.opts[k]; });
  var chat = env.window.AppKit.chat.mount(host, opts);
  await settle();
  var q = function (sel) { return env.document.querySelector(sel); };
  return {
    env: env,
    host: host,
    chat: chat,
    calls: calls,
    q: q,
    all: function (sel) { return env.document.querySelectorAll(sel); },
    input: q('.ak-chat-input'),
    button: q('.ak-chat-send'),
    form: q('.ak-chat-composer'),
    list: q('.ak-chat-list'),
    setServer: function (list) { current = list; },
    type: function (text) {
      var input = q('.ak-chat-input');
      input.value = text;
      input.dispatch('input', {});
    },
    key: function (key, extra) {
      var event = Object.assign({ key: key, shiftKey: false, prevented: false, preventDefault: function () { this.prevented = true; } }, extra || {});
      q('.ak-chat-input').dispatch('keydown', event);
      return event;
    }
  };
}

// ---------- structure and rendering ----------

test('chat: mount builds .ak-chat with a log list and a composer', async function () {
  var t = await setup();
  var root = t.q('.ak-chat');
  assert.ok(root);
  assert.equal(root.parentNode, t.host);
  assert.equal(t.list.getAttribute('role'), 'log');
  assert.equal(t.list.getAttribute('aria-live'), 'polite');
  assert.equal(t.form.tagName, 'FORM');
  assert.equal(t.input.tagName, 'TEXTAREA');
  assert.equal(t.input.getAttribute('placeholder'), 'Message');
  assert.equal(t.button.textContent, 'Send');
  assert.equal(t.button.disabled, true);
  assert.equal(t.q('.ak-chat-empty').textContent, 'No messages yet.');
});

test('chat: bubbles are me and them, the name shows only on the first of a run', async function () {
  var t = await setup({
    messages: [
      msg('1', 'ana', 'Ana', 'one', 1000),
      msg('2', 'ana', 'Ana', 'two', 2000),
      msg('3', 'me', 'Me', 'three', 3000),
      msg('4', 'ben', 'Ben', 'four', 4000),
      msg('5', 'ana', 'Ana', 'five', 5000),
      msg('6', 'ana', 'Ana', 'six', 6000)
    ]
  });
  var bubbles = t.all('.ak-chat-msg');
  assert.equal(bubbles.length, 6);
  assert.deepEqual(bubbles.map(function (b) { return /\bis-me\b/.test(b.className) ? 'me' : 'them'; }),
    ['them', 'them', 'me', 'them', 'them', 'them']);
  var named = bubbles.map(function (b) {
    var name = b.querySelector('.ak-chat-name');
    return name ? name.textContent : null;
  });
  assert.deepEqual(named, ['Ana', null, null, 'Ben', 'Ana', null]);
  assert.equal(bubbles[0].querySelector('.ak-chat-body').textContent, 'one');
  assert.equal(bubbles[0].querySelector('.ak-chat-time').textContent, '10:00');
  assert.equal(t.q('.ak-chat-empty'), null);
});

test('chat: load may return a plain array', async function () {
  var t = await setup({ opts: { load: function () { return Promise.resolve([msg('1', 'ana', 'Ana', 'hi')]); } } });
  assert.equal(t.all('.ak-chat-msg').length, 1);
});

test('chat: text is never parsed as HTML', async function () {
  var t = await setup({ messages: [msg('1', 'ana', '<i>Ana</i>', '<b>x</b>')] });
  assert.equal(t.q('.ak-chat-body').textContent, '<b>x</b>');
  assert.equal(t.q('.ak-chat-name').textContent, '<i>Ana</i>');
  assert.equal(t.all('b').length, 0);
  assert.equal(t.all('i').length, 0);
  assert.equal(t.list.innerHTML, '');
});

test('chat: mount checks its options', function () {
  var env = createEnv();
  env.load('ak-chat.js');
  var host = env.document.createElement('div');
  var chat = env.window.AppKit.chat;
  var ok = { meId: 'me', load: function () {}, send: function () {} };
  // The error comes from the sandbox realm, so check its name instead of instanceof.
  function typeError(error) { return error && error.name === 'TypeError'; }
  assert.throws(function () { chat.mount(null, ok); }, typeError);
  assert.throws(function () { chat.mount(host, { load: ok.load, send: ok.send }); }, typeError);
  assert.throws(function () { chat.mount(host, { meId: 'me', send: ok.send }); }, typeError);
  assert.throws(function () { chat.mount(host, { meId: 'me', load: ok.load }); }, typeError);
});

test('chat: loading twice keeps one AppKit.chat', function () {
  var env = createEnv();
  env.load('ak-chat.js');
  var first = env.window.AppKit.chat;
  env.load('ak-chat.js');
  assert.equal(env.window.AppKit.chat, first);
});

// ---------- sending ----------

test('chat: send appends a pending bubble at once, clears the input, then swaps in the saved message', async function () {
  var gate = deferred();
  var t = await setup({ send: function () { return gate.promise; } });
  t.type('hello');
  assert.equal(t.button.disabled, false);
  t.form.dispatch('submit', { preventDefault: function () {} });
  assert.equal(t.input.value, '');
  assert.equal(t.button.disabled, true);
  var bubbles = t.all('.ak-chat-msg');
  assert.equal(bubbles.length, 1);
  assert.match(bubbles[0].className, /\bis-me\b/);
  assert.match(bubbles[0].className, /\bis-pending\b/);
  assert.equal(bubbles[0].querySelector('.ak-chat-body').textContent, 'hello');
  assert.equal(bubbles[0].querySelector('.ak-chat-note').textContent, 'Sending\u2026');

  gate.resolve(msg('srv-1', 'me', 'Me', 'hello', 2000));
  await settle();
  bubbles = t.all('.ak-chat-msg');
  assert.equal(bubbles.length, 1);
  assert.doesNotMatch(bubbles[0].className, /is-pending/);
  assert.equal(bubbles[0].querySelector('.ak-chat-time').textContent, '10:00');
});

test('chat: a polled copy of a sent message does not show twice', async function () {
  var t = await setup();
  await t.chat.send('hello');
  await settle();
  assert.equal(t.all('.ak-chat-msg').length, 1);
  t.setServer([msg('srv-1', 'me', 'Me', 'hello', 2000)]);
  await t.chat.refresh();
  assert.equal(t.all('.ak-chat-msg').length, 1);
  await t.chat.refresh();
  assert.equal(t.all('.ak-chat-msg').length, 1);
});

test('chat: a rejected send becomes failed, and a tap retries it', async function () {
  var attempts = 0;
  var t = await setup({
    send: function (text) {
      attempts += 1;
      return attempts === 1 ? Promise.reject(new Error('offline')) : Promise.resolve(msg('srv-1', 'me', 'Me', text, 2000));
    }
  });
  await t.chat.send('hello');
  await settle();
  var bubble = t.q('.ak-chat-msg');
  assert.match(bubble.className, /\bis-failed\b/);
  assert.equal(bubble.getAttribute('role'), 'button');
  assert.equal(bubble.getAttribute('tabindex'), '0');
  assert.equal(bubble.querySelector('.ak-chat-note').textContent, 'Not sent. Tap to retry.');

  bubble.click();
  assert.match(t.q('.ak-chat-msg').className, /\bis-pending\b/);
  await settle();
  assert.equal(attempts, 2);
  bubble = t.q('.ak-chat-msg');
  assert.doesNotMatch(bubble.className, /is-failed|is-pending/);
  assert.equal(t.all('.ak-chat-msg').length, 1);
});

test('chat: Enter and Space on a failed bubble retry it too', async function () {
  var attempts = 0;
  var t = await setup({
    send: function () {
      attempts += 1;
      return Promise.reject(new Error('offline'));
    }
  });
  await t.chat.send('hello');
  await settle();
  t.q('.ak-chat-msg').dispatch('keydown', { key: 'Enter', preventDefault: function () {} });
  await settle();
  assert.equal(attempts, 2);
  t.q('.ak-chat-msg').dispatch('keydown', { key: ' ', preventDefault: function () {} });
  await settle();
  assert.equal(attempts, 3);
  t.q('.ak-chat-msg').dispatch('keydown', { key: 'a', preventDefault: function () {} });
  await settle();
  assert.equal(attempts, 3);
});

test('chat: sends go out one at a time, in order', async function () {
  var gates = [];
  var started = [];
  var t = await setup({
    send: function (text) {
      started.push(text);
      var gate = deferred();
      gates.push(gate);
      return gate.promise;
    }
  });
  t.chat.send('one');
  t.chat.send('two');
  await settle();
  assert.deepEqual(started, ['one']);
  assert.equal(t.all('.ak-chat-msg').length, 2);
  gates[0].resolve(msg('s1', 'me', 'Me', 'one'));
  await settle();
  assert.deepEqual(started, ['one', 'two']);
  gates[1].resolve(msg('s2', 'me', 'Me', 'two'));
  await settle();
  assert.deepEqual(t.all('.ak-chat-body').map(function (b) { return b.textContent; }), ['one', 'two']);
});

test('chat: a failed message does not hold up the next one', async function () {
  var t = await setup({
    send: function (text) {
      return text === 'bad' ? Promise.reject(new Error('x')) : Promise.resolve(msg('s-' + text, 'me', 'Me', text));
    }
  });
  t.chat.send('bad');
  t.chat.send('good');
  await settle();
  // Saved messages come before the local ones, so the failed one ends up last.
  var classes = t.all('.ak-chat-msg').map(function (b) { return /is-failed/.test(b.className) ? 'failed' : 'ok'; });
  assert.deepEqual(classes, ['ok', 'failed']);
  assert.deepEqual(t.all('.ak-chat-body').map(function (b) { return b.textContent; }), ['good', 'bad']);
});

test('chat: empty and over-max text is not sent', async function () {
  var t = await setup({ opts: { maxLength: 5 } });
  t.type('   ');
  assert.equal(t.button.disabled, true);
  t.key('Enter');
  t.type('123456');
  assert.equal(t.button.disabled, true);
  t.key('Enter');
  t.form.dispatch('submit', { preventDefault: function () {} });
  await t.chat.send('   ');
  await t.chat.send('123456');
  assert.deepEqual(t.calls.send, []);
  assert.equal(t.all('.ak-chat-msg').length, 0);
  t.type('12345');
  assert.equal(t.button.disabled, false);
});

test('chat: the length limit counts code points', async function () {
  var t = await setup({ opts: { maxLength: 3 } });
  t.type('\u{1F600}\u{1F600}\u{1F600}');
  assert.equal(t.button.disabled, false);
  t.type('\u{1F600}\u{1F600}\u{1F600}\u{1F600}');
  assert.equal(t.button.disabled, true);
});

test('chat: Enter sends, Shift+Enter does not, and Enter while composing does not', async function () {
  var t = await setup();
  t.type('hello');
  var shift = t.key('Enter', { shiftKey: true });
  assert.equal(shift.prevented, false);
  assert.deepEqual(t.calls.send, []);
  assert.equal(t.input.value, 'hello');

  var composing = t.key('Enter', { isComposing: true });
  assert.equal(composing.prevented, false);
  var ime = t.key('Enter', { keyCode: 229 });
  assert.equal(ime.prevented, false);
  assert.deepEqual(t.calls.send, []);

  var enter = t.key('Enter');
  assert.equal(enter.prevented, true);
  await settle();
  assert.deepEqual(t.calls.send, ['hello']);
  assert.equal(t.input.value, '');

  t.type('other key');
  var letter = t.key('a');
  assert.equal(letter.prevented, false);
});

test('chat: the text is trimmed before it is sent', async function () {
  var t = await setup();
  t.type('  hi  ');
  t.key('Enter');
  await settle();
  assert.deepEqual(t.calls.send, ['hi']);
});

test('chat: custom labels, placeholder and formatTime', async function () {
  var t = await setup({
    messages: [msg('1', 'ana', 'Ana', 'x', 5)],
    opts: { placeholder: 'Write', labels: { send: 'Go', empty: 'Nothing' }, formatTime: function (ms) { return 't' + ms; } }
  });
  assert.equal(t.input.getAttribute('placeholder'), 'Write');
  assert.equal(t.button.textContent, 'Go');
  assert.equal(t.q('.ak-chat-time').textContent, 't5');
});

// ---------- markRead and scrolling ----------

test('chat: markRead runs once after a load with new messages from others, only while visible', async function () {
  var t = await setup({ messages: [msg('1', 'ana', 'Ana', 'hi')] });
  assert.equal(t.calls.markRead, 1);
  await t.chat.refresh();
  assert.equal(t.calls.markRead, 1);
  t.setServer([msg('1', 'ana', 'Ana', 'hi'), msg('2', 'me', 'Me', 'mine')]);
  await t.chat.refresh();
  assert.equal(t.calls.markRead, 1);
  t.setServer([msg('1', 'ana', 'Ana', 'hi'), msg('2', 'me', 'Me', 'mine'), msg('3', 'ana', 'Ana', 'new')]);
  await t.chat.refresh();
  assert.equal(t.calls.markRead, 2);
});

test('chat: markRead waits while the page is hidden', async function () {
  var t = await setup();
  t.env.document.hidden = true;
  t.setServer([msg('1', 'ana', 'Ana', 'hi')]);
  await t.chat.refresh();
  assert.equal(t.calls.markRead, 0);
  t.env.document.hidden = false;
  await t.chat.refresh();
  assert.equal(t.calls.markRead, 1);
});

test('chat: it sticks to the bottom for new messages only when you were near it', async function () {
  var t = await setup({ messages: [msg('1', 'ana', 'Ana', 'hi')] });
  t.list.scrollHeight = 1000;
  t.list.clientHeight = 400;

  t.list.scrollTop = 560; // 40px from the bottom
  t.setServer([msg('1', 'ana', 'Ana', 'hi'), msg('2', 'ana', 'Ana', 'again')]);
  await t.chat.refresh();
  assert.equal(t.list.scrollTop, 1000);

  t.list.scrollTop = 100; // far up
  t.setServer([msg('1', 'ana', 'Ana', 'hi'), msg('2', 'ana', 'Ana', 'again'), msg('3', 'ana', 'Ana', 'more')]);
  await t.chat.refresh();
  assert.equal(t.list.scrollTop, 100);

  t.list.scrollTop = 100; // own send always sticks
  await t.chat.send('mine');
  assert.equal(t.list.scrollTop, 1000);
});

test('chat: setMessages replaces the server part and keeps local messages after it', async function () {
  var t = await setup({ send: function () { return new Promise(function () {}); } });
  t.chat.send('waiting');
  t.chat.setMessages([msg('1', 'ana', 'Ana', 'a'), msg('2', 'ana', 'Ana', 'b')]);
  var bodies = t.all('.ak-chat-body').map(function (b) { return b.textContent; });
  assert.deepEqual(bodies, ['a', 'b', 'waiting']);
  t.chat.setMessages([msg('2', 'ana', 'Ana', 'b')]);
  bodies = t.all('.ak-chat-body').map(function (b) { return b.textContent; });
  assert.deepEqual(bodies, ['b', 'waiting']);
});

// ---------- poll ----------

function pollEnv() {
  var env = createEnv();
  env.load('ak-chat.js');
  return env;
}

test('poll: calls fn every ms and stop() removes the listener', async function () {
  var env = pollEnv();
  var calls = 0;
  var p = env.window.AppKit.chat.poll(function () { calls += 1; }, { ms: 3000 });
  assert.equal(p.running(), false);
  p.start();
  assert.equal(p.running(), true);
  assert.equal(env.docHandlerCount('visibilitychange'), 1);
  assert.equal(env.timers[env.timers.length - 1].ms, 3000);
  env.runTimers();
  await settle();
  assert.equal(calls, 1);
  env.runTimers();
  await settle();
  assert.equal(calls, 2);
  p.stop();
  assert.equal(p.running(), false);
  assert.equal(env.docHandlerCount('visibilitychange'), 0);
  env.runTimers();
  await settle();
  assert.equal(calls, 2);
});

test('poll: it pauses while hidden and runs at once when visible again', async function () {
  var env = pollEnv();
  var calls = 0;
  var p = env.window.AppKit.chat.poll(function () { calls += 1; }, { ms: 3000 });
  p.start();
  env.document.hidden = true;
  env.fireDocument('visibilitychange');
  env.runTimers(); // the timer that was already armed must not fire fn
  await settle();
  assert.equal(calls, 0);
  assert.equal(env.timers.length, 0);

  env.document.hidden = false;
  env.fireDocument('visibilitychange');
  await settle();
  assert.equal(calls, 1);
  assert.equal(env.timers.length, 1);
  p.stop();
});

test('poll: starting while hidden waits for the page to be visible', async function () {
  var env = pollEnv();
  var calls = 0;
  env.document.hidden = true;
  var p = env.window.AppKit.chat.poll(function () { calls += 1; });
  p.start();
  assert.equal(env.timers.length, 0);
  env.document.hidden = false;
  env.fireDocument('visibilitychange');
  await settle();
  assert.equal(calls, 1);
  p.stop();
});

test('poll: it never overlaps, it waits for a returned promise', async function () {
  var env = pollEnv();
  var gate = deferred();
  var calls = 0;
  var p = env.window.AppKit.chat.poll(function () { calls += 1; return gate.promise; }, { ms: 3000 });
  p.start();
  env.runTimers();
  await settle();
  assert.equal(calls, 1);
  assert.equal(env.timers.length, 0);
  env.fireDocument('visibilitychange'); // visible again while the first call is still running
  await settle();
  assert.equal(calls, 1);
  gate.resolve();
  await settle();
  assert.equal(env.timers.length, 1);
  env.runTimers();
  await settle();
  assert.equal(calls, 2);
  p.stop();
});

test('poll: a throwing or rejecting fn does not stop the poller', async function () {
  var env = pollEnv();
  var calls = 0;
  var p = env.window.AppKit.chat.poll(function () {
    calls += 1;
    if (calls === 1) throw new Error('sync');
    return Promise.reject(new Error('async'));
  }, { ms: 10 });
  p.start();
  env.runTimers();
  await settle();
  env.runTimers();
  await settle();
  env.runTimers();
  await settle();
  assert.equal(calls, 3);
  assert.equal(p.running(), true);
  p.stop();
});

// ---------- mount with polling, destroy ----------

test('chat: mount polls with pollMs and destroy stops it', async function () {
  var t = await setup({ poll: true, opts: { pollMs: 1234 } });
  assert.equal(t.calls.load, 1);
  assert.equal(t.env.timers[t.env.timers.length - 1].ms, 1234);
  t.env.runTimers();
  await settle();
  assert.equal(t.calls.load, 2);
  assert.equal(t.env.docHandlerCount('visibilitychange'), 1);

  t.chat.destroy();
  assert.equal(t.env.docHandlerCount('visibilitychange'), 0);
  t.env.runTimers();
  await settle();
  assert.equal(t.calls.load, 2);
});

test('chat: poll defaults to 3000 ms and poll: false never polls', async function () {
  var on = await setup({ poll: true });
  assert.equal(on.env.timers[on.env.timers.length - 1].ms, 3000);
  var off = await setup();
  assert.equal(off.env.timers.length, 0);
  assert.equal(off.env.docHandlerCount('visibilitychange'), 0);
});

test('chat: destroy removes its DOM and listeners, and later calls do nothing', async function () {
  var t = await setup({ messages: [msg('1', 'ana', 'Ana', 'hi')] });
  var input = t.input;
  var form = t.form;
  t.chat.destroy();
  assert.equal(t.q('.ak-chat'), null);
  assert.equal(t.host.children.length, 0);
  assert.equal((input.listeners.input || []).length, 0);
  assert.equal((input.listeners.keydown || []).length, 0);
  assert.equal((form.listeners.submit || []).length, 0);
  await t.chat.send('late');
  await t.chat.refresh();
  t.chat.setMessages([msg('9', 'ana', 'Ana', 'x')]);
  t.chat.destroy();
  assert.deepEqual(t.calls.send, []);
  assert.equal(t.q('.ak-chat'), null);
});

test('chat: destroy while a send is in flight is quiet', async function () {
  var gate = deferred();
  var t = await setup({ send: function () { return gate.promise; } });
  t.chat.send('hello');
  t.chat.destroy();
  gate.resolve(msg('s1', 'me', 'Me', 'hello'));
  await settle();
  assert.equal(t.q('.ak-chat'), null);
});

test('chat: a slow older load never overwrites a newer one', async function () {
  var gates = [deferred(), deferred()];
  var n = -1; // the first load, from mount, answers at once; the next two wait on the gates
  var t = await setup({
    opts: {
      load: function () {
        n += 1;
        return n === 0 ? Promise.resolve([]) : gates[n - 1].promise;
      }
    }
  });
  var a = t.chat.refresh();
  var b = t.chat.refresh();
  gates[1].resolve({ messages: [msg('new', 'ana', 'Ana', 'newer')] });
  await b;
  gates[0].resolve({ messages: [msg('old', 'ana', 'Ana', 'older')] });
  await a;
  assert.deepEqual(t.all('.ak-chat-body').map(function (x) { return x.textContent; }), ['newer']);
});
