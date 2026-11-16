'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { WebSocket, WebSocketServer } = require('ws');
const { createBridgeServer } = require('../api/realtime-bridge');
const JADE = 'https://hvac-app-jade.vercel.app';
const PREVIEW = 'hvac-app-synthetic-preview.vercel.app';
const KEY = 'synthetic-public-anon-key';

async function fixture(t, options = {}) {
  const sockets = new Set();
  const observed = [];
  const upstreamServer = http.createServer();
  const upstream = new WebSocketServer({ server: upstreamServer,
    handleProtocols: (protocols) => [...protocols].at(-1) });
  upstream.on('connection', (ws, req) => {
    sockets.add(ws);
    ws.on('error', () => {});
    observed.push({ requestUrl: req.url, headers: req.headers, ws });
    ws.on('message', (data, binary) => ws.send(data, { binary }));
  });
  upstreamServer.listen(0, '127.0.0.1');
  await once(upstreamServer, 'listening');
  const upstreamBase = `ws://127.0.0.1:${upstreamServer.address().port}`;
  let connectionCount = 0;
  const bridge = createBridgeServer({
    environment: { REACT_APP_SUPABASE_ANON_KEY: KEY, VERCEL_URL: PREVIEW },
    connect: (url, protocols, connectOptions) => {
      connectionCount++;
      observed.push({ fixedUrl: url, connectOptions });
      const ws = new WebSocket(upstreamBase + new URL(url).pathname + new URL(url).search,
        protocols, { headers: connectOptions.headers, perMessageDeflate: false });
      sockets.add(ws);
      if (options.backpressure) Object.defineProperty(ws, 'bufferedAmount', { get: () => 3 * 1024 * 1024 });
      return ws;
    },
    ...options,
  });
  bridge.listen(0, '127.0.0.1');
  await once(bridge, 'listening');
  const base = `ws://127.0.0.1:${bridge.address().port}`;
  t.after(async () => {
    bridge.shutdownBridge();
    for (const ws of sockets) ws.terminate();
    await Promise.all([new Promise((resolve) => bridge.close(resolve)),
      new Promise((resolve) => upstream.close(() => upstreamServer.close(resolve)))]);
  });
  function client({ path = `/realtime/v1/websocket?apikey=${KEY}&vsn=1.0.0`,
    origin = JADE, protocols = [], headers = {} } = {}) {
    const ws = new WebSocket(base + path, protocols, { origin, headers });
    sockets.add(ws);
    ws.on('error', () => {});
    return ws;
  }
  return { base, client, observed, connectionCount: () => connectionCount };
}

async function rejected(ws) {
  const [request, response] = await once(ws, 'unexpected-response');
  const status = response.statusCode;
  response.resume();
  request.destroy();
  return status;
}

test('fixed TLS destination preserves Phoenix query, selected protocol, text and binary without forwarding browser secrets', async (t) => {
  const f = await fixture(t);
  const query = `?apikey=${KEY}&vsn=1.0.0&access_token=synthetic&target=https%3A%2F%2Finvalid.example`;
  const ws = f.client({ path: '/realtime/v1/websocket' + query, protocols: ['first', 'phoenix'],
    headers: { Cookie: 'private-cookie=synthetic', 'x-vercel-protection-bypass': 'synthetic',
      Authorization: 'Bearer synthetic.token' } });
  await once(ws, 'open');
  assert.equal(ws.protocol, 'phoenix');
  const outgoing = f.observed.find((x) => x.fixedUrl);
  assert.equal(outgoing.fixedUrl, 'wss://msi.tail4626fb.ts.net:8443/realtime/v1/websocket' + query);
  assert.equal(outgoing.connectOptions.rejectUnauthorized, true);
  assert.equal(outgoing.connectOptions.followRedirects, false);
  assert.equal(outgoing.connectOptions.handshakeTimeout, 10000);
  assert.equal(outgoing.connectOptions.maxPayload, 1024 * 1024);
  assert.deepEqual(outgoing.connectOptions.headers, { Origin: JADE, Authorization: 'Bearer synthetic.token' });
  const text = JSON.stringify(['1', '2', 'phoenix', 'heartbeat', {}]);
  let received = once(ws, 'message'); ws.send(text);
  let [data, binary] = await received;
  assert.equal(data.toString(), text); assert.equal(binary, false);
  const bytes = Buffer.from([0, 1, 255, 127]);
  received = once(ws, 'message'); ws.send(bytes);
  [data, binary] = await received;
  assert.deepEqual(data, bytes); assert.equal(binary, true);
});

