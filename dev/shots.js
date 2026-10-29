// Development helper: run Brusk with demo data under a virtual display and save screenshots.
// usage: node dev/shots.js <outdir> [lang] [theme]
'use strict';
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const out = path.resolve(process.argv[2] || 'shots');
const lang = process.argv[3] || 'ar';
const theme = process.argv[4] || 'light';
fs.mkdirSync(out, { recursive: true });

const FILES = { '/ubuntu-24.04.3-desktop-amd64.iso': 6.1e9, '/Blender-4.5-windows-x64.msi': 3.6e8, '/Final_Cut_Tutorial_4K.mp4': 2.2e9, '/Report.pdf': 4.2e6 };
const server = http.createServer((req, res) => {
  const total = FILES[decodeURIComponent(req.url.split('?')[0])];
  if (!total) { res.writeHead(404); return res.end(); }
  const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
  const start = m ? +m[1] : 0, end = m && m[2] ? +m[2] : total - 1;
  res.writeHead(m ? 206 : 200, { 'content-length': end - start + 1, 'accept-ranges': 'bytes', etag: '"x"', ...(m ? { 'content-range': `bytes ${start}-${end}/${total}` } : {}) });
  if (req.url.includes('Report')) return res.end(Buffer.alloc(end - start + 1));
  const chunk = Buffer.alloc(64 * 1024);
  const iv = setInterval(() => { if (!res.write(chunk)) {} }, 18);
  res.on('close', () => clearInterval(iv));
});

server.listen(0, '127.0.0.1', () => {
  const base = `http://127.0.0.1:${server.address().port}`;
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'barq-ui-'));
  const dl = path.join(ud, 'Downloads');
  fs.mkdirSync(dl, { recursive: true });
  const now = Date.now();
  const iso = m => new Date(now - m * 60000).toISOString();
  const done = (id, name, cat, size, m, kind = 'http') => ({ id, kind, url: `https://example.com/${encodeURIComponent(name)}`, filename: name, directory: dl, category: cat, status: 'completed', total: size, downloaded: size, createdAt: iso(m + 5), completedAt: iso(m), order: m, path: path.join(dl, name), segments: [] });
  const downloads = [
    done('c1', 'تقرير المشروع النهائي 2026.pdf', 'documents', 8.4e6, 400),
    done('c2', 'Adobe Photoshop 2026 Setup.exe', 'programs', 2.9e9, 900),
    done('c3', 'فيروز - ألبوم كامل.zip', 'compressed', 3.1e8, 1500),
    done('c4', 'Sintel (2010) [1080p]', 'torrents', 1.29e9, 2000, 'torrent'),
    { id: 'e1', kind: 'http', url: 'https://cdn.example.com/private/lesson-07.mp4', filename: 'lesson-07.mp4', directory: dl, category: 'video', status: 'error', error: 'HTTP 403', total: 5.4e8, downloaded: 1.2e8, createdAt: iso(60), order: 60, segments: [] },
    { id: 'p1', kind: 'http', url: `${base}/Blender-4.5-windows-x64.msi`, filename: 'Blender-4.5-windows-x64.msi', directory: dl, category: 'programs', status: 'paused', total: 3.6e8, downloaded: 1.5e8, createdAt: iso(30), order: 30, segments: [] },
    { id: 'w1', kind: 'video', url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', filename: 'Big Buck Bunny 60fps 4K - Official Blender Foundation Short Film', directory: dl, category: 'video', status: 'waiting', total: 6.7e8, downloaded: 0, createdAt: iso(20), order: 20, video: { quality: 'h1080' }, segments: [] },
    { id: 'd1', kind: 'http', url: `${base}/ubuntu-24.04.3-desktop-amd64.iso`, filename: null, directory: dl, category: 'compressed', status: 'queued', total: null, downloaded: 0, createdAt: iso(2), order: 1, segments: [] },
    { id: 'd2', kind: 'http', url: `${base}/Final_Cut_Tutorial_4K.mp4`, filename: null, directory: dl, category: 'video', status: 'queued', total: null, downloaded: 0, createdAt: iso(1), order: 2, segments: [] },
  ];
  fs.writeFileSync(path.join(ud, 'downloads.json'), JSON.stringify(downloads));
  fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ language: lang, theme, downloadDir: dl, categoryFolders: false, connections: 8, maxConcurrent: 3, clipboardMonitor: false }));

  const js = s => encodeURIComponent(s);
  const steps = [
    process.env.FAKE_MAC ? `main=${js("document.documentElement.classList.add('mac')")}` : 'main',
    `details=${js("document.querySelectorAll('.row')[0].click()")}`,
    `parts=${js("document.querySelector('[data-tab=parts]')?.click()")}`,
    `add=${js(`document.querySelector('[data-close]')?.click(); document.getElementById('btn-add').click(); setTimeout(()=>{const ta=document.getElementById('links'); ta.value='${base}/Report.pdf\\n${base}/missing.zip'; ta.dispatchEvent(new Event('input'));},200)`)}`,
    `settings=${js("document.querySelector('.overlay')?.remove(); document.getElementById('btn-settings').click()")}`,
    `sched=${js("document.querySelector('[data-s=schedule]').click()")}`,
    `browser=${js("document.querySelector('[data-s=browser]').click()")}`,
    `menu=${js("document.querySelector('.overlay')?.remove(); const r=document.querySelectorAll('.row')[1]; r.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:500,clientY:220}))")}`,
  ].join(',');
  const electron = require('electron');
  const p = spawn('xvfb-run', ['-a', '-s', '-screen 0 1400x900x24', electron, '--no-sandbox', '--disable-gpu', '.'], {
    cwd: path.join(__dirname, '..'), stdio: 'inherit',
    env: { ...process.env, BARQ_USER_DATA: ud, BARQ_SHOT: out, BARQ_SHOT_STEPS: steps, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
  });
  p.on('exit', code => { server.close(); console.log('electron exited', code); process.exit(0); });
});
