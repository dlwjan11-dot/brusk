'use strict';
const { request, Agent, ProxyAgent } = require('undici');
const { filenameFromDisposition, filenameFromUrl } = require('./util');

const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const SENSITIVE = ['cookie', 'authorization', 'referer', 'proxy-authorization'];

let dispatcher = new Agent({ connections: 64, keepAliveTimeout: 10_000, connect: { timeout: 20_000 } });

/** proxy: '' | 'http://host:port' | 'http://user:pass@host:port' */
function setProxy(proxy) {
  const old = dispatcher;
  dispatcher = proxy
    ? new ProxyAgent({ uri: proxy, connections: 64, keepAliveTimeout: 10_000 })
    : new Agent({ connections: 64, keepAliveTimeout: 10_000, connect: { timeout: 20_000 } });
  old.close().catch(() => {});
}

class HttpError extends Error {
  constructor(status, message, retryAfter) {
    super(message || `HTTP ${status}`);
    this.status = status;
    this.retryAfter = retryAfter;
    // Permanent failures should not be retried forever (Awesome Downloader fixed this late).
    this.permanent = [400, 401, 403, 404, 405, 410, 411, 414, 451].includes(status);
    this.busy = [429, 503].includes(status);
  }
}

function parseRetryAfter(v) {
  if (!v) return undefined;
  const s = Number(v);
  if (Number.isFinite(s)) return s * 1000;
  const d = Date.parse(v);
  return Number.isFinite(d) ? Math.max(0, d - Date.now()) : undefined;
}

/**
 * GET with manual redirect handling. Sensitive headers (cookie/authorization/referer)
 * are dropped when a redirect leaves the original origin.
 */
async function get(url, headers = {}, { signal, range, maxRedirects = 10 } = {}) {
  let current = url;
  let h = { 'user-agent': DEFAULT_UA, accept: '*/*', 'accept-encoding': 'identity', ...lower(headers) };
  if (range) h.range = range;
  const origin = new URL(url).origin;
  for (let i = 0; i <= maxRedirects; i++) {
    const res = await request(current, { method: 'GET', headers: h, dispatcher, signal, headersTimeout: 30_000, bodyTimeout: 30_000 });
    // Discarding a body (destroy) must never crash the app with an unhandled 'error' event.
    res.body.on('error', () => {});
    if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
      res.body.destroy();
      const next = new URL(res.headers.location, current).toString();
      if (new URL(next).origin !== origin) { h = { ...h }; for (const k of SENSITIVE) delete h[k]; }
      current = next;
      continue;
    }
    res.finalUrl = current;
    return res;
  }
  throw new HttpError(310, 'Too many redirects');
}

function lower(h) { const o = {}; for (const [k, v] of Object.entries(h || {})) if (v != null && v !== '') o[k.toLowerCase()] = String(v); return o; }

function header(res, name) { const v = res.headers[name]; return Array.isArray(v) ? v[0] : v; }

/**
 * Look at a link before downloading it: real name, size, range support, validator.
 * Uses GET with "Range: bytes=0-0" because many servers answer HEAD wrongly.
 */
async function probe(url, headers = {}, signal) {
  const res = await get(url, headers, { signal, range: 'bytes=0-0' });
  try {
    if (res.statusCode >= 400) throw new HttpError(res.statusCode, undefined, parseRetryAfter(header(res, 'retry-after')));
    let total = null, ranges = false;
    const cr = header(res, 'content-range');
    if (res.statusCode === 206 && cr) {
      const m = /\/(\d+)\s*$/.exec(cr);
      if (m) { total = Number(m[1]); ranges = true; }
    } else {
      const len = header(res, 'content-length');
      if (len && /^\d+$/.test(len)) total = Number(len);
      ranges = false; // a 200 answer to a range request means the server can't resume or split
    }
    const etag = header(res, 'etag');
    const lastModified = header(res, 'last-modified');
    const type = (header(res, 'content-type') || '').split(';')[0].trim().toLowerCase();
    const name = filenameFromDisposition(header(res, 'content-disposition')) || filenameFromUrl(res.finalUrl) || filenameFromUrl(url);
    return {
      finalUrl: res.finalUrl, total, ranges, type, name,
      validator: etag && !/^W\//.test(etag) ? `etag:${etag}` : lastModified ? `lm:${lastModified}` : null,
    };
  } finally { res.body.destroy(); }
}

module.exports = { get, probe, setProxy, HttpError, parseRetryAfter, header, DEFAULT_UA, lower };
