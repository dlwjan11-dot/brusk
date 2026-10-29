'use strict';
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { Manager } = require('../src/core/manager');
const { safeFilename, filenameFromDisposition, RateLimiter } = require('../src/core/util');
const { readTorrent, magnetHash } = require('../src/core/aria2');

const SIZE = 6 * 1024 * 1024;
const DATA = crypto.randomBytes(SIZE);
const HASH = crypto.createHash('sha256').update(DATA).digest('hex');

/** Test server: ranges, slow streaming, flaky connections, busy answers. */
function server(opts = {}) {
  const stats = { requests: 0, ranges: [], maxParallel: 0, open: 0 };
  const s = http.createServer(async (req, res) => {
    stats.requests++;
    if (req.url.startsWith('/redirect')) { res.writeHead(302, { location: '/file.bin' }); return res.end(); }
    if (req.url.startsWith('/missing')) { res.writeHead(404); return res.end(); }
    let start = 0, end = SIZE - 1, partial = false;
    const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
    if (m && !opts.noRanges) { start = +m[1]; end = m[2] ? Math.min(+m[2], SIZE - 1) : SIZE - 1; partial = true; }
    stats.ranges.push([start, end]);
    if (opts.busyAfter && stats.open >= opts.busyAfter) { res.writeHead(503, { 'retry-after': '1' }); return res.end(); }
    if (opts.flaky && stats.requests % 3 === 0 && end - start > 1) {
      res.writeHead(partial ? 206 : 200, { 'content-length': end - start + 1, ...(partial ? { 'content-range': `bytes ${start}-${end}/${SIZE}` } : {}) });
      res.write(DATA.subarray(start, start + 1000));
      return setTimeout(() => res.destroy(), 20);
    }
    const headers = { 'content-length': end - start + 1, etag: '"v1"', 'content-disposition': 'attachment; filename*=UTF-8\'\'%D9%85%D9%84%D9%81.bin' };
    if (partial) headers['content-range'] = `bytes ${start}-${end}/${SIZE}`;
    else if (!opts.noRanges) headers['accept-ranges'] = 'bytes';
    res.writeHead(partial ? 206 : 200, headers);
    stats.open++; stats.maxParallel = Math.max(stats.maxParallel, stats.open);
    res.on('close', () => { stats.open--; });
    const chunk = 64 * 1024;
    for (let p = start; p <= end && !res.destroyed; p += chunk) {
      const ok = res.write(DATA.subarray(p, Math.min(end + 1, p + chunk)));
      if (opts.delay) await new Promise(r => setTimeout(r, opts.delay));
      else if (!ok) await new Promise(r => res.once('drain', r));
    }
    res.end();
  });
  return new Promise(r => s.listen(0, '127.0.0.1', () => r({ s, url: `http://127.0.0.1:${s.address().port}`, stats })));
}

async function manager(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'barq-test-'));
  const m = new Manager({ dataDir: path.join(dir, 'data'), tools: { find: () => null } });
  await m.init();
  await m.updateSettings({ downloadDir: path.join(dir, 'dl'), categoryFolders: false, ...extra });
  return { m, dir };
}
function waitFor(m, id, statuses, ms = 30000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout, status=' + m.find(id)?.status + ' err=' + m.find(id)?.error)), ms);
    const check = () => { const d = m.find(id); if (d && statuses.includes(d.status)) { clearTimeout(t); m.off('changed', check); resolve(d); } };
    m.on('changed', check); check();
  });
}
const sha = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

test('multi-connection download with dynamic splitting, UTF-8 file name', async () => {
  const { s, url, stats } = await server({ delay: 15 });
  const { m } = await manager({ connections: 8 });
  const { id } = m.add({ url: url + '/redirect' });
  const d = await waitFor(m, id, ['completed', 'error']);
  assert.equal(d.status, 'completed', d.error);
  assert.equal(path.basename(d.path), 'ملف.bin');
  assert.equal(sha(d.path), HASH);
  assert.ok(stats.maxParallel >= 6, 'parallel connections: ' + stats.maxParallel);
  assert.ok(!fs.existsSync(d.path + '.brusk'));
  await m.shutdown(); s.close();
});

