'use strict';
const path = require('path');
const fs = require('fs');

const CATEGORIES = {
  compressed: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'iso', 'img', 'cab', 'arj', 'lzh', 'tgz', 'zst'],
  documents: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'rtf', 'odt', 'ods', 'epub', 'csv', 'md', 'psd', 'ai'],
  music: ['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'opus', 'wma', 'aif', 'aiff', 'mid'],
  video: ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4v', 'mpg', 'mpeg', '3gp', 'ts', 'm2ts'],
  programs: ['exe', 'msi', 'apk', 'dmg', 'pkg', 'deb', 'rpm', 'appimage', 'msix', 'appx', 'bat', 'jar'],
  images: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'tif', 'tiff', 'heic', 'raw', 'cr2', 'nef', 'arw'],
};

function categoryFor(filename, kind) {
  if (kind === 'torrent') return 'torrents';
  if (kind === 'video') return 'video';
  const ext = path.extname(filename || '').slice(1).toLowerCase();
  for (const [cat, list] of Object.entries(CATEGORIES)) if (list.includes(ext)) return cat;
  return 'other';
}

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** Make a file name safe on Windows, keep the extension when shortening (bug in Awesome Downloader). */
function safeFilename(name, maxLen = 180) {
  let n = String(name || '').normalize('NFC')
    .replace(/[\u0000-\u001f<>:"/\\|?*\u007f]/g, '_')
    .replace(/\s+/g, ' ').trim()
    .replace(/[. ]+$/, '');
  if (!n) n = 'download';
  const ext = path.extname(n);
  let base = ext ? n.slice(0, -ext.length) : n;
  if (RESERVED.test(base)) base = '_' + base;
  const keepExt = ext.length <= 16 ? ext : '';
  if (!keepExt) base = n;
  if (Buffer.byteLength(base + keepExt) > maxLen) {
    while (Buffer.byteLength(base + keepExt) > maxLen - 3) base = base.slice(0, -1);
    base = base.trim() + '…';
  }
  return base + keepExt;
}

/** name.ext -> name (1).ext while the name is taken on disk or by another active download. */
function uniquePath(dir, filename, taken = new Set()) {
  const ext = path.extname(filename);
  const base = ext ? filename.slice(0, -ext.length) : filename;
  let candidate = path.join(dir, filename);
  for (let i = 1; fs.existsSync(candidate) || fs.existsSync(candidate + '.brusk') || taken.has(candidate.toLowerCase()); i++) {
    candidate = path.join(dir, `${base} (${i})${ext}`);
  }
  return candidate;
}

/** RFC 6266 / 5987 Content-Disposition parsing. */
function filenameFromDisposition(header) {
  if (!header) return null;
  const star = /filename\*\s*=\s*([^;]+)/i.exec(header);
  if (star) {
    const v = star[1].trim().replace(/^"|"$/g, '');
    const m = /^([\w!#$%&+^`{}~.-]+)'[^']*'(.*)$/.exec(v);
    try {
      if (m) {
        const bytes = Buffer.from(decodeURIComponentSafe(m[2]), 'latin1');
        return m[1].toLowerCase() === 'utf-8' ? decodeURIComponent(m[2]) : bytes.toString('latin1');
      }
    } catch { /* fall back to plain filename= (fix for malformed extended names) */ }
  }
  const plain = /filename\s*=\s*("((?:\\.|[^"\\])*)"|[^;]+)/i.exec(header);
  if (plain) {
    let v = plain[2] !== undefined ? plain[2].replace(/\\(.)/g, '$1') : plain[1].trim();
    // Many servers send raw UTF-8 bytes that Node reads as latin1.
    try { const u = Buffer.from(v, 'latin1').toString('utf8'); if (!u.includes('\uFFFD')) v = u; } catch {}
    return v;
  }
  return null;
}
function decodeURIComponentSafe(s) { try { return unescape(s); } catch { return s; } }

function filenameFromUrl(url) {
  try {
    const u = new URL(url);
    const last = u.pathname.split('/').filter(Boolean).pop();
    if (!last) return u.hostname;
    return decodeURIComponent(last);
  } catch { return null; }
}

/** Shared token bucket. limit = bytes/second, 0 = unlimited. */
class RateLimiter {
  constructor(limit = 0) { this.limit = limit; this.tokens = 0; this.last = Date.now(); }
  setLimit(limit) { this.limit = Math.max(0, Number(limit) || 0); this.tokens = 0; this.last = Date.now(); }
  async take(n) {
    if (!this.limit) return;
    for (;;) {
      const now = Date.now();
      this.tokens = Math.min(this.limit, this.tokens + (now - this.last) / 1000 * this.limit);
      this.last = now;
      if (this.tokens >= n || this.tokens >= this.limit) { this.tokens -= n; return; }
      const wait = Math.max(5, Math.min(250, (n - this.tokens) / this.limit * 1000));
      await new Promise(r => setTimeout(r, wait));
    }
  }
}

/** Two limiters in a row (overall + per-download). */
async function takeAll(limiters, n) { for (const l of limiters) if (l) await l.take(n); }

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const t = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    function onAbort() { clearTimeout(t); reject(abortError()); }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
function abortError() { const e = new Error('Aborted'); e.name = 'AbortError'; return e; }

function newId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

module.exports = { CATEGORIES, categoryFor, safeFilename, uniquePath, filenameFromDisposition, filenameFromUrl, RateLimiter, takeAll, sleep, abortError, newId };
