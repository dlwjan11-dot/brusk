'use strict';
/**
 * Video pages through yt-dlp. Using yt-dlp (kept up to date) instead of replaying the
 * browser's own YouTube stream protocol is what keeps this working when YouTube changes
 * (Awesome Downloader's SABR capture breaks on every change).
 */
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');

const WIN = process.platform === 'win32';

function run(bin, args, { signal, onLine, env } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8', ...env } });
    let out = '', err = '', buf = '';
    const kill = () => killTree(p);
    signal?.addEventListener('abort', kill, { once: true });
    p.stdout.setEncoding('utf8'); p.stderr.setEncoding('utf8');
    p.stdout.on('data', d => {
      if (!onLine) { out += d; return; }
      buf += d;
      let i;
      while ((i = buf.search(/\r?\n|\r/)) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (line.trim()) onLine(line); }
    });
    p.stderr.on('data', d => { err += d; if (err.length > 64_000) err = err.slice(-32_000); });
    p.on('error', reject);
    p.on('close', code => {
      signal?.removeEventListener('abort', kill);
      if (buf.trim() && onLine) onLine(buf);
      if (signal?.aborted) return reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
      if (code === 0) resolve(out);
      else reject(new Error(lastError(err) || `yt-dlp stopped (${code})`));
    });
  });
}

function lastError(text) {
  const lines = String(text).split(/\r?\n/).filter(l => /ERROR/.test(l));
  return (lines.pop() || String(text).trim().split(/\r?\n/).pop() || '').replace(/^ERROR:\s*/, '').slice(0, 400);
}

function killTree(p) {
  if (!p || p.exitCode !== null) return;
  if (WIN) execFile('taskkill', ['/pid', String(p.pid), '/T', '/F'], { windowsHide: true }, () => {});
  else p.kill('SIGTERM');
}

/** Common yt-dlp options built from the download's headers, cookies and settings. */
async function commonArgs(tools, { headers = {}, cookies, proxy } = {}) {
  const args = ['--no-colors', '--encoding', 'utf-8', '--windows-filenames'];
  const deno = tools.find('deno');
  if (deno) args.push('--js-runtimes', `deno:${deno}`);
  const ffmpeg = tools.find('ffmpeg');
  if (ffmpeg) args.push('--ffmpeg-location', path.dirname(ffmpeg));
  for (const [k, v] of Object.entries(headers)) {
    if (!v) continue;
    const key = k.toLowerCase();
    if (key === 'cookie') continue;
    if (key === 'user-agent') args.push('--user-agent', v);
    else if (key === 'referer') args.push('--referer', v);
    else args.push('--add-header', `${k}:${v}`);
  }
  let cookieFile = null;
  if (cookies?.length) {
    cookieFile = path.join(os.tmpdir(), `barq-cookies-${process.pid}-${Date.now()}.txt`);
    await fsp.writeFile(cookieFile, toNetscape(cookies), { mode: 0o600 });
    args.push('--cookies', cookieFile);
  }
  if (proxy) args.push('--proxy', proxy);
  return { args, cleanup: () => cookieFile && fsp.rm(cookieFile, { force: true }).catch(() => {}) };
}

function toNetscape(cookies) {
  const lines = ['# Netscape HTTP Cookie File'];
  for (const c of cookies) {
    const domain = c.domain || '';
    lines.push([
      (c.httpOnly ? '#HttpOnly_' : '') + domain,
      domain.startsWith('.') ? 'TRUE' : 'FALSE',
      c.path || '/',
      c.secure ? 'TRUE' : 'FALSE',
      Math.floor(c.expirationDate || 0),
      c.name, c.value,
    ].join('\t'));
  }
  return lines.join('\n') + '\n';
}