test('pause and resume continue from where it stopped', async () => {
  const { s, url } = await server({ delay: 40 });
  const { m } = await manager({ connections: 4 });
  const { id } = m.add({ url: url + '/file.bin' });
  await new Promise(r => setTimeout(r, 600));
  await m.control(id, 'pause');
  const paused = await waitFor(m, id, ['paused']);
  const got = paused.downloaded;
  assert.ok(got > 0 && got < SIZE, 'partial ' + got);
  await m.control(id, 'resume');
  const d = await waitFor(m, id, ['completed', 'error']);
  assert.equal(d.status, 'completed', d.error);
  assert.equal(sha(d.path), HASH);
  await m.shutdown(); s.close();
});

test('flaky connections are retried without failing the download', async () => {
  const { s, url } = await server({ flaky: true, delay: 1 });
  const { m } = await manager({ connections: 6 });
  const { id } = m.add({ url: url + '/file.bin' });
  const d = await waitFor(m, id, ['completed', 'error'], 60000);
  assert.equal(d.status, 'completed', d.error);
  assert.equal(sha(d.path), HASH);
  await m.shutdown(); s.close();
});

test('busy server (503) gets fewer connections, download still finishes', async () => {
  const { s, url } = await server({ busyAfter: 2, delay: 2 });
  const { m } = await manager({ connections: 8 });
  const { id } = m.add({ url: url + '/file.bin?busy' });
  const d = await waitFor(m, id, ['completed', 'error'], 60000);
  assert.equal(d.status, 'completed', d.error);
  assert.equal(sha(d.path), HASH);
  await m.shutdown(); s.close();
});

test('server without ranges downloads on one connection', async () => {
  const { s, url, stats } = await server({ noRanges: true });
  const { m } = await manager({ connections: 8 });
  const { id } = m.add({ url: url + '/file.bin' });
  const d = await waitFor(m, id, ['completed', 'error']);
  assert.equal(d.status, 'completed', d.error);
  assert.equal(sha(d.path), HASH);
  assert.equal(d.resumable, false);
  assert.ok(stats.requests <= 3);
  await m.shutdown(); s.close();
});

test('404 fails right away instead of retrying forever', async () => {
  const { s, url, stats } = await server();
  const { m } = await manager();
  const { id } = m.add({ url: url + '/missing' });
  const d = await waitFor(m, id, ['completed', 'error']);
  assert.equal(d.status, 'error');
  assert.equal(d.error, 'HTTP 404');
  assert.ok(stats.requests <= 2);
  await m.shutdown(); s.close();
});

test('speed limit is respected', async () => {
  const { s, url } = await server();
  const { m } = await manager({ connections: 4, speedLimit: 2048 }); // 2 MB/s
  const t0 = Date.now();
  const { id } = m.add({ url: url + '/file.bin' });
  const d = await waitFor(m, id, ['completed', 'error'], 20000);
  const secs = (Date.now() - t0) / 1000;
  assert.equal(d.status, 'completed');
  assert.ok(secs > 2.0, 'too fast: ' + secs);
  await m.shutdown(); s.close();
});

test('queue runs at most maxConcurrent downloads, duplicates are caught', async () => {
  const { s, url } = await server({ delay: 25 });
  const { m } = await manager({ maxConcurrent: 2, connections: 2 });
  await new Promise(r => setTimeout(r, 10));
  const ids = [1, 2, 3].map(i => m.add({ url: `${url}/file.bin?n=${i}` }).id);
  assert.equal(m.add({ url: `${url}/file.bin?n=1` }).duplicate, true);
  await new Promise(r => setTimeout(r, 300));
  assert.equal(m.jobs.size, 2);
  for (const id of ids) { const d = await waitFor(m, id, ['completed', 'error'], 60000); assert.equal(d.status, 'completed', d.error); }
  const names = ids.map(id => path.basename(m.find(id).path)).sort();
  assert.deepEqual(names, ['ملف (1).bin', 'ملف (2).bin', 'ملف.bin']);
  await m.shutdown(); s.close();
});