test('accepts an exact deployment preview Origin and the internal rewrite mount', async (t) => {
  const f = await fixture(t);
  const ws = f.client({ path: `/api/realtime-bridge?apikey=${KEY}`, origin: `https://${PREVIEW}`, headers: { Host: PREVIEW } });
  await once(ws, 'open');
  assert.equal(f.observed.find((x) => x.headers)?.headers.origin, JADE);
});

test('rejects foreign, missing and spoofed preview origins before connecting', async (t) => {
  const f = await fixture(t);
  for (const origin of ['https://attacker.example', 'null', 'https://hvac-app-other.vercel.app']) {
    assert.equal(await rejected(f.client({ origin, headers: { Host: PREVIEW } })), 403);
  }
  assert.equal(await rejected(f.client({ origin: `https://${PREVIEW}`, headers: { Host: 'other.vercel.app' } })), 403);
  assert.equal(f.connectionCount(), 0);
});

test('rejects missing, wrong and duplicate public apikey and non-endpoint paths', async (t) => {
  const f = await fixture(t);
  for (const path of ['/realtime/v1/websocket', '/realtime/v1/websocket?apikey=wrong',
    `/realtime/v1/websocket?apikey=${KEY}&apikey=${KEY}`]) {
    assert.equal(await rejected(f.client({ path })), 401);
  }
  assert.equal(await rejected(f.client({ path: `/auth/v1/user?apikey=${KEY}` })), 404);
  assert.equal(f.connectionCount(), 0);
});

test('fails closed when the public key is not configured', async (t) => {
  const f = await fixture(t, { environment: {} });
  assert.equal(await rejected(f.client()), 401);
  assert.equal(f.connectionCount(), 0);
});

test('ordinary HTTP cannot become an HTTP proxy', async (t) => {
  const f = await fixture(t);
  for (const [path, expected] of [['/realtime/v1/websocket', 426], ['/unrelated', 404]]) {
    const response = await fetch(f.base.replace('ws:', 'http:') + path);
    assert.equal(response.status, expected);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    await response.text();
  }
  assert.equal(f.connectionCount(), 0);
});

test('caps concurrent handshakes and releases the slot on disconnect', async (t) => {
  const f = await fixture(t, { maxConnections: 1 });
  const first = f.client(); await once(first, 'open');
  assert.equal(await rejected(f.client()), 503);
  const closed = once(first, 'close'); first.close(); await closed;
  await new Promise((resolve) => setImmediate(resolve));
  const next = f.client(); await once(next, 'open');
  assert.equal(f.connectionCount(), 2);
});

test('closes both sides instead of buffering without a bound', async (t) => {
  const f = await fixture(t, { backpressure: true });
  const ws = f.client(); await once(ws, 'open');
  const closing = once(ws, 'close'); ws.send('backpressure');
  const [code] = await closing; assert.equal(code, 1013);
});

test('oversized frames fail and close the upstream', async (t) => {
  const f = await fixture(t);
  const ws = f.client(); await once(ws, 'open');
  const closing = once(ws, 'close'); ws.send(Buffer.alloc(1024 * 1024 + 1));
  const [code] = await closing; assert.ok([1009, 1011].includes(code));
});

test('bounded lifetime closes with restart code and supports a fresh connection', async (t) => {
  const f = await fixture(t, { lifetimeMs: 35 });
  for (let i = 0; i < 2; i++) {
    const ws = f.client(); await once(ws, 'open');
    const closing = once(ws, 'close');
    const received = once(ws, 'message'); ws.send('rejoin');
    assert.equal((await received)[0].toString(), 'rejoin');
    assert.equal((await closing)[0], 1012);
  }
});

test('upstream failure produces a generic 502 without exposing its message', async (t) => {
  const f = await fixture(t, { connect: () => { throw new Error('synthetic-private-provider-detail'); } });
  assert.equal(await rejected(f.client()), 502);
});

test('upstream close preserves valid application codes and strips private reasons', async (t) => {
  const f = await fixture(t);
  const ws = f.client(); await once(ws, 'open');
  const closing = once(ws, 'close');
  f.observed.find((x) => x.ws).ws.close(4001, 'synthetic-private-provider-detail');
  const [code, reason] = await closing;
  assert.equal(code, 4001);
  assert.equal(reason.toString(), 'Realtime connection closed');
});
