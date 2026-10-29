// Fetch the Windows helper tools that ship inside the installer (aria2c.exe, yt-dlp.exe),
// checking each against its published SHA-256 before keeping it.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const out = path.join(__dirname, '..', 'vendor', 'win');
fs.mkdirSync(out, { recursive: true });

async function get(url) {
  const r = await fetch(url, { redirect: 'follow' });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}
const sha = b => crypto.createHash('sha256').update(b).digest('hex');

(async () => {
  // aria2 1.37.0 (pinned)
  if (!fs.existsSync(path.join(out, 'aria2c.exe'))) {
    const zip = await get('https://github.com/aria2/aria2/releases/download/release-1.37.0/aria2-1.37.0-win-64bit-build1.zip');
    if (sha(zip) !== '67d015301eef0b612191212d564c5bb0a14b5b9c4796b76454276a4d28d9b288') throw new Error('aria2 checksum mismatch');
    const tmp = path.join(out, 'aria2.zip');
    fs.writeFileSync(tmp, zip);
    execFileSync(process.platform === 'win32' ? 'tar' : 'unzip', process.platform === 'win32' ? ['-xf', tmp, '-C', out] : ['-o', '-q', '-j', tmp, '*/aria2c.exe', '*/COPYING', '-d', out]);
    fs.renameSync(path.join(out, 'COPYING'), path.join(out, 'aria2-COPYING.txt'));
    fs.rmSync(tmp);
    console.log('aria2c.exe ok');
  }
  // yt-dlp (latest)
  const sums = (await get('https://github.com/yt-dlp/yt-dlp/releases/latest/download/SHA2-256SUMS')).toString();
  const want = /^([0-9a-f]{64})\s+yt-dlp\.exe$/m.exec(sums)[1];
  const have = fs.existsSync(path.join(out, 'yt-dlp.exe')) && sha(fs.readFileSync(path.join(out, 'yt-dlp.exe')));
  if (have !== want) {
    const exe = await get('https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe');
    if (sha(exe) !== want) throw new Error('yt-dlp checksum mismatch');
    fs.writeFileSync(path.join(out, 'yt-dlp.exe'), exe);
    console.log('yt-dlp.exe ok');
  }
})().catch(e => { console.error(e.message); process.exit(1); });
