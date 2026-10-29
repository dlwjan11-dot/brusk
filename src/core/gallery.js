'use strict';
/**
 * Pictures and posts through gallery-dl: Instagram (posts, carousels, reels, whole profiles),
 * X / Twitter, Facebook photos, Threads, Bluesky, Pinterest, Reddit, Tumblr, Flickr, Imgur…
 * One "gallery" download can be a single post or every post of a page.
 */
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { killTree } = require('./video');

const GALLERY_HOSTS = /(^|\.)(instagram\.com|x\.com|twitter\.com|threads\.net|threads\.com|bsky\.app|pinterest\.[a-z.]+|pin\.it|reddit\.com|tumblr\.com|flickr\.com|imgur\.com|deviantart\.com|artstation\.com|weibo\.com|vk\.com|behance\.net|500px\.com|furaffinity\.net|danbooru\.donmai\.us|mastodon\.social)$/i;

/** Is this a link gallery-dl should handle? (Videos on YouTube, Facebook video pages etc. stay with yt-dlp.) */
function isGallerySite(url) {
  let u;
  try { u = new URL(url); } catch { return false; }
  const host = u.hostname.replace(/^(www|m|mobile|old)\./, '');
  const p = u.pathname;
  if (/(^|\.)facebook\.com$|(^|\.)fb\.com$/.test(host)) {
    // photos, albums and pages: gallery-dl; videos and reels: yt-dlp
    return !/\/(watch|videos?|reel|reels|share\/v|share\/r)\b/i.test(p) && !u.searchParams.has('v');
  }
  if (/(^|\.)tiktok\.com$/.test(host)) return /\/photo\//.test(p);   // TikTok picture posts
  if (/(^|\.)reddit\.com$/.test(host)) return /\/(gallery|user|u)\//.test(p);
  return GALLERY_HOSTS.test(host);
}

/** A readable name for the Add dialog: "@name · Instagram", "Post · X"… */
function describe(url) {
  const u = new URL(url);
  const host = u.hostname.replace(/^(www|m|mobile|old)\./, '');
  const site = ({ 'instagram.com': 'Instagram', 'x.com': 'X', 'twitter.com': 'X', 'threads.net': 'Threads', 'threads.com': 'Threads', 'bsky.app': 'Bluesky',
    'facebook.com': 'Facebook', 'reddit.com': 'Reddit', 'tumblr.com': 'Tumblr', 'flickr.com': 'Flickr', 'imgur.com': 'Imgur', 'pinterest.com': 'Pinterest', 'tiktok.com': 'TikTok' })[host]
    || host.split('.').slice(-2, -1)[0].replace(/^./, c => c.toUpperCase());
  const parts = u.pathname.split('/').filter(Boolean);
  const single = /\/(p|reel|reels|tv|status|post|posts|photo|photos|pin|gallery|comments)\//i.test(u.pathname) || u.searchParams.has('fbid');
  let who = parts[0] && !/^(p|reel|reels|tv|i|explore|stories|pin|gallery|r|user|u|profile\.php|photo\.php|groups)$/i.test(parts[0]) ? parts[0] : null;
  if (host === 'reddit.com' && /^(user|u)$/.test(parts[0])) who = parts[1];
  if (host === 'bsky.app' && parts[0] === 'profile') who = parts[1];
  if (u.searchParams.get('id') && /profile\.php/.test(u.pathname)) who = u.searchParams.get('id');
  return { site, who: who ? (who.startsWith('@') ? who : '@' + who) : null, single };
}

function toNetscape(cookies) {
  const lines = ['# Netscape HTTP Cookie File'];
  for (const c of cookies) {
    const domain = c.domain || '';
    lines.push([(c.httpOnly ? '#HttpOnly_' : '') + domain, domain.startsWith('.') ? 'TRUE' : 'FALSE', c.path || '/',
      c.secure ? 'TRUE' : 'FALSE', Math.floor(c.expirationDate || 0), c.name, c.value].join('\t'));
  }
  return lines.join('\n') + '\n';
}

