'use strict';
/**
 * Helper programs: yt-dlp (video pages), FFmpeg (joins video + sound), Deno (YouTube needs it),
 * aria2 (torrents, magnet links, FTP). aria2 and yt-dlp ship inside the installer; FFmpeg and Deno
 * are fetched from their official GitHub releases the first time a video needs them, and kept
 * only if they match the published SHA-256 checksum.
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { get } = require('./http');

const WIN = process.platform === 'win32';
const MAC = process.platform === 'darwin';
const ARM = process.arch === 'arm64';
const exe = n => (WIN ? n + '.exe' : n);
const GH = 'https://github.com';
const DENO = n => `${GH}/denoland/deno/releases/latest/download/deno-${n}.zip`;
const FFS = n => `${GH}/eugeneware/ffmpeg-static/releases/download/b6.0/${n}.gz`;

// Pinned checksums for the macOS FFmpeg builds (that project publishes no checksum file).
const FF_MAC = {
  arm64: { ffmpeg: '6be74d6f449889c2e87a75873894f8520cad56c08ac76f2a628d85b0519daaca', ffprobe: 'a4db76bafdb8529312e138fb55aaf143cad21b6d672e2634c9dd07ae83c6a310' },
  x64: { ffmpeg: 'a12354fce7eb62361473bbe10d53a1893695babd35869ec8e92e5dfea8d0440b', ffprobe: 'b75d816c5658bd417a2a05e174957963e2f9f85be3eb731b2a04467545a665dc' },
};
const macArch = ARM ? 'arm64' : 'x64';

const SOURCES = {
  'yt-dlp': {
    url: `${GH}/yt-dlp/yt-dlp/releases/latest/download/${WIN ? 'yt-dlp.exe' : MAC ? 'yt-dlp_macos' : 'yt-dlp_linux'}`,
    sums: `${GH}/yt-dlp/yt-dlp/releases/latest/download/SHA2-256SUMS`,
    asset: WIN ? 'yt-dlp.exe' : MAC ? 'yt-dlp_macos' : 'yt-dlp_linux',
    binary: exe('yt-dlp'),
  },
  ffmpeg: MAC ? {
    url: FFS(`ffmpeg-darwin-${macArch}`),
    binary: 'ffmpeg',
    parts: ['ffmpeg', 'ffprobe'].map(n => ({ url: FFS(`${n}-darwin-${macArch}`), sha256: FF_MAC[macArch][n], binary: n })),
  } : {
    url: WIN ? `${GH}/yt-dlp/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip`
      : `${GH}/yt-dlp/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz`,
    sums: `${GH}/yt-dlp/FFmpeg-Builds/releases/download/latest/checksums.sha256`,
    asset: WIN ? 'ffmpeg-master-latest-win64-gpl.zip' : 'ffmpeg-master-latest-linux64-gpl.tar.xz',
    archive: true,
    binary: exe('ffmpeg'),
    extra: [exe('ffprobe')],
  },
  deno: (() => {
    const url = DENO(WIN ? 'x86_64-pc-windows-msvc' : MAC ? (ARM ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin') : 'x86_64-unknown-linux-gnu');
    return { url, sums: url + '.sha256sum', asset: null, archive: true, binary: exe('deno') };   // .sha256sum holds one hash
  })(),
  // Built from PyPI on GitHub for every Brusk release (gallery-dl publishes no macOS build); shipped inside the app.
  'gallery-dl': { url: null, binary: exe('gallery-dl') },
  aria2c: {
    // Windows: fetched if missing. macOS/Linux: shipped inside the app (no official standalone download).
    url: WIN ? `${GH}/aria2/aria2/releases/download/release-1.37.0/aria2-1.37.0-win-64bit-build1.zip` : null,
    sums: null,
    sha256: '67d015301eef0b612191212d564c5bb0a14b5b9c4796b76454276a4d28d9b288',
    archive: true,
    binary: exe('aria2c'),
  },
};

class Tools {
  /** @param bundledDir tools shipped with the app (read-only), userDir writable copy for downloads/updates */
  constructor(bundledDir, userDir) { this.bundledDir = bundledDir; this.userDir = userDir; this.pending = new Map(); }

  find(name) {
    const bin = SOURCES[name].binary;
    for (const dir of [this.userDir, this.bundledDir]) {
      if (!dir) continue;
      const p = path.join(dir, bin);
      if (fs.existsSync(p)) return p;
    }
    // last resort: on PATH (useful while developing on Linux)
    for (const dir of (process.env.PATH || '').split(path.delimiter)) {
      const p = path.join(dir, bin);
      if (dir && fs.existsSync(p)) return p;
    }
    return null;
  }

  /** Copy the helpers shipped inside the app to the user's tools folder (new or changed ones only). */
  async copyBundled() {
    if (!this.bundledDir || !fs.existsSync(this.bundledDir)) return;
    await fsp.mkdir(this.userDir, { recursive: true });
    for (const name of await fsp.readdir(this.bundledDir)) {
      const src = path.join(this.bundledDir, name), dest = path.join(this.userDir, name);
      const a = await fsp.stat(src);
      if (!a.isFile()) continue;
      const b = await fsp.stat(dest).catch(() => null);
      const marker = dest + '.bundled';
      const stamp = `${a.size}:${a.mtimeMs}`;
      // keep a newer yt-dlp the user downloaded with "Update"
      if (b && fs.existsSync(marker) && fs.readFileSync(marker, 'utf8') === stamp) continue;
      if (b && !fs.existsSync(marker)) continue;
      await fsp.copyFile(src, dest);
      await makeRunnable(dest);
      await fsp.writeFile(marker, stamp);
    }
  }

  status() {
    const out = {};
    for (const name of Object.keys(SOURCES)) out[name] = Boolean(this.find(name));
    return out;
  }

  /** Make sure a tool exists, downloading it once if needed. onProgress(name, done, total) */
  async ensure(name, onProgress, { force = false } = {}) {
    if (!force) { const p = this.find(name); if (p) return p; }
    if (this.pending.has(name)) return this.pending.get(name);
    const job = this.install(name, onProgress).finally(() => this.pending.delete(name));
    this.pending.set(name, job);
    return job;
  }

  async install(name, onProgress) {
    const src = SOURCES[name];
    await fsp.rm(path.join(this.userDir, src.binary + '.bundled'), { force: true }).catch(() => {});
    if (!src.url) throw new Error(`${name} is not available for this system`);
    await fsp.mkdir(this.userDir, { recursive: true });
    const tmpDir = await fsp.mkdtemp(path.join(this.userDir, `.${name}-`));
    try {
      if (src.parts) {
        // several single files, each gzip-compressed with its own pinned checksum
        let done = 0;
        for (const part of src.parts) {
          const file = path.join(tmpDir, part.binary + '.gz');
          const hash = await downloadTo(part.url, file, (d, t) => onProgress?.(name, done + d, t * src.parts.length));
          if (hash !== part.sha256) throw new Error(`${name}: checksum does not match, file discarded`);
          const dest = path.join(this.userDir, part.binary);
          await fsp.rm(dest, { force: true });
          await gunzipTo(file, dest);
          await makeRunnable(dest);
          done += fs.statSync(file).size;
        }
        return path.join(this.userDir, src.binary);
      }
      const file = path.join(tmpDir, path.basename(new URL(src.url).pathname));
      const hash = await downloadTo(src.url, file, (d, t) => onProgress?.(name, d, t));
      const expected = src.sha256 || await expectedHash(src);
      if (expected && expected.toLowerCase() !== hash) throw new Error(`${name}: checksum does not match, file discarded`);
      if (!src.archive) {
        const dest = path.join(this.userDir, src.binary);
        await fsp.rm(dest, { force: true });
        await fsp.rename(file, dest);
        await makeRunnable(dest);
        return dest;
      }
      const out = path.join(tmpDir, 'x');
      await fsp.mkdir(out);
      await extract(file, out);
      for (const bin of [src.binary, ...(src.extra || [])]) {
        const found = await findFile(out, bin);
        if (!found) throw new Error(`${bin} not found inside the download`);
        const dest = path.join(this.userDir, bin);
        await fsp.rm(dest, { force: true });
        await fsp.rename(found, dest);
        await makeRunnable(dest);
      }
      return path.join(this.userDir, src.binary);
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

function gunzipTo(src, dest) {
  const zlib = require('zlib');
  const { pipeline } = require('stream/promises');
  return pipeline(fs.createReadStream(src), zlib.createGunzip(), fs.createWriteStream(dest));
}

/** Executable bit; on macOS also clear the "downloaded" flag and make sure Apple Silicon accepts the signature. */
async function makeRunnable(file) {
  if (WIN) return;
  await fsp.chmod(file, 0o755);
  if (!MAC) return;
  const { execFile } = require('child_process');
  const run = (cmd, args) => new Promise(r => execFile(cmd, args, err => r(!err)));
  await run('/usr/bin/xattr', ['-c', file]);
  if (!(await run('/usr/bin/codesign', ['-v', file]))) await run('/usr/bin/codesign', ['--force', '--sign', '-', file]);
}

async function expectedHash(src) {
  if (!src.sums) return null;
  const res = await get(src.sums);
  if (res.statusCode >= 400) { res.body.destroy(); throw new Error('Could not read the published checksum'); }
  const text = await res.body.text();
  if (!src.asset) {
    const m = /\b([0-9a-f]{64})\b/i.exec(text);
    return m && m[1].toLowerCase();
  }
  for (const line of text.split(/\r?\n/)) {
    const m = /^([0-9a-f]{64})\s+\*?(.+)$/i.exec(line.trim());
    if (m && m[2].trim() === src.asset) return m[1].toLowerCase();
  }
  throw new Error('Published checksum not found');
}

async function downloadTo(url, file, onProgress) {
  const res = await get(url);
  if (res.statusCode >= 400) { res.body.destroy(); throw new Error(`Download failed (HTTP ${res.statusCode})`); }
  const total = Number(res.headers['content-length']) || 0;
  const hash = crypto.createHash('sha256');
  const out = fs.createWriteStream(file);
  let done = 0, last = 0;
  for await (const chunk of res.body) {
    hash.update(chunk);
    if (!out.write(chunk)) await new Promise(r => out.once('drain', r));
    done += chunk.length;
    if (Date.now() - last > 250) { last = Date.now(); onProgress?.(done, total); }
  }
  await new Promise((r, j) => out.end(e => (e ? j(e) : r())));
  onProgress?.(done, total);
  return hash.digest('hex');
}

function extract(archive, dest) {
  // Windows 10+ ships bsdtar as tar.exe, which reads zip files too.
  const args = archive.endsWith('.zip') && !WIN ? ['-q', '-o', archive, '-d', dest] : ['-xf', archive, '-C', dest];
  const cmd = archive.endsWith('.zip') && !WIN ? 'unzip' : (WIN ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar');
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true });
    let err = '';
    p.stderr.on('data', d => { err += d; });
    p.on('error', reject);
    p.on('close', code => (code === 0 ? resolve() : reject(new Error(`Could not unpack (${code}): ${err.slice(0, 200)}`))));
  });
}

async function findFile(dir, name) {
  for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { const f = await findFile(p, name); if (f) return f; }
    else if (e.name.toLowerCase() === name.toLowerCase()) return p;
  }
  return null;
}

module.exports = { Tools, SOURCES, downloadTo, extract, makeRunnable };