/** Look at a page: one video with its qualities, or a playlist with its entries. */
async function probeVideo(tools, url, opts = {}) {
  const bin = tools.find('yt-dlp');
  if (!bin) throw Object.assign(new Error('yt-dlp missing'), { code: 'NOTOOL' });
  const { args, cleanup } = await commonArgs(tools, opts);
  try {
    const json = await run(bin, [...args, '-J', '--flat-playlist', '--playlist-end', '500', '--no-warnings', url], { signal: opts.signal });
    const info = JSON.parse(json);
    if (info._type === 'playlist') {
      return {
        type: 'playlist', title: info.title || url, uploader: info.uploader || info.channel,
        entries: (info.entries || []).filter(Boolean).map(e => ({
          id: e.id, title: e.title || e.id, duration: e.duration,
          url: e.url && /^https?:/.test(e.url) ? e.url : e.webpage_url || (info.extractor_key === 'YoutubeTab' ? `https://www.youtube.com/watch?v=${e.id}` : e.url),
        })),
      };
    }
    return { type: 'video', ...summarize(info) };
  } finally { cleanup(); }
}

function summarize(info) {
  const formats = info.formats || [];
  const audio = formats.filter(f => f.vcodec === 'none' && f.acodec && f.acodec !== 'none');
  const bestAudio = audio.sort((a, b) => score(b, 'a') - score(a, 'a'))[0];
  const audioSize = bestAudio ? size(bestAudio, info.duration) : 0;
  const byHeight = new Map();
  for (const f of formats) {
    if (!f.height || !f.vcodec || f.vcodec === 'none') continue;
    const combined = f.acodec && f.acodec !== 'none';
    const s = size(f, info.duration) + (combined ? 0 : audioSize);
    const prev = byHeight.get(f.height);
    const avc = /^avc1|h264/i.test(f.vcodec);
    if (!prev || (avc && !prev.avc) || (avc === prev.avc && s > prev.size)) byHeight.set(f.height, { height: f.height, size: s, avc, fps: f.fps });
  }
  const qualities = [...byHeight.values()].sort((a, b) => b.height - a.height)
    .map(q => ({ id: `h${q.height}`, label: `${q.height}p${q.fps > 30 ? q.fps : ''}`, height: q.height, size: q.size || null }));
  if (!qualities.length && formats.length) qualities.push({ id: 'best', label: 'Best', size: size(formats[formats.length - 1], info.duration) || null });
  if (!formats.length) qualities.push({ id: 'best', label: 'Best', size: info.filesize || info.filesize_approx || null });
  if (bestAudio || formats.some(f => f.acodec && f.acodec !== 'none')) {
    qualities.push({ id: 'audio-m4a', label: 'Audio (M4A)', size: audioSize || null });
    qualities.push({ id: 'audio-mp3', label: 'Audio (MP3)', size: audioSize || null });
  }
  return {
    title: info.title || info.id, id: info.id, duration: info.duration, uploader: info.uploader || info.channel,
    thumbnail: info.thumbnail, webpage: info.webpage_url, extractor: info.extractor_key,
    qualities, subtitles: Object.keys(info.subtitles || {}),
  };
}
function score(f, kind) { return (kind === 'a' && /m4a|mp4a/.test(f.ext + f.acodec) ? 1e6 : 0) + (f.abr || f.tbr || 0); }
function size(f, duration) { return f.filesize || f.filesize_approx || (f.tbr && duration ? Math.round(f.tbr * 125 * duration) : 0); }

function formatFor(quality) {
  if (!quality || quality === 'best') return { f: 'bv*[vcodec^=avc1]+ba[ext=m4a]/bv*+ba/b', merge: 'mp4' };
  if (quality === 'audio-m4a') return { f: 'ba[ext=m4a]/ba', extract: 'm4a' };
  if (quality === 'audio-mp3') return { f: 'ba/b', extract: 'mp3' };
  const h = Number(String(quality).replace(/\D/g, ''));
  return { f: `bv*[height<=${h}][vcodec^=avc1]+ba[ext=m4a]/bv*[height<=${h}]+ba/b[height<=${h}]/b`, merge: 'mp4' };
}

