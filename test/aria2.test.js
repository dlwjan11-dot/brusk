'use strict';
// Needs an aria2c binary: BARQ_ARIA2=/path/to/aria2c node --test test/aria2.test.js
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { Manager } = require('../src/core/manager');

const BIN = process.env.BARQ_ARIA2;
const skip = !BIN || !fs.existsSync(BIN);

function benc(v) {
  if (Buffer.isBuffer(v)) return Buffer.concat([Buffer.from(`${v.length}:`), v]);
  if (typeof v === 'number') return Buffer.from(`i${v}e`);
  if (typeof v === 'string') return benc(Buffer.from(v));
  if (Array.isArray(v)) return Buffer.concat([Buffer.from('l'), ...v.map(benc), Buffer.from('e')]);
  return Buffer.concat([Buffer.from('d'), ...Object.keys(v).sort().flatMap(k => [benc(k), benc(v[k])]), Buffer.from('e')]);
}

function makeTorrent(name, files, webseed) {
  const pieceLen = 16384;
  const all = Buffer.concat(files.map(f => f.data));
  const pieces = [];
  for (let i = 0; i < all.length; i += pieceLen) pieces.push(crypto.createHash('sha1').update(all.subarray(i, i + pieceLen)).digest());
  const info = { name, 'piece length': pieceLen, pieces: Buffer.concat(pieces), files: files.map(f => ({ length: f.data.length, path: f.path })) };
  return benc({ info, 'url-list': [webseed] });
}

async function mk() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'barq-a2-'));
  const m = new Manager({ dataDir: path.join(dir, 'data'), tools: { find: n => (n === 'aria2c' ? BIN : null) } });
  await m.init();
  await m.updateSettings({ downloadDir: path.join(dir, 'dl'), categoryFolders: false, seedRatio: 0, extraTrackers: false });
  return { m, dir };
}
function waitFor(m, id, statuses, ms = 60000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout ' + m.find(id)?.status + ' ' + m.find(id)?.error)), ms);
    const check = () => { const d = m.find(id); if (d && statuses.includes(d.status)) { clearTimeout(t); m.off('changed', check); resolve(d); } };
    m.on('changed', check); check();
  });
}

test('torrent with chosen files downloads through aria2 (web seed)', { skip }, async () => {
  const files = [
    { path: ['a.bin'], data: crypto.randomBytes(300_000) },
    { path: ['sub', 'b.bin'], data: crypto.randomBytes(500_000) },
    { path: ['c.bin'], data: crypto.randomBytes(200_000) },
  ];
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'barq-seed-'));
  for (const f of files) { const p = path.join(root, 'مجلد', ...f.path); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, f.data); }
  const srv = http.createServer((req, res) => {
    const p = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
    const data = fs.readFileSync(p);
    const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
    const s = m ? +m[1] : 0, e = m && m[2] ? +m[2] : data.length - 1;
    res.writeHead(m ? 206 : 200, { 'content-length': e - s + 1, 'accept-ranges': 'bytes', ...(m ? { 'content-range': `bytes ${s}-${e}/${data.length}` } : {}) });
    res.end(data.subarray(s, e + 1));
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const torrent = makeTorrent('مجلد', files, `http://127.0.0.1:${srv.address().port}/`);
  const { m } = await mk();
  const info = await m.torrentInfo({ base64: torrent.toString('base64') });
  assert.equal(info.files.length, 3);
  const { id } = m.add({ url: 'torrent:' + info.infoHash, kind: 'torrent', torrent: { base64: info.base64, selected: [1, 3], name: info.name } });
  const d = await waitFor(m, id, ['completed', 'error']);
  assert.equal(d.status, 'completed', d.error);
  const out = path.join(m.settings.downloadDir, 'مجلد');
  assert.ok(fs.readFileSync(path.join(out, 'a.bin')).equals(files[0].data));
  assert.ok(fs.readFileSync(path.join(out, 'c.bin')).equals(files[2].data));
  assert.ok(!fs.existsSync(path.join(out, 'sub', 'b.bin')), 'unselected file must not be kept');
  // FTP/other links go through aria2 too
  const r2 = m.add({ url: `http://127.0.0.1:${srv.address().port}/${encodeURIComponent('مجلد')}/sub/b.bin`, kind: 'ftp', filename: 'b-copy.bin' });
  const d2 = await waitFor(m, r2.id, ['completed', 'error']);
  assert.equal(d2.status, 'completed', d2.error);
  assert.ok(fs.readFileSync(d2.path).equals(files[1].data));
  await m.shutdown(); srv.close();
});
