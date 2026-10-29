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

test('post texts become posts.txt and posts.csv, merged across runs', async () => {
  const { postInfo, writePosts } = require('../src/core/gallery');
  const ig = postInfo({ category: 'instagram', post_shortcode: 'C1abc', username: 'natgeo', description: 'صورة من الصحراء\n#nature', date: '2024-05-01 10:20:30' });
  assert.deepEqual(ig, { key: 'instagram:C1abc', date: '2024-05-01 10:20', author: '@natgeo', url: 'https://www.instagram.com/p/C1abc/', text: 'صورة من الصحراء\n#nature' });
  const tw = postInfo({ category: 'twitter', tweet_id: 99, author: { name: 'nasa' }, content: 'Launch, "today"', date: '2024-06-01 08:00:00' });
  assert.equal(tw.url, 'https://x.com/nasa/status/99');
  const rd = postInfo({ category: 'reddit', id: 'x1', title: 'Title', selftext: 'Body', permalink: '/r/a/comments/x1/t/' });
  assert.equal(rd.text, 'Title\n\nBody'); assert.equal(rd.url, 'https://www.reddit.com/r/a/comments/x1/t/');
  assert.equal(postInfo({ category: 'tumblr', id: 5, body: '<p>Hi &amp; bye</p>' }).text, 'Hi & bye');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brusk-posts-'));
  await writePosts(dir, [ig]);
  const f = await writePosts(dir, [tw, { ...ig, text: 'edited' }]);
  const txt = fs.readFileSync(f, 'utf8');
  assert.ok(txt.indexOf('nasa') < txt.indexOf('natgeo'), 'newest first');
  assert.ok(txt.includes('edited') && !txt.includes('الصحراء'));
  const csv = fs.readFileSync(path.join(dir, 'posts.csv'), 'utf8');
  assert.ok(csv.startsWith('﻿date,author,link,text'));
  assert.ok(csv.includes('"Launch, ""today"""'));
  assert.equal(csv.trim().split('\r\n').length, 3);
});

test('texts only does not download files or mark them done', { skip: !has }, async () => {
  const PNG = fs.readFileSync(path.join(__dirname, '..', 'assets', 'tray.png'));
  const srv = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'image/png', 'content-length': PNG.length }); res.end(PNG); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brusk-gdl-'));
  const m = new Manager({ dataDir: path.join(dir, 'data'), tools: new Tools(null, path.join(dir, 'tools')) });
  await m.init();
  await m.updateSettings({ downloadDir: path.join(dir, 'dl'), categoryFolders: true });
  const wait = id => new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), 60000);
    const c = () => { const d = m.find(id); if (['completed', 'error'].includes(d.status)) { clearTimeout(t); m.off('changed', c); resolve(d); } };
    m.on('changed', c); c();
  });
  const url = `http://127.0.0.1:${srv.address().port}/pic.png`;
  const a = await wait(m.add({ url, kind: 'gallery', gallery: { text: 'only' } }).id);
  assert.equal(a.status, 'error');            // a bare picture link has no post text
  assert.equal(a.error, 'NOTHING_FOUND');
  const b = await wait(m.add({ url, kind: 'gallery', force: true, gallery: { text: 'with' } }).id);
  assert.equal(b.status, 'completed', b.error);
  assert.equal(b.downloaded, 1, 'the picture was not marked as done by the texts-only run');
  await m.shutdown(); srv.close();
});
