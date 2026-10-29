// Fetch the helper tools that ship inside the app, checking each one's SHA-256 before keeping it.
//   node scripts/fetch-tools.js        -> vendor/win  (aria2c.exe, yt-dlp.exe)
//   node scripts/fetch-tools.js mac    -> vendor/mac  (aria2c, yt-dlp)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const target = process.argv[2] === 'mac' ? 'mac' : 'win';
const out = path.join(__dirname, '..', 'vendor', target);
fs.mkdirSync(out, { recursive: true });

async function get(url) {
  const r = await fetch(url, { redirect: 'follow' });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const run = (cmd, args, opts) => execFileSync(cmd, args, { stdio: 'inherit', ...opts });

function findFile(dir, name) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { const f = findFile(p, name); if (f) return f; }
    else if (e.name === name) return p;
  }
  return null;
}

async function ytdlp() {
  const asset = target === 'mac' ? 'yt-dlp_macos' : 'yt-dlp.exe';
  const dest = path.join(out, target === 'mac' ? 'yt-dlp' : 'yt-dlp.exe');
  const sums = (await get('https://github.com/yt-dlp/yt-dlp/releases/latest/download/SHA2-256SUMS')).toString();
  const want = new RegExp(`^([0-9a-f]{64})\\s+${asset.replace('.', '\\.')}$`, 'm').exec(sums)[1];
  if (fs.existsSync(dest) && sha(fs.readFileSync(dest)) === want) return;
  const bin = await get(`https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}`);
  if (sha(bin) !== want) throw new Error('yt-dlp checksum mismatch');
  fs.writeFileSync(dest, bin, { mode: 0o755 });
  console.log(asset, 'ok');
}

async function aria2Windows() {
  if (fs.existsSync(path.join(out, 'aria2c.exe'))) return;
  const zip = await get('https://github.com/aria2/aria2/releases/download/release-1.37.0/aria2-1.37.0-win-64bit-build1.zip');
  if (sha(zip) !== '67d015301eef0b612191212d564c5bb0a14b5b9c4796b76454276a4d28d9b288') throw new Error('aria2 checksum mismatch');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aria2-'));
  const z = path.join(tmp, 'aria2.zip');
  fs.writeFileSync(z, zip);
  // On Windows use the built-in bsdtar (GNU tar from Git Bash reads "C:" as a remote host)
  if (process.platform === 'win32') run(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', z, '-C', tmp]);
  else run('unzip', ['-o', '-q', z, '-d', tmp]);
  fs.copyFileSync(findFile(tmp, 'aria2c.exe'), path.join(out, 'aria2c.exe'));
  fs.copyFileSync(findFile(tmp, 'COPYING'), path.join(out, 'aria2-COPYING.txt'));
  console.log('aria2c.exe ok');
}

// aria2 publishes its last macOS build (1.35.0, Intel, runs on Apple Silicon through Rosetta) as a .dmg with a .pkg inside.
async function aria2Mac() {
  if (fs.existsSync(path.join(out, 'aria2c'))) return;
  const dmg = await get('https://github.com/aria2/aria2/releases/download/release-1.35.0/aria2-1.35.0-osx-darwin.dmg');
  if (sha(dmg) !== '2d941ea494bbc1e0a9979df861411bbf7ca91270ede3a355b0603ab7744242c5') throw new Error('aria2 (mac) checksum mismatch');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aria2-'));
  const file = path.join(tmp, 'aria2.dmg');
  fs.writeFileSync(file, dmg);
  if (process.platform === 'darwin') {
    const mnt = path.join(tmp, 'mnt');
    run('hdiutil', ['attach', '-nobrowse', '-readonly', '-mountpoint', mnt, file]);
    try { run('pkgutil', ['--expand-full', path.join(mnt, 'aria2.pkg'), path.join(tmp, 'pkg')]); }
    finally { run('hdiutil', ['detach', mnt]); }
  } else {   // Linux: 7-Zip opens the dmg, the pkg and its cpio payload
    run('7z', ['x', '-y', `-o${tmp}/dmg`, file], { stdio: 'ignore' });
    run('7z', ['x', '-y', `-o${tmp}/pkg`, findFile(`${tmp}/dmg`, 'aria2.pkg')], { stdio: 'ignore' });
    const payload = findFile(`${tmp}/pkg`, 'Payload');
    run('7z', ['x', '-y', `-o${tmp}/pl`, payload], { stdio: 'ignore' });
    const inner = fs.readdirSync(`${tmp}/pl`).map(n => path.join(`${tmp}/pl`, n)).find(p => fs.statSync(p).isFile());
    if (inner) run('7z', ['x', '-y', `-o${tmp}/x`, inner], { stdio: 'ignore' });
  }
  fs.copyFileSync(findFile(tmp, 'aria2c'), path.join(out, 'aria2c'));
  fs.chmodSync(path.join(out, 'aria2c'), 0o755);
  const copying = findFile(tmp, 'COPYING');
  if (copying) fs.copyFileSync(copying, path.join(out, 'aria2-COPYING.txt'));
  console.log('aria2c (mac) ok');
}

(async () => {
  if (target === 'mac') await aria2Mac(); else await aria2Windows();
  await ytdlp();
})().catch(e => { console.error(e.message); process.exit(1); });
