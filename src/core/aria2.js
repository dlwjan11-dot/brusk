'use strict';
/**
 * aria2 runs in the background as the torrent / magnet / FTP engine and is driven over
 * its JSON-RPC interface on 127.0.0.1 with a random secret.
 */
const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.demonii.com:1337/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://exodus.desync.com:6969/announce',
  'udp://tracker.openbittorrent.com:6969/announce',
  'udp://explodie.org:6969/announce',
  'https://tracker.tamersunion.org:443/announce',
];

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
    s.on('error', reject);
  });
}

class Aria2 {
  constructor(binPath, dataDir) {
    this.bin = binPath; this.dataDir = dataDir; this.proc = null; this.port = 0; this.secret = '';
    this.starting = null;
  }

  async start(options = {}) {
    if (this.proc && this.proc.exitCode === null) return;
    if (this.starting) return this.starting;
    this.starting = (async () => {
      this.port = await freePort();
      this.secret = crypto.randomBytes(16).toString('hex');
      fs.mkdirSync(this.dataDir, { recursive: true });
      const args = [
        '--enable-rpc=true', `--rpc-listen-port=${this.port}`, `--rpc-secret=${this.secret}`, '--rpc-listen-all=false',
        `--stop-with-process=${process.pid}`, '--quiet=true', '--console-log-level=warn', '--summary-interval=0',
        '--max-concurrent-downloads=50', '--continue=true', '--auto-file-renaming=false', '--allow-overwrite=false',
        '--file-allocation=trunc', '--disk-cache=32M',
        '--enable-dht=true', '--enable-dht6=true', `--dht-file-path=${path.join(this.dataDir, 'dht.dat')}`,
        `--dht-file-path6=${path.join(this.dataDir, 'dht6.dat')}`,
        '--bt-enable-lpd=true', '--enable-peer-exchange=true', '--bt-max-peers=80', '--follow-torrent=mem',
        '--listen-port=6881-6999', '--dht-listen-port=6881-6999', '--bt-detach-seed-only=true',
        `--seed-ratio=${options.seedRatio ?? 1}`, '--bt-remove-unselected-file=true',
        '--max-connection-per-server=16', '--split=16', '--min-split-size=1M',
        `--max-overall-download-limit=${options.downloadLimit || 0}`, `--max-overall-upload-limit=${options.uploadLimit || 0}`,
      ];
      if (options.trackers !== false) args.push(`--bt-tracker=${TRACKERS.join(',')}`);
      if (options.proxy) args.push(`--all-proxy=${options.proxy}`);
      this.proc = spawn(this.bin, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
      this.proc.stderr.on('data', () => {});
      this.proc.on('exit', () => { this.proc = null; });
      for (let i = 0; i < 50; i++) {
        try { await this.call('aria2.getVersion'); return; } catch { await new Promise(r => setTimeout(r, 100)); }
      }
      throw new Error('The torrent engine did not start');
    })().finally(() => { this.starting = null; });
    return this.starting;
  }

  running() { return Boolean(this.proc && this.proc.exitCode === null); }

  call(method, ...params) {
    const body = JSON.stringify({ jsonrpc: '2.0', id: crypto.randomUUID(), method, params: [`token:${this.secret}`, ...params] });
    return new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: this.port, path: '/jsonrpc', method: 'POST', agent: false,
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }, timeout: 15_000 }, res => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', c => { data += c; });
        res.on('end', () => {
          try {
            const j = JSON.parse(data);
            if (j.error) reject(Object.assign(new Error(j.error.message), { code: j.error.code }));
            else resolve(j.result);
          } catch (e) { reject(e); }
        });
      });
      req.on('timeout', () => req.destroy(new Error('aria2 timeout')));
      req.on('error', reject);
      req.end(body);
    });
  }

  async stop() {
    if (!this.running()) return;
    try { await this.call('aria2.saveSession'); } catch {}
    try { await this.call('aria2.shutdown'); } catch {}
    setTimeout(() => { try { this.proc?.kill(); } catch {} }, 3000);
  }
}

/* ---------- small bencode reader for .torrent files ---------- */
function bdecode(buf) {
  let i = 0;
  function next() {
    const c = buf[i];
    if (c === 0x69) { // i
      const end = buf.indexOf(0x65, i); const n = Number(buf.toString('latin1', i + 1, end)); i = end + 1; return n;
    }
    if (c === 0x6c) { i++; const l = []; while (buf[i] !== 0x65) l.push(next()); i++; return l; }
    if (c === 0x64) {
      i++; const o = {};
      while (buf[i] !== 0x65) { const k = next().toString('utf8'); const start = i; o[k] = next(); if (k === 'info') o.__infoRaw = buf.subarray(start, i); }
      i++; return o;
    }
    const colon = buf.indexOf(0x3a, i);
    const len = Number(buf.toString('latin1', i, colon));
    const s = buf.subarray(colon + 1, colon + 1 + len); i = colon + 1 + len; return s;
  }
  return next();
}

/** Name, files, size and info-hash of a .torrent file. Paths are checked so a torrent can't write outside its folder. */
function readTorrent(buf) {
  const t = bdecode(buf);
  if (!t || !t.info) throw new Error('Not a torrent file');
  const info = t.info;
  const str = v => (Buffer.isBuffer(v) ? v.toString('utf8') : String(v ?? ''));
  const name = str(info['name.utf-8'] || info.name);
  const files = [];
  if (Array.isArray(info.files)) {
    info.files.forEach((f, idx) => {
      const parts = (f['path.utf-8'] || f.path || []).map(str);
      if (parts.some(p => p === '..' || p.includes('/') || p.includes('\\') || p.includes(':'))) throw new Error('Unsafe path inside torrent');
      files.push({ index: idx + 1, path: [name, ...parts].join('/'), length: f.length });
    });
  } else {
    files.push({ index: 1, path: name, length: info.length });
  }
  const infoHash = crypto.createHash('sha1').update(t.__infoRaw).digest('hex');
  const total = files.reduce((n, f) => n + (f.length || 0), 0);
  return { name, files: files.filter(f => !/\/?_____padding_file_/.test(f.path)), total, infoHash, private: info.private === 1 };
}

/** info-hash of a magnet link (hex or base32 form). */
function magnetHash(magnet) {
  const m = /xt=urn:btih:([a-z0-9]+)/i.exec(magnet);
  if (!m) return null;
  const v = m[1];
  if (v.length === 40) return v.toLowerCase();
  if (v.length === 32) {
    const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = '';
    for (const ch of v.toUpperCase()) bits += alpha.indexOf(ch).toString(2).padStart(5, '0');
    let hex = '';
    for (let j = 0; j + 4 <= bits.length; j += 4) hex += parseInt(bits.slice(j, j + 4), 2).toString(16);
    return hex.slice(0, 40);
  }
  return null;
}
function magnetName(magnet) {
  const m = /[?&]dn=([^&]+)/.exec(magnet);
  try { return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : null; } catch { return m[1]; }
}

module.exports = { Aria2, bdecode, readTorrent, magnetHash, magnetName, TRACKERS };