/**
 * Download one video. d.video = { quality, subtitles: ['ar','en'] }.
 * onProgress({ downloaded, total, speed, eta, phase })
 */
async function downloadVideo(tools, d, { signal, onProgress, rateLimit, proxy, connections = 8 }) {
  const bin = tools.find('yt-dlp');
  const { args, cleanup } = await commonArgs(tools, { headers: d.headers, cookies: d.cookies, proxy });
  const fmt = formatFor(d.video?.quality);
  const out = path.join(d.directory, '%(title).150B [%(id)s].%(ext)s');
  args.push('-f', fmt.f, '-o', out, '--no-playlist', '--newline', '--progress', '--continue', '--no-mtime',
    '-N', String(Math.max(1, Math.min(16, connections))),
    '--progress-template', 'download:BARQ|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s|%(info.format_id)s',
    '--print', 'after_move:BARQFILE|%(filepath)s');
  if (fmt.merge) args.push('--merge-output-format', fmt.merge);
  if (fmt.extract) args.push('-x', '--audio-format', fmt.extract);
  if (d.video?.subtitles?.length && !fmt.extract) args.push('--write-subs', '--sub-langs', d.video.subtitles.join(','), '--embed-subs');
  if (rateLimit) args.push('-r', String(rateLimit));
  args.push(d.url);
  await fsp.mkdir(d.directory, { recursive: true });

  let phaseDone = 0, lastTotal = 0, lastFormat = null, file = null;
  try {
    await run(bin, args, {
      signal,
      onLine(line) {
        if (line.startsWith('BARQFILE|')) { file = line.slice(9).trim(); return; }
        if (line.startsWith('BARQ|')) {
          const [, dl, tot, est, spd, eta, fid] = line.split('|');
          const num = v => (v && v !== 'NA' && v !== 'None' ? Number(v) : null);
          if (lastFormat && fid !== lastFormat) { phaseDone += lastTotal; }
          lastFormat = fid;
          const total = num(tot) ?? num(est) ?? 0;
          lastTotal = total;
          onProgress({ downloaded: phaseDone + (num(dl) || 0), partTotal: phaseDone + total, speed: num(spd) || 0, eta: num(eta), phase: 'download' });
          return;
        }
        if (/^\[(Merger|ExtractAudio|EmbedSubtitle|FixupM3u8|VideoConvertor)\]/.test(line)) onProgress({ phase: 'merge' });
      },
    });
  } finally { cleanup(); }
  return file;
}

async function ytdlpVersion(tools) {
  const bin = tools.find('yt-dlp');
  if (!bin) return null;
  try { return (await run(bin, ['--version'])).trim(); } catch { return null; }
}

/** Sites that are almost always video pages (the rest are detected by trying yt-dlp). */
const VIDEO_SITES = /(^|\.)(youtube\.com|youtu\.be|vimeo\.com|dailymotion\.com|twitch\.tv|tiktok\.com|twitter\.com|x\.com|facebook\.com|fb\.watch|instagram\.com|reddit\.com|soundcloud\.com|bilibili\.com|rumble\.com|streamable\.com|kick\.com|ok\.ru|vk\.com|aparat\.com|coursera\.org|udemy\.com|ted\.com|bandcamp\.com|archive\.org)$/i;
function isVideoSite(url) {
  try {
    const u = new URL(url);
    if (/\.(m3u8|mpd)(\?|$)/i.test(u.pathname)) return true;
    return VIDEO_SITES.test(u.hostname.replace(/^www\.|^m\./, '')) && !/\.(zip|exe|pdf|torrent|mp3|mp4)$/i.test(u.pathname);
  } catch { return false; }
}

module.exports = { probeVideo, downloadVideo, ytdlpVersion, isVideoSite, formatFor, summarize, killTree };