test('state survives a restart (resume after closing the app)', async () => {
  const { s, url } = await server({ delay: 8 });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'barq-test-'));
  const mk = async () => { const m = new Manager({ dataDir: path.join(dir, 'data'), tools: { find: () => null } }); await m.init(); await m.updateSettings({ downloadDir: path.join(dir, 'dl'), categoryFolders: false, connections: 4 }); return m; };
  let m = await mk();
  const { id } = m.add({ url: url + '/file.bin', headers: { cookie: 'a=1' } });
  await new Promise(r => setTimeout(r, 700));
  await m.shutdown();
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'data', 'downloads.json'), 'utf8'))[0];
  assert.ok(saved.downloaded > 0 && saved.secret && !saved.headers, 'cookies saved apart');
  m = await mk();
  assert.equal(m.find(id).headers.cookie, 'a=1');
  const d = await waitFor(m, id, ['completed', 'error'], 30000);
  assert.equal(d.status, 'completed', d.error);
  assert.equal(sha(d.path), HASH);
  await m.shutdown(); s.close();
});

test('file names: unsafe characters, long names keep their extension', () => {
  assert.equal(safeFilename('a<b>:c?.zip'), 'a_b__c_.zip');
  assert.equal(safeFilename('CON.txt'), '_CON.txt');
  const long = safeFilename('x'.repeat(400) + '.mp4');
  assert.ok(long.endsWith('.mp4') && Buffer.byteLength(long) <= 180);
  assert.equal(filenameFromDisposition('attachment; filename="r\\"x.pdf"'), 'r"x.pdf');
  assert.equal(filenameFromDisposition("attachment; filename*=UTF-8''%E2%82%AC%20rates.pdf"), '€ rates.pdf');
  assert.equal(filenameFromDisposition("attachment; filename*=UTF-8''%E2%8; filename=\"ok.pdf\""), 'ok.pdf');
});

test('torrent reader and magnet hash', () => {
  const enc = v => typeof v === 'number' ? `i${v}e` : Array.isArray(v) ? 'l' + v.map(enc).join('') + 'e' : typeof v === 'object' ? 'd' + Object.keys(v).sort().map(k => enc(k) + enc(v[k])).join('') + 'e' : `${Buffer.byteLength(v)}:${v}`;
  const info = { name: 'مجلد', 'piece length': 16384, pieces: 'x'.repeat(20), files: [{ length: 5, path: ['a.txt'] }, { length: 7, path: ['sub', 'b.txt'] }] };
  const t = readTorrent(Buffer.from(enc({ announce: 'udp://x', info })));
  assert.equal(t.name, 'مجلد');
  assert.equal(t.total, 12);
  assert.deepEqual(t.files.map(f => f.path), ['مجلد/a.txt', 'مجلد/sub/b.txt']);
  assert.match(t.infoHash, /^[0-9a-f]{40}$/);
  const bad = { ...info, files: [{ length: 1, path: ['..', 'evil'] }] };
  assert.throws(() => readTorrent(Buffer.from(enc({ info: bad }))));
  assert.equal(magnetHash('magnet:?xt=urn:btih:c12fe1c06bba254a9dc9f519b335aa7c1367a88a'), 'c12fe1c06bba254a9dc9f519b335aa7c1367a88a');
  assert.equal(magnetHash('magnet:?xt=urn:btih:YEX6DQDLXISUVHOJ6UM3GNNKPQJWPKEK'), 'c12fe1c06bba254a9dc9f519b335aa7c1367a88a');
});

test('rate limiter math', async () => {
  const l = new RateLimiter(100_000);
  const t0 = Date.now();
  for (let i = 0; i < 30; i++) await l.take(10_000);
  const secs = (Date.now() - t0) / 1000;
  assert.ok(secs > 1.5 && secs < 4, String(secs));
});
