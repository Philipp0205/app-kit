// A tiny fake browser for the kit tests. It runs a frontend script in a vm
// sandbox with just enough window and document for the kit to work.
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

var ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// One simple selector: tag, .class, #id and [attr="value"] parts, in any mix.
function parseSelector(selector) {
  var rest = selector.trim();
  var sel = { tag: null, classes: [], id: null, attrs: [] };
  var tag = /^[a-zA-Z][\w-]*/.exec(rest);
  if (tag) {
    sel.tag = tag[0].toLowerCase();
    rest = rest.slice(tag[0].length);
  }
  while (rest) {
    var m;
    if ((m = /^\.([\w-]+)/.exec(rest))) {
      sel.classes.push(m[1]);
    } else if ((m = /^#([\w-]+)/.exec(rest))) {
      sel.id = m[1];
    } else if ((m = /^\[([\w-]+)(?:="([^"]*)")?\]/.exec(rest))) {
      sel.attrs.push([m[1], m[2]]);
    } else {
      throw new Error('fake dom: unsupported selector ' + selector);
    }
    rest = rest.slice(m[0].length);
  }
  return sel;
}

class FakeNode {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.nodeType = 1;
    this.attributes = {};
    this.childNodes = [];
    this.parentNode = null;
    this.listeners = {};
    this.className = '';
    this.id = '';
    this.disabled = false;
    this.innerHTML = '';
  }
  get firstChild() { return this.childNodes[0] || null; }
  get children() { return this.childNodes.filter(function (n) { return n.nodeType === 1; }); }
  get textContent() {
    return this.childNodes.map(function (n) { return n.textContent; }).join('');
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === 'class') this.className = String(value);
    if (name === 'id') this.id = String(value);
  }
  getAttribute(name) {
    if (name === 'class' && this.className) return this.className;
    if (name === 'id' && this.id) return this.id;
    return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
  }
  hasAttribute(name) { return this.getAttribute(name) !== null; }
  removeAttribute(name) { delete this.attributes[name]; }
  appendChild(node) { return this.insertBefore(node, null); }
  insertBefore(node, ref) {
    if (node.parentNode) node.parentNode.removeChild(node);
    var at = ref ? this.childNodes.indexOf(ref) : -1;
    if (at < 0) this.childNodes.push(node); else this.childNodes.splice(at, 0, node);
    node.parentNode = this;
    return node;
  }
  removeChild(node) {
    var at = this.childNodes.indexOf(node);
    if (at < 0) throw new Error('fake dom: not a child');
    this.childNodes.splice(at, 1);
    node.parentNode = null;
    return node;
  }
  addEventListener(type, fn) {
    (this.listeners[type] = this.listeners[type] || []).push(fn);
  }
  click() { this.dispatch('click', {}); }
  dispatch(type, event) {
    var self = this;
    (this.listeners[type] || []).slice().forEach(function (fn) { fn.call(self, event); });
  }
  matches(selector) {
    var sel = parseSelector(selector);
    if (sel.tag && sel.tag !== this.tagName.toLowerCase()) return false;
    if (sel.id && sel.id !== this.id) return false;
    var own = this.className.split(/\s+/);
    for (var i = 0; i < sel.classes.length; i++) {
      if (own.indexOf(sel.classes[i]) < 0) return false;
    }
    for (var j = 0; j < sel.attrs.length; j++) {
      var value = this.getAttribute(sel.attrs[j][0]);
      if (value === null || (sel.attrs[j][1] !== undefined && value !== sel.attrs[j][1])) return false;
    }
    return true;
  }
  descendants() {
    var out = [];
    this.children.forEach(function (child) {
      out.push(child);
      out = out.concat(child.descendants());
    });
    return out;
  }
  querySelectorAll(selector) {
    return this.descendants().filter(function (n) { return n.matches(selector); });
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

class FakeText {
  constructor(text) { this.nodeType = 3; this.textContent = text; this.parentNode = null; }
}

function fakeStorage() {
  var data = {};
  return {
    data: data,
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
    setItem: function (k, v) { data[k] = String(v); },
    removeItem: function (k) { delete data[k]; },
    get length() { return Object.keys(data).length; },
    key: function (i) { return Object.keys(data)[i] || null; }
  };
}

/*
 * Builds a sandbox. Options:
 *   media        { query: boolean } what matchMedia(query).matches answers
 *   noMatchMedia leave matchMedia out
 *   legacyMedia  media lists only have addListener
 *   htmlClass    class of <html>
 *   htmlBg, bodyBg   computed background colours
 *   metas        [{ content, media }] theme-color metas to put in the head
 *   userAgent, maxTouchPoints, standalone
 *   bodyless     no <body> yet
 */
export function createEnv(options) {
  var o = options || {};
  var document = {};
  var html = new FakeNode('html');
  var head = new FakeNode('head');
  var body = o.bodyless ? null : new FakeNode('body');
  html.className = o.htmlClass || '';
  html.appendChild(head);
  if (body) html.appendChild(body);
  html._bg = o.htmlBg;
  if (body) body._bg = o.bodyBg;

  (o.metas || []).forEach(function (m) {
    var meta = new FakeNode('meta');
    meta.setAttribute('name', 'theme-color');
    if (m.content !== undefined) meta.setAttribute('content', m.content);
    if (m.media) meta.setAttribute('media', m.media);
    head.appendChild(meta);
  });

  var docListeners = {};
  document.documentElement = html;
  document.head = head;
  document.body = body;
  document.readyState = 'complete';
  document.createElement = function (tag) { return new FakeNode(tag); };
  document.createTextNode = function (text) { return new FakeText(text); };
  document.querySelectorAll = function (s) { return html.querySelectorAll(s); };
  document.querySelector = function (s) { return html.querySelector(s); };
  document.getElementById = function (id) { return html.querySelector('#' + id); };
  document.getElementsByTagName = function (t) { return html.querySelectorAll(t); };
  document.addEventListener = function (type, fn) {
    (docListeners[type] = docListeners[type] || []).push(fn);
  };

  var winListeners = {};
  var lists = {};
  var frames = [];
  var matches = o.media || {};
  var sandbox = {
    document: document,
    navigator: {
      userAgent: o.userAgent || 'Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile Safari/537.36',
      maxTouchPoints: o.maxTouchPoints || 0
    },
    sessionStorage: fakeStorage(),
    localStorage: fakeStorage(),
    addEventListener: function (type, fn) {
      (winListeners[type] = winListeners[type] || []).push(fn);
    },
    getComputedStyle: function (el) { return { backgroundColor: el._bg || 'rgba(0, 0, 0, 0)' }; },
    requestAnimationFrame: function (fn) { frames.push(fn); return frames.length; }
  };
  if (o.standalone !== undefined) sandbox.navigator.standalone = o.standalone;
  if (!o.noMatchMedia) {
    sandbox.matchMedia = function (query) {
      if (!lists[query]) {
        var list = { media: query, handlers: [], get matches() { return !!matches[query]; } };
        if (o.legacyMedia) {
          list.addListener = function (fn) { list.handlers.push(fn); };
        } else {
          list.addEventListener = function (type, fn) {
            if (type === 'change') list.handlers.push(fn);
          };
        }
        lists[query] = list;
      }
      return lists[query];
    };
  }
  sandbox.window = sandbox;
  vm.createContext(sandbox);

  return {
    window: sandbox,
    document: document,
    html: html,
    head: head,
    body: body,
    // Loads a file from frontend/ into the sandbox.
    load: function (file) {
      var code = fs.readFileSync(path.join(ROOT, 'frontend', file), 'utf8');
      vm.runInContext(code, sandbox, { filename: file });
    },
    themeMetas: function () { return html.querySelectorAll('meta[name="theme-color"]'); },
    // The queries that have a change handler attached.
    watched: function () {
      return Object.keys(lists).filter(function (q) { return lists[q].handlers.length > 0; });
    },
    handlerCount: function (query) { return lists[query] ? lists[query].handlers.length : 0; },
    setMedia: function (query, value) { matches[query] = value; },
    // Fires "change" on a media list, as the browser does.
    changeMedia: function (query) {
      var list = lists[query];
      if (list) list.handlers.slice().forEach(function (fn) { fn({ matches: !!matches[query] }); });
    },
    windowHandlerCount: function (type) { return (winListeners[type] || []).length; },
    fireWindow: function (type, event) {
      (winListeners[type] || []).slice().forEach(function (fn) { fn(event || {}); });
    },
    fireDocument: function (type) {
      (docListeners[type] || []).slice().forEach(function (fn) { fn({}); });
    },
    pendingFrames: function () { return frames.length; },
    flushFrames: function () {
      var run = frames.splice(0, frames.length);
      run.forEach(function (fn) { fn(); });
    }
  };
}
