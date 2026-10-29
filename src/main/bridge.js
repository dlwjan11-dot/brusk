'use strict';
/**
 * Local link between the browser extension and the app.
 * - listens on 127.0.0.1 only
 * - pairing needs the user's "Allow" in the app; after that every call carries a token
 * - web pages can't use it: requests with a normal web Origin are refused, and the JSON
 *   content type + token header force a CORS preflight that is never answered.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Spread over different ranges: Windows (Hyper-V, WSL, Docker) often reserves whole blocks of ports.
const PORTS = [47800, 47801, 31760, 31761, 23741, 23742, 18764, 18765, 52819, 61871];

class Bridge {
  constructor({ dataDir, version, onPair, onAdd, getSettings }) {
    this.file = path.join(dataDir, 'browsers.json');
    this.version = version;
    this.onPair = onPair; this.onAdd = onAdd; this.getSettings = getSettings;
    this.paired = [];
    try { this.paired = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch {}
    this.pairing = null;
  }

  save() { fs.writeFileSync(this.file, JSON.stringify(this.paired, null, 1)); }
  list() { return this.paired.map(({ id, name, at }) => ({ id, name, at })); }
  forget(id) { this.paired = this.paired.filter(p => p.id !== id); this.save(); }

  async start() {
    if (this.server?.listening) return this.port;
    const errors = [];
    for (const port of PORTS) {
      try { await this.listen(port); this.port = port; this.error = null; return port; }
      catch (e) { errors.push(`${port}: ${e.code || e.message}`); }
    }
    this.error = errors.join(', ');
    return null;
  }
  status() { return { port: this.port || null, error: this.error || null }; }

  listen(port) {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => this.handle(req, res).catch(e => send(res, 500, { error: String(e.message || e) })));
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => { this.server = server; resolve(); });
    });
  }

  tokenOk(req) {
    const t = req.headers['x-barq-token'];
    if (!t) return null;
    const hash = crypto.createHash('sha256').update(String(t)).digest('hex');
    return this.paired.find(p => p.hash === hash) || null;
  }

  async handle(req, res) {
    const origin = req.headers.origin || '';
    if (origin && !/^(chrome|moz|edge|safari-web)-extension:\/\//.test(origin)) return send(res, 403, { error: 'forbidden' });
    if (req.method === 'OPTIONS') return send(res, 403, {});
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method === 'GET' && url.pathname === '/barq/ping') {
      const b = this.tokenOk(req);
      const s = this.getSettings();
      return send(res, 200, { app: 'barq', version: this.version, paired: Boolean(b), captureTypes: b ? s.captureTypes : undefined, captureMinSizeKB: b ? s.captureMinSizeKB : undefined, language: s.language });
    }
    if (req.method !== 'POST' || !/json/.test(req.headers['content-type'] || '')) return send(res, 404, { error: 'not found' });
    const body = await readBody(req);
    if (url.pathname === '/barq/pair') {
      if (this.pairing) return send(res, 429, { error: 'busy' });
      const name = String(body.browser || 'Browser').slice(0, 60);
      this.pairing = this.onPair(name);
      let allowed = false;
      try { allowed = await this.pairing; } finally { this.pairing = null; }
      if (!allowed) return send(res, 403, { error: 'denied' });
      const token = crypto.randomBytes(24).toString('hex');
      this.paired.push({ id: crypto.randomUUID(), name, at: new Date().toISOString(), hash: crypto.createHash('sha256').update(token).digest('hex') });
      this.save();
      return send(res, 200, { token });
    }
    if (!this.tokenOk(req)) return send(res, 401, { error: 'not paired' });
    if (url.pathname === '/barq/add') {
      const items = (Array.isArray(body.items) ? body.items : [body]).slice(0, 500).map(clean).filter(Boolean);
      if (!items.length) return send(res, 400, { error: 'no links' });
      this.onAdd(items, { silent: Boolean(body.silent) });
      return send(res, 200, { ok: true, count: items.length });
    }
    return send(res, 404, { error: 'not found' });
  }

  stop() { this.server?.close(); }
}

function clean(i) {
  if (!i || typeof i.url !== 'string') return null;
  if (!/^(https?|ftp|magnet):/i.test(i.url)) return null;
  const s = (v, n = 2048) => (typeof v === 'string' ? v.slice(0, n) : undefined);
  return {
    url: s(i.url, 8192), referrer: s(i.referrer, 4096), pageUrl: s(i.pageUrl, 4096), pageTitle: s(i.pageTitle, 300),
    filename: s(i.filename, 300), userAgent: s(i.userAgent, 512), mime: s(i.mime, 120), size: Number.isFinite(i.size) ? i.size : undefined,
    kind: ['video', 'http', 'torrent', 'gallery'].includes(i.kind) ? i.kind : undefined,
    gallery: i.gallery && typeof i.gallery === 'object' ? { posts: Math.max(0, Math.min(100000, Number(i.gallery.posts) || 0)), types: ['all', 'images', 'videos'].includes(i.gallery.types) ? i.gallery.types : 'all', text: ['none', 'with', 'only'].includes(i.gallery.text) ? i.gallery.text : undefined } : undefined,
    cookies: Array.isArray(i.cookies) ? i.cookies.slice(0, 200).map(c => ({ name: s(c.name, 256), value: s(c.value, 8192), domain: s(c.domain, 256), path: s(c.path, 512), secure: Boolean(c.secure), httpOnly: Boolean(c.httpOnly), expirationDate: Number(c.expirationDate) || 0 })).filter(c => c.name) : [],
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > 4 * 1024 * 1024) { req.destroy(); reject(new Error('too large')); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(new Error('bad json')); } });
    req.on('error', reject);
  });
}
function send(res, code, obj) { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); }

module.exports = { Bridge, PORTS };
