import test from 'node:test';
import assert from 'node:assert/strict';

// Browser mock setup
const _elements = new Map();
function makeEl(id) {
  const classes = new Set();
  let _innerHtml = '';
  const el = {
    id,
    style: {},
    textContent: '',
    get innerHTML() { return _innerHtml; },
    set innerHTML(v) { _innerHtml = v; },
    value: '',
    disabled: false,
    classList: {
      add(c) { classes.add(c); },
      remove(c) { classes.delete(c); },
      contains(c) { return classes.has(c); },
    },
    addEventListener() {},
  };
  return el;
}

globalThis.document = {
  getElementById(id) {
    if (!_elements.has(id)) _elements.set(id, makeEl(id));
    return _elements.get(id);
  },
  documentElement: {
    classList: { add() {}, remove() {} },
    setAttribute() {},
  },
  addEventListener() {},
};

globalThis.window = {
  location: {
    hostname: 'airrelay-szvm.onrender.com',
    port: '',
    protocol: 'https:',
    origin: 'https://airrelay-szvm.onrender.com',
    pathname: '/',
    search: '',
  },
  localStorage: { getItem() { return null; }, setItem() {} },
  addEventListener() {},
};

globalThis.RTCPeerConnection = class {};
globalThis.navigator = { clipboard: undefined, serviceWorker: undefined };

test('turn.getServers() returns resilient Google STUN servers when /api/credentials fails', async () => {
  // Stub fetch to simulate 502 Bad Gateway during Render cold-start
  let fetchAttempts = 0;
  globalThis.fetch = async () => {
    fetchAttempts++;
    return { ok: false, status: 502 };
  };

  const { turn } = await import('../../web/js/modules/webrtc/turn.js');
  const servers = await turn.getServers();

  assert.ok(Array.isArray(servers), 'servers must be an array');
  assert.ok(servers.length >= 2, 'should provide at least Google STUN servers');
  const stunUrls = servers.map(s => typeof s.urls === 'string' ? s.urls : (s.urls && s.urls[0]));
  assert.ok(stunUrls.some(u => u && u.includes('stun.l.google.com')), 'includes primary Google STUN');
  assert.ok(fetchAttempts >= 1, 'attempted credential fetch');
});

test('turn.getServers() successfully decodes JWT and adds TURN servers when credentials succeed', async () => {
  const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + 300;
  const token = `${b64u({ alg: 'HS256' })}.${b64u({ username: 'test-user', credential: 'test-cred', exp })}.sig`;

  globalThis.fetch = async () => {
    return {
      ok: true,
      json: async () => ({ token }),
    };
  };

  const { turn } = await import('../../web/js/modules/webrtc/turn.js');
  // Invalidate cached token for test
  turn._expiration = null;
  const servers = await turn.getServers();

  const turnEntry = servers.find(s => s.username === 'test-user' && s.credential === 'test-cred');
  assert.ok(turnEntry, 'TURN entry with username and credential must be included');
  assert.equal(turnEntry.username, 'test-user');
});
