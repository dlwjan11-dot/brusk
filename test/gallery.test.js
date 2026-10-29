'use strict';
// Needs gallery-dl on PATH (pip install gallery-dl).
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { Manager } = require('../src/core/manager');
const { Tools } = require('../src/core/tools');
const { isGallerySite, describe: info, classify } = require('../src/core/gallery');

let has = true;
try { execFileSync('gallery-dl', ['--version']); } catch { has = false; }

test('which links are picture/post pages', () => {
  for (const u of ['https://www.instagram.com/natgeo/', 'https://www.instagram.com/p/C1abc/', 'https://x.com/nasa', 'https://twitter.com/nasa/status/1',
    'https://www.facebook.com/photo/?fbid=1', 'https://www.facebook.com/natgeo', 'https://www.threads.net/@zuck', 'https://www.reddit.com/gallery/abc', 'https://bsky.app/profile/a.b'])
    assert.ok(isGallerySite(u), u);
  for (const u of ['https://www.youtube.com/watch?v=1', 'https://www.facebook.com/watch?v=1', 'https://www.facebook.com/reel/1', 'https://www.tiktok.com/@a/video/1', 'https://example.com/a.zip'])
    assert.ok(!isGallerySite(u), u);
  assert.deepEqual(info('https://www.instagram.com/natgeo/'), { site: 'Instagram', who: '@natgeo', single: false });
  assert.equal(info('https://www.instagram.com/p/C1abc/').single, true);
  assert.equal(info('https://x.com/nasa/status/123').who, '@nasa');
  assert.equal(classify('[instagram][error] HttpError: \'401 Unauthorized\' ... login required'), 'NEED_LOGIN');
  assert.equal(classify("[gallery-dl][error] Unsupported URL 'x'"), 'UNSUPPORTED');
});

test('a gallery job downloads every file, and a second run skips what is there', { skip: !has }, async () => {
  const PNG = fs.readFileSync(path.join(__dirname, '..', 'assets', 'tray.png'));
  const srv = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'image/png', 'content-length': PNG.length }); res.end(PNG); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brusk-gdl-'));
  const m = new Manager({ dataDir: path.join(dir, 'data'), tools: new Tools(null, path.join(dir, 'tools')) });
  await m.init();
  await m.updateSettings({ downloadDir: path.join(dir, 'dl'), categoryFolders: true });
  const wait = id => new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout ' + m.find(id)?.status + ' ' + m.find(id)?.error)), 60000);
    const c = () => { const d = m.find(id); if (['completed', 'error'].includes(d.status)) { clearTimeout(t); m.off('changed', c); resolve(d); } };
    m.on('changed', c); c();
  });
  const url = `http://127.0.0.1:${srv.address().port}/photo1.png`;
  const { id } = m.add({ url, kind: 'gallery' });
  const d = await wait(id);
  assert.equal(d.status, 'completed', d.error);
  assert.equal(d.downloaded, 1);
  assert.ok(d.bytes === PNG.length, 'bytes ' + d.bytes);
  assert.ok(d.path.startsWith(path.join(dir, 'dl', 'Images')), d.path);
  const again = m.add({ url, kind: 'gallery', force: true });
  const d2 = await wait(again.id);
  assert.equal(d2.status, 'completed', d2.error);
  assert.equal(d2.downloaded, 0, 'already there, skipped');
  const bad = m.add({ url: 'https://example.invalid/nothing', kind: 'gallery' });
  const d3 = await wait(bad.id);
  assert.equal(d3.status, 'error');
  await m.shutdown(); srv.close();
});
