'use strict';

const http = require('node:http');
const { WebSocket, WebSocketServer } = require('ws');

const UPSTREAM = 'wss://msi.tail4626fb.ts.net:8443/realtime/v1/websocket';
const CANONICAL_ORIGIN = 'https://hvac-app-jade.vercel.app';
const MAX_PAYLOAD = 1024 * 1024;
const MAX_BUFFER = 2 * MAX_PAYLOAD;
const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

// The dependency injection is used only by the local protocol tests. Requests can
// never select a destination, headers, TLS policy, or connection limits.
function createBridgeServer({
  connect = (url, protocols, options) => new WebSocket(url, protocols, options),
  environment = process.env,
  lifetimeMs = 280000,
  maxConnections = 64,
} = {}) {
  const active = new Set();
  const server = http.createServer((req, res) => {
    res.writeHead(isEndpoint(req.url) ? 426 : 404, {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(isEndpoint(req.url) ? 'WebSocket upgrade required' : 'Not found');
  });
  const selectedProtocols = new WeakMap();
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_PAYLOAD,
    perMessageDeflate: false,
    handleProtocols: (_offered, req) => selectedProtocols.get(req) || false,
  });
  wss.on('headers', (headers) => {
    headers.push('Cache-Control: no-store', 'Referrer-Policy: no-referrer');
  });

  server.on('upgrade', (req, socket, head) => {
    socket.on('error', () => {});
    const reject = (status) => {
      if (!socket.destroyed) socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\nCache-Control: no-store\r\nContent-Length: 0\r\n\r\n`);
    };
    let url;
    try {
      if (!req.url.startsWith('/') || req.url.length > 8192) return reject(400);
      url = new URL(req.url, 'https://bridge.invalid');
    } catch { return reject(400); }
    if (!isEndpoint(url.pathname)) return reject(404);
    if (req.method !== 'GET' || req.headers.upgrade?.toLowerCase() !== 'websocket'
        || !String(req.headers.connection || '').toLowerCase().split(/\s*,\s*/).includes('upgrade')
        || req.headers['sec-websocket-version'] !== '13'
        || !/^[+/0-9A-Za-z]{22}==$/.test(req.headers['sec-websocket-key'] || '')) return reject(400);
    if (!validOrigin(req, environment)) return reject(403);
    const anonKey = (environment.REACT_APP_SUPABASE_ANON_KEY || '').trim();
    if (!anonKey || url.searchParams.getAll('apikey').length !== 1
        || url.searchParams.get('apikey') !== anonKey) return reject(401);
    const rawProtocols = req.headers['sec-websocket-protocol'] || '';
    if (typeof rawProtocols !== 'string' || rawProtocols.length > 2048) return reject(400);
    const protocols = rawProtocols ? rawProtocols.split(',').map((p) => p.trim()) : [];
    if (protocols.length > 16 || new Set(protocols).size !== protocols.length
        || protocols.some((p) => !TOKEN.test(p))) return reject(400);
    const authorization = req.headers.authorization;
    if (authorization && (typeof authorization !== 'string' || authorization.length > 8192
        || !/^Bearer [\w.\-]+$/.test(authorization))) return reject(400);
    if (active.size >= maxConnections) return reject(503);

    let upstream;
    let downstream;
    let stopped = false;
    let pending = [];
    let pendingBytes = 0;
    let lifetime;
    let handshake;
    let termination;
    const record = { stop };
    active.add(record);

    function stop(code = 1011) {
      if (stopped) return;
      stopped = true;
      active.delete(record);
      clearTimeout(lifetime);
      clearTimeout(handshake);
      pending = [];
      pendingBytes = 0;
      if (!downstream) reject(502);
      for (const peer of [upstream, downstream]) {
        if (!peer) continue;
        if (peer.readyState === WebSocket.OPEN) peer.close(code, 'Realtime connection closed');
        else if (peer.readyState === WebSocket.CONNECTING) peer.terminate();
      }
      termination = setTimeout(() => {
        for (const peer of [upstream, downstream]) {
          if (peer && peer.readyState !== WebSocket.CLOSED) peer.terminate();
        }
        if (!downstream && !socket.destroyed) socket.destroy();
      }, 1000);
      termination.unref();
    }
    function forward(peer, data, binary) {
      if (stopped) return;
      if (!peer || peer.readyState !== WebSocket.OPEN
          || data.length > MAX_PAYLOAD || peer.bufferedAmount + data.length > MAX_BUFFER) return stop(1013);
      peer.send(data, { binary }, (error) => { if (error) stop(); });
    }
    socket.once('close', () => stop(1001));
    const headers = { Origin: CANONICAL_ORIGIN };
    if (authorization) headers.Authorization = authorization;
    try {
      upstream = connect(UPSTREAM + url.search, protocols, {
        headers,
        rejectUnauthorized: true,
        followRedirects: false,
        handshakeTimeout: 10000,
        maxPayload: MAX_PAYLOAD,
        perMessageDeflate: false,
      });
    } catch { stop(); return; }
    handshake = setTimeout(() => stop(), 11000);
    handshake.unref();
    upstream.on('error', () => stop());
    upstream.on('unexpected-response', (_request, response) => { response.destroy(); stop(); });
    upstream.on('close', (code) => {
      stop(code === 1000 || code === 1001 || (code >= 3000 && code <= 4999) ? code : 1011);
      if (!downstream || downstream.readyState === WebSocket.CLOSED) clearTimeout(termination);
    });
    upstream.on('message', (data, binary) => {
      if (stopped) return;
      if (downstream) return forward(downstream, data, binary);
      pendingBytes += data.length;
      if (pendingBytes > 65536) return stop(1013);
      pending.push([data, binary]);
    });
    upstream.once('open', () => {
      if (stopped || socket.destroyed) return stop();
      clearTimeout(handshake);
      selectedProtocols.set(req, upstream.protocol);
      try {
        wss.handleUpgrade(req, socket, head, (peer) => {
          downstream = peer;
          downstream.on('error', () => stop());
          downstream.on('close', (code) => {
            stop(code === 1000 || code === 1001 || (code >= 3000 && code <= 4999) ? code : 1011);
            if (upstream.readyState === WebSocket.CLOSED) clearTimeout(termination);
          });
          downstream.on('message', (data, binary) => forward(upstream, data, binary));
          for (const [data, binary] of pending) forward(downstream, data, binary);
          pending = [];
          pendingBytes = 0;
          // Supabase's client reconnects and rejoins channels after a normal
          // transport close. Finish before the Function's 300-second limit.
          lifetime = setTimeout(() => stop(1012), lifetimeMs);
          lifetime.unref();
        });
      } catch { stop(); }
    });
  });
  Object.defineProperty(server, 'shutdownBridge', { value: () => {
    for (const connection of active) connection.stop(1001);
    wss.close();
  } });
  return server;
}

function isEndpoint(rawUrl = '') {
  const path = rawUrl.split('?')[0];
  // Vercel may expose the original URL or the internal Function mount after a
  // rewrite. Both names select this one fixed upstream WebSocket endpoint.
  return path === '/realtime/v1/websocket' || path === '/api/realtime-bridge';
}

function validOrigin(req, environment) {
  const origin = req.headers.origin;
  if (origin === CANONICAL_ORIGIN) return true;
  const host = req.headers.host;
  const deploymentHosts = [environment.VERCEL_URL, environment.VERCEL_BRANCH_URL,
    environment.VERCEL_PROJECT_PRODUCTION_URL].filter(Boolean);
  return typeof host === 'string' && deploymentHosts.includes(host)
    && origin === `https://${host}`;
}

// Node http.Server exports are supported by Vercel's WebSocket runtime.
const server = createBridgeServer();
Object.defineProperty(server, 'createBridgeServer', { value: createBridgeServer });
module.exports = server;