/** Translate gallery-dl's error lines into an error code the interface understands. */
function classify(stderr) {
  const t = String(stderr);
  if (/login|log in|authorization|authenticat|cookies|401|requires an account|NSFW|private/i.test(t)) return 'NEED_LOGIN';
  if (/Unsupported URL/i.test(t)) return 'UNSUPPORTED';
  if (/429|rate limit|Too Many Requests/i.test(t)) return 'RATE_LIMIT';
  if (/404|not found|does not exist|unavailable/i.test(t)) return 'NOT_FOUND';
  if (/Name or service not known|getaddrinfo|ConnectionError|timed out|Max retries/i.test(t)) return 'CONNECTION';
  const last = t.split(/\r?\n/).reverse().find(l => /\]\[error\]/.test(l)) || t.trim().split(/\r?\n/).pop() || '';
  return last.replace(/^\[[^\]]+\]\[error\]\s*/, '').slice(0, 300) || 'Download failed';
}

/**
 * Download one gallery job.
 * d.gallery = { posts: 0 (= all) | n, types: 'all' | 'images' | 'videos' }
 * onProgress({ files, bytes, lastFile })
 */
async function downloadGallery(tools, d, { signal, onProgress, rateLimit, proxy, cookiesBrowser, dataDir }) {
  const bin = tools.find('gallery-dl');
  if (!bin) throw Object.assign(new Error('gallery-dl missing'), { code: 'TOOL_MISSING' });
  await fsp.mkdir(d.directory, { recursive: true });
  const archiveDir = path.join(dataDir, 'gallery');
  await fsp.mkdir(archiveDir, { recursive: true });
  const args = ['--no-colors', '-d', d.directory, '--download-archive', path.join(archiveDir, 'archive.sqlite3')];
  const g = d.gallery || {};
  if (g.posts > 0) args.push('--post-range', `1-${g.posts}`);
  if (g.types === 'images') args.push('--filter', "extension in ('jpg','jpeg','png','webp','gif','heic','avif','bmp')");
  if (g.types === 'videos') args.push('--filter', "extension in ('mp4','webm','mov','m4v','mkv')");
  if (rateLimit) args.push('-r', rateLimit);
  if (proxy) args.push('--proxy', proxy);
  let cookieFile = null;
  if (d.cookies?.length) {
    cookieFile = path.join(os.tmpdir(), `brusk-gdl-${process.pid}-${Date.now()}.txt`);
    await fsp.writeFile(cookieFile, toNetscape(d.cookies), { mode: 0o600 });
    args.push('--cookies', cookieFile);
  } else if (cookiesBrowser) {
    args.push('--cookies-from-browser', cookiesBrowser);
  }
  const ua = d.headers?.['user-agent'];
  if (ua) args.push('-o', `extractor.user-agent=${ua}`);
  args.push(d.url);

  let files = d.downloaded || 0, bytes = d.bytes || 0, stderr = '', buf = '', lastDir = null;
  try {
    await new Promise((resolve, reject) => {
      const p = spawn(bin, args, { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' } });
      const kill = () => killTree(p);
      signal?.addEventListener('abort', kill, { once: true });
      p.stdout.setEncoding('utf8'); p.stderr.setEncoding('utf8');
      p.stdout.on('data', chunk => {
        buf += chunk;
        let i;
        while ((i = buf.search(/\r?\n/)) >= 0) {
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1).replace(/^\n/, '');
          if (!line || /^\[\d+\/\d+\]/.test(line)) continue;
          const skipped = line.startsWith('# ');
          const file = skipped ? line.slice(2) : line;
          const full = path.isAbsolute(file) ? file : path.resolve(file);
          if (!skipped) {
            files++;
            try { bytes += fs.statSync(full).size; } catch {}
          }
          lastDir = path.dirname(full);
          onProgress?.({ files, bytes, lastFile: full, dir: lastDir, skipped });
        }
      });
      p.stderr.on('data', c => { stderr += c; if (stderr.length > 64_000) stderr = stderr.slice(-32_000); });
      p.on('error', reject);
      p.on('close', code => {
        signal?.removeEventListener('abort', kill);
        if (signal?.aborted) return reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
        const hadError = /\]\[error\]/.test(stderr);
        // Partial success (some posts downloaded, one failed) still counts as done.
        if (code === 0 || (files > 0 && !hadError) || (files > 0 && code !== 0 && lastDir)) return resolve();
        if (lastDir && !hadError) return resolve();   // everything was already downloaded before
        reject(Object.assign(new Error(classify(stderr)), { code: classify(stderr), gallery: true }));
      });
    });
  } finally {
    if (cookieFile) fsp.rm(cookieFile, { force: true }).catch(() => {});
  }
  return { files, bytes, dir: lastDir };
}

module.exports = { isGallerySite, describe, downloadGallery, classify, toNetscape };
