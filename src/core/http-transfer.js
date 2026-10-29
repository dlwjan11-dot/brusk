'use strict';
/**
 * One HTTP(S) download on several connections.
 *
 * Fixes over the three projects we reviewed:
 *  - Dynamic splitting (like IDM): a connection that runs out of work takes half of the
 *    biggest part still downloading, so every connection stays busy until the end.
 *    (Awesome Downloader split once and left finished connections idle; Gunda used one connection.)
 *  - Parts are written straight into one pre-sized file, no joining step at the end
 *    (Awesome Downloader wrote separate .part files and then copied them together).
 *  - One failing connection does not cancel the others: it retries with back-off,
 *    or hands its part back to the remaining connections.
 *  - A busy server (429/503) gets fewer connections for a while.
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { get, probe, HttpError, parseRetryAfter, header } = require('./http');
const { takeAll, sleep, uniquePath } = require('./util');

const MIN_SPLIT = 256 * 1024;      // never split a part smaller than 2 x this
const MAX_RETRIES = 12;            // consecutive failures without progress
const hostPenalty = new Map();     // host -> { max, until }

function hostLimit(url, wanted) {
  try {
    const p = hostPenalty.get(new URL(url).host);
    if (p && p.until > Date.now()) return Math.max(1, Math.min(wanted, p.max));
  } catch {}
  return wanted;
}
function penalize(url, active) {
  try {
    const host = new URL(url).host;
    const prev = hostPenalty.get(host);
    const max = Math.max(1, Math.min(prev && prev.until > Date.now() ? prev.max : active, active) - 1);
    hostPenalty.set(host, { max, until: Date.now() + 10 * 60_000 });
  } catch {}
}

class NoRangeError extends Error {}

class HttpTransfer {
  /**
   * @param d download record (mutated: segments, total, downloaded, path, ...)
   * @param opts { connections, limiters: [RateLimiter], save: () => void, takenPaths: Set }
   */
  constructor(d, opts) { this.d = d; this.opts = opts; }

  async run(signal) {
    const d = this.d;
    const info = await withRetry(() => probe(d.url, d.headers, signal), signal);
    d.finalUrl = info.finalUrl;
    if (!d.filenameLocked && info.name && !d.segments?.some(s => s.pos > s.start)) d.suggestedName = info.name;

    // Resume only if the file on the server is still the same file.
    const temp = d.tempPath;
    const hasProgress = d.segments?.some(s => s.pos > s.start) && temp && fs.existsSync(temp);
    if (hasProgress) {
      const same = info.ranges && info.total === d.total && (!d.validator || !info.validator || d.validator === info.validator);
      if (!same) {
        d.notice = !info.ranges ? 'restart_no_resume' : 'restart_changed';
        d.segments = [];
        await fsp.rm(temp, { force: true });
      }
    } else if (d.segments?.length) {
      d.segments = [];
    }
    d.total = info.total;
    d.validator = info.validator;
    d.resumable = Boolean(info.ranges);
    d.mime = info.type;

    if (!d.path) {
      const { safeFilename } = require('./util');
      d.filename = safeFilename(d.filename || info.name || 'download');
      d.path = uniquePath(d.directory, d.filename, this.opts.takenPaths);
      d.filename = path.basename(d.path);
      d.tempPath = d.path + '.barq';
    }
    await fsp.mkdir(path.dirname(d.path), { recursive: true });

    if (!d.segments?.length) {
      d.segments = [{ start: 0, end: info.total != null ? info.total - 1 : null, pos: 0 }];
    }
    if (info.total != null && !hasProgress) await checkFreeSpace(path.dirname(d.path), info.total);

    // Open (or create) the destination and give it its final size up front.
    const fh = await fsp.open(d.tempPath, fs.existsSync(d.tempPath) ? 'r+' : 'w+');
    try {
      if (info.total != null) {
        const st = await fh.stat();
        if (st.size !== info.total) await fh.truncate(info.total);
      }
      try {
        await this.download(fh, info, signal);
      } catch (e) {
        if (!(e instanceof NoRangeError)) throw e;
        // Server ignored the range request: start over on one connection.
        d.notice = 'restart_no_resume';
        d.resumable = false;
        d.segments = [{ start: 0, end: info.total != null ? info.total - 1 : null, pos: 0 }];
        await fh.truncate(0);
        if (info.total != null) await fh.truncate(info.total);
        await this.download(fh, { ...info, ranges: false }, signal);
      }
      await fh.sync().catch(() => {});
    } finally {
      await fh.close();
    }

    // Unknown-size downloads: trim to what was really written.
    if (d.total == null) {
      d.total = d.segments.reduce((n, s) => n + (s.pos - s.start), 0);
      await fsp.truncate(d.tempPath, d.total);
    }
    let final = d.path;
    if (fs.existsSync(final)) final = uniquePath(path.dirname(final), path.basename(final), this.opts.takenPaths);
    await fsp.rename(d.tempPath, final);
    d.path = final;
    d.filename = path.basename(final);
    d.downloaded = d.total;
    d.connections = 0;
  }

  async download(fh, info, signal) {
    const d = this.d;
    const inner = new AbortController();
    const onAbort = () => inner.abort();
    signal.addEventListener('abort', onAbort, { once: true });
    const wanted = info.ranges && info.total > MIN_SPLIT * 2 ? Math.max(1, this.opts.connections) : 1;
    let fatal = null;
    let active = 0;
    const limiters = this.opts.limiters;

    const remaining = s => (s.end == null ? Infinity : s.end - s.pos + 1);
    const claim = () => {
      // 1) a part nobody is working on
      const free = d.segments.find(s => !s.active && remaining(s) > 0);
      if (free) { free.active = true; return free; }
      if (!info.ranges) return null;
      // 2) take half of the biggest running part
      let big = null;
      for (const s of d.segments) if (s.active && remaining(s) >= MIN_SPLIT * 2 && (!big || remaining(s) > remaining(big))) big = s;
      if (!big) return null;
      const mid = big.pos + Math.floor(remaining(big) / 2);
      const part = { start: mid, end: big.end, pos: mid, active: true };
      big.end = mid - 1;
      d.segments.push(part);
      d.segments.sort((a, b) => a.start - b.start);
      return part;
    };

    const worker = async (n) => {
      // stagger new connections a little so the first answers show if the server is happy
      if (n > 0) await sleep(Math.min(800, n * 60), inner.signal).catch(() => {});
      for (;;) {
        if (inner.signal.aborted) return;
        if (n >= hostLimit(info.finalUrl, wanted)) return;   // server asked for fewer connections
        const seg = claim();
        if (!seg) return;
        active++; d.connections = active;
        try {
          await this.fetchPart(fh, seg, info, limiters, inner.signal, () => active);
        } catch (e) {
          seg.active = false;
          if (e?.handOff) { active--; d.connections = active; if (active > 0) return; await sleep(e.wait || 5000, inner.signal).catch(() => {}); continue; }
          if (!inner.signal.aborted) { fatal = fatal || e; inner.abort(); }
          active--; d.connections = active;
          return;
        }
        seg.active = false;
        active--; d.connections = active;
      }
    };

    try {
      await Promise.all(Array.from({ length: wanted }, (_, i) => worker(i)));
    } finally {
      signal.removeEventListener('abort', onAbort);
      for (const s of d.segments) delete s.active;
    }
    if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : Object.assign(new Error('Aborted'), { name: 'AbortError' });
    if (fatal) throw fatal;
    // merge finished neighbours so the saved list stays small
    d.segments = mergeDone(d.segments);
    const left = d.segments.find(s => s.end != null && s.pos <= s.end);
    if (left) throw new Error('Download stopped before every part finished');
  }

  async fetchPart(fh, seg, info, limiters, signal, activeCount) {
    const d = this.d;
    let failures = 0;
    for (;;) {
      if (seg.end != null && seg.pos > seg.end) return;
      const range = info.ranges ? `bytes=${seg.pos}-${seg.end ?? ''}` : undefined;
      let res;
      const before = seg.pos;
      try {
        res = await get(info.finalUrl, d.headers, { signal, range });
        if (res.statusCode === 200 && info.ranges && seg.pos > 0) { res.body.destroy(); throw new NoRangeError(); }
        if (res.statusCode >= 400) {
          res.body.destroy();
          throw new HttpError(res.statusCode, undefined, parseRetryAfter(header(res, 'retry-after')));
        }
        if (!info.ranges && seg.pos > 0) { // can't continue mid-file without ranges
          res.body.destroy(); throw new NoRangeError();
        }
        for await (const chunk of res.body) {
          let buf = chunk;
          if (seg.end != null) {
            const room = seg.end - seg.pos + 1;
            if (room <= 0) break;                 // another connection took the rest of this part
            if (buf.length > room) buf = buf.subarray(0, room);
          }
          await takeAll(limiters, buf.length);
          let off = 0;
          while (off < buf.length) {
            const { bytesWritten } = await fh.write(buf, off, buf.length - off, seg.pos);
            off += bytesWritten; seg.pos += bytesWritten;
          }
          d.downloaded = d.segments.reduce((n, s) => n + (s.pos - s.start), 0);
          if (seg.end != null && seg.pos > seg.end) break;
        }
        res.body.destroy();
        if (seg.end == null) { seg.end = seg.pos - 1; return; }   // unknown size: stream ended
        if (seg.pos > seg.end) return;
        throw new Error('Connection closed early');
      } catch (e) {
        res?.body?.destroy?.();
        if (signal.aborted || e?.name === 'AbortError') throw e;
        if (e instanceof NoRangeError) throw e;
        if (e instanceof HttpError && e.permanent) throw e;
        if (seg.pos > before) failures = 0;
        failures++;
        if (e instanceof HttpError && e.busy) {
          penalize(info.finalUrl, activeCount());
          if (activeCount() > 1) throw Object.assign(new Error('busy'), { handOff: true, wait: e.retryAfter });
        }
        if (failures > MAX_RETRIES) throw e;
        if (!info.ranges && seg.pos > 0) throw new NoRangeError();
        const wait = e.retryAfter ?? Math.min(30_000, 1000 * 2 ** Math.min(failures - 1, 5));
        d.retrying = (d.retrying || 0) + 1;
        await sleep(wait, signal);
      }
    }
  }
}

function mergeDone(segs) {
  const out = [];
  for (const s of [...segs].sort((a, b) => a.start - b.start)) {
    const prev = out[out.length - 1];
    if (prev && prev.end != null && prev.pos > prev.end && s.end != null && s.pos > s.end && prev.end + 1 === s.start) {
      prev.end = s.end; prev.pos = s.pos;
    } else out.push({ start: s.start, end: s.end, pos: s.pos });
  }
  return out;
}

async function withRetry(fn, signal, tries = 4) {
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (e) {
      if (signal.aborted || (e instanceof HttpError && e.permanent) || i >= tries - 1) throw e;
      await sleep(e.retryAfter ?? 1000 * 2 ** i, signal);
    }
  }
}

async function checkFreeSpace(dir, need) {
  try {
    const st = await fsp.statfs(dir);
    const free = Number(st.bavail) * Number(st.bsize);
    if (free < need + 50 * 1024 * 1024) {
      const e = new Error('Not enough free disk space'); e.code = 'NOSPACE'; e.permanent = true; throw e;
    }
  } catch (e) { if (e.code === 'NOSPACE') throw e; }
}

module.exports = { HttpTransfer, mergeDone, hostPenalty };
