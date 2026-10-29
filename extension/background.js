'use strict';
/* Brusk browser extension — background service worker */
const PORTS = [47800, 47801, 31760, 31761, 23741, 23742, 18764, 18765, 52819, 61871];   // same list as the app
const VIDEO_SITES = /(^|\.)(youtube\.com|youtu\.be|vimeo\.com|dailymotion\.com|twitch\.tv|tiktok\.com|twitter\.com|x\.com|facebook\.com|fb\.watch|instagram\.com|reddit\.com|soundcloud\.com|bilibili\.com|rumble\.com|streamable\.com|kick\.com|ok\.ru|vk\.com|aparat\.com|coursera\.org|udemy\.com|ted\.com)$/i;
const MEDIA_EXT = /\.(m3u8|mpd|mp4|webm|mkv|mov|m4v|flv|mp3|m4a|aac|ogg|opus|wav|flac)(\?|#|$)/i;
const SEGMENT = /\.(ts|m4s|aac\?.*range|cmfv|cmfa)(\?|$)|[?&](range|bytestart|byteend)=|\/seg-?\d+|\/chunk-?\d+|init\.mp4|googlevideo\.com|\.fbcdn\.net\/.*bytestart/i;

let app = { port: null, checked: 0, info: null };
const media = new Map();          // tabId -> [{url, mime, size, kind, at}]
const skipOnce = new Set();       // urls we gave back to the browser

/* ---------- talking to the app ---------- */
async function getToken() { return (await chrome.storage.local.get('token')).token || null; }

async function ping(force = false) {
  if (!force && app.info && Date.now() - app.checked < 30_000) return app.info;
  const token = await getToken();
  const headers = token ? { 'x-barq-token': token } : {};
  const tryPort = async port => {
    const r = await fetch(`http://127.0.0.1:${port}/barq/ping`, { headers, signal: AbortSignal.timeout(1500) });
    const j = await r.json();
    if (j.app !== 'barq') throw new Error('not barq');
    return { port, j };
  };
  let found = null;
  if (app.port) found = await tryPort(app.port).catch(() => null);
  if (!found) found = await Promise.any(PORTS.map(tryPort)).catch(() => null);
  if (found) {
    app = { port: found.port, checked: Date.now(), info: found.j }; setIcon(found.j.paired);
    if (found.j.language) chrome.storage.local.get('lang').then(r => { if (r.lang !== found.j.language) { chrome.storage.local.set({ lang: found.j.language }); buildMenus(found.j.language); } });
    return found.j;
  }
  app = { port: null, checked: Date.now(), info: null };
  setIcon(false);
  return null;
}

async function post(path, body) {
  const info = await ping();
  if (!info) throw new Error('not-running');
  const token = await getToken();
  const r = await fetch(`http://127.0.0.1:${app.port}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { 'x-barq-token': token } : {}) },
    body: JSON.stringify(body),
  });
  if (r.status === 401) { app.info = null; throw new Error('not-paired'); }
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
  return r.json();
}

async function pair() {
  const info = await ping(true);
  if (!info) throw new Error('not-running');
  const ua = navigator.userAgent;
  const browser = /Firefox\//.test(ua) ? 'Firefox' : /Edg\//.test(ua) ? 'Microsoft Edge' : /OPR\//.test(ua) ? 'Opera' : /Brave/.test(ua) ? 'Brave' : 'Google Chrome';
  const r = await fetch(`http://127.0.0.1:${app.port}/barq/pair`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ browser }) });
  if (!r.ok) throw new Error(r.status === 403 ? 'denied' : 'failed');
  const { token } = await r.json();
  await chrome.storage.local.set({ token });
  await ping(true);
  return true;
}

function setIcon(ok) {
  chrome.action.setIcon({ path: ok ? { 16: 'icons/icon16.png', 32: 'icons/icon32.png' } : { 16: 'icons/off16.png', 32: 'icons/off32.png' } }).catch(() => {});
}

async function cookiesFor(url) {
  try { return (await chrome.cookies.getAll({ url })).map(c => ({ name: c.name, value: c.value, domain: c.domain, path: c.path, secure: c.secure, httpOnly: c.httpOnly, expirationDate: c.expirationDate })); }
  catch { return []; }
}

async function send(items, opts = {}) {
  const full = await Promise.all(items.map(async i => ({ userAgent: navigator.userAgent, ...i, cookies: await cookiesFor(i.url) })));
  return post('/barq/add', { items: full, silent: Boolean(opts.silent) });
}

function isVideoSite(url) { try { return VIDEO_SITES.test(new URL(url).hostname.replace(/^www\.|^m\./, '')); } catch { return false; } }

/* ---------- taking over browser downloads ---------- */
async function enabled() { const { capture = true } = await chrome.storage.local.get('capture'); return capture; }

if (chrome.downloads.onDeterminingFilename) {
  // Chrome, Edge, Brave, Opera
  chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
    handleDownload(item).catch(() => {});
    suggest();
    return false;
  });
} else {
  // Firefox has no onDeterminingFilename; the name is already known when the download is created.
  chrome.downloads.onCreated.addListener(item => {
    if (!item.filename) item.filename = (() => { try { return decodeURIComponent(new URL(item.finalUrl || item.url).pathname.split('/').pop()); } catch { return ''; } })();
    handleDownload(item).catch(() => {});
  });
}

async function handleDownload(item) {
  const url = item.finalUrl || item.url;
  if (!/^(https?|ftp):/i.test(url) || item.byExtensionId === chrome.runtime.id) return;
  if (skipOnce.has(url)) { skipOnce.delete(url); return; }
  if (!(await enabled())) return;
  const info = await ping();
  if (!info?.paired) return;
  const name = (item.filename || '').split(/[\\/]/).pop();
  const ext = (name.match(/\.([a-z0-9]{1,8})$/i) || [])[1]?.toLowerCase();
  const types = new Set(String(info.captureTypes || '').toLowerCase().split(/[\s,]+/).filter(Boolean));
  if (!ext || !types.has(ext)) return;
  const size = item.fileSize > 0 ? item.fileSize : item.totalBytes;
  if (info.captureMinSizeKB && size > 0 && size < info.captureMinSizeKB * 1024) return;
  await chrome.downloads.cancel(item.id).catch(() => {});
  chrome.downloads.erase({ id: item.id }).catch(() => {});
  try {
    await send([{ url, referrer: item.referrer, filename: name, size: size > 0 ? size : undefined, mime: item.mime }]);
  } catch {
    // Brusk isn't reachable: give the download back to the browser.
    skipOnce.add(url);
    chrome.downloads.download({ url });
  }
}

/* ---------- finding videos on pages ---------- */
chrome.webRequest.onHeadersReceived.addListener(d => {
  if (d.tabId < 0 || d.statusCode >= 400) return;
  const h = Object.fromEntries((d.responseHeaders || []).map(x => [x.name.toLowerCase(), x.value]));
  const mime = (h['content-type'] || '').split(';')[0].toLowerCase();
  const isList = /mpegurl|dash\+xml/.test(mime) || /\.(m3u8|mpd)(\?|$)/i.test(d.url);
  const isMedia = isList || /^(video|audio)\//.test(mime) || MEDIA_EXT.test(d.url);
  if (!isMedia || SEGMENT.test(d.url)) return;
  if (/mp2t|iso.segment/.test(mime)) return;
  const size = Number((h['content-range'] || '').split('/')[1]) || Number(h['content-length']) || 0;
  if (!isList && size && size < 300 * 1024) return;   // tiny sounds and previews
  const list = media.get(d.tabId) || [];
  const clean = d.url.replace(/[?&](range|rn|rbuf)=[^&]*/g, '');
  if (list.some(m => m.url === clean)) return;
  // HLS: keep the master list, not every quality list
  if (isList && list.some(m => m.kind === 'list' && sameFolder(m.url, clean))) return;
  list.push({ url: clean, mime, size, kind: isList ? 'list' : 'file', at: Date.now() });
  media.set(d.tabId, list.slice(-30));
  updateBadge(d.tabId);
  chrome.tabs.sendMessage(d.tabId, { type: 'barq-media', count: list.length }).catch(() => {});
}, { urls: ['<all_urls>'], types: ['media', 'xmlhttprequest', 'other', 'object'] }, ['responseHeaders']);

function sameFolder(a, b) { try { const x = new URL(a), y = new URL(b); return x.origin === y.origin && x.pathname.split('/').slice(0, -1).join('/') === y.pathname.split('/').slice(0, -1).join('/'); } catch { return false; } }
function updateBadge(tabId) {
  const n = (media.get(tabId) || []).length;
  chrome.action.setBadgeBackgroundColor({ color: '#2f6bff', tabId }).catch(() => {});
  chrome.action.setBadgeText({ text: n ? String(n) : '', tabId }).catch(() => {});
}
chrome.tabs.onUpdated.addListener((tabId, info) => { if (info.status === 'loading' && info.url) { media.delete(tabId); updateBadge(tabId); } });
chrome.tabs.onRemoved.addListener(tabId => media.delete(tabId));

/** Best thing to download for a page: the page itself on video sites, else the stream list, else the biggest file. */
function bestFor(tabId, pageUrl, title) {
  if (isVideoSite(pageUrl)) return { url: pageUrl, kind: 'video', pageTitle: title };
  const list = media.get(tabId) || [];
  const stream = list.find(m => m.kind === 'list');
  if (stream) return { url: stream.url, kind: 'video', referrer: pageUrl, pageUrl, pageTitle: title };
  const file = [...list].sort((a, b) => b.size - a.size)[0];
  if (file) return { url: file.url, kind: 'http', referrer: pageUrl, pageUrl, pageTitle: title, filename: title ? `${title.slice(0, 120)}.${extOf(file)}` : undefined };
  return { url: pageUrl, kind: 'video', pageTitle: title };
}
function extOf(m) { const e = (new URL(m.url).pathname.match(/\.([a-z0-9]{2,4})$/i) || [])[1]; return e || (m.mime.includes('audio') ? 'mp3' : 'mp4'); }

/* ---------- right-click menu ---------- */
function uiLang() { const l = chrome.i18n.getUILanguage(); return /^ckb|^ku/.test(l) ? 'ckb' : /^ar/.test(l) ? 'ar' : 'en'; }
const tr3 = (lang, a, e, k) => (lang === 'en' ? e : lang === 'ckb' ? k : a);
function buildMenus(lang) {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'link', title: tr3(lang, 'تحميل بـ بروسك', 'Download with Brusk', 'داگرتن بە بروسک'), contexts: ['link'] });
    chrome.contextMenus.create({ id: 'media', title: tr3(lang, 'تحميل هذا الملف بـ بروسك', 'Download this with Brusk', 'داگرتنی ئەم فایلە بە بروسک'), contexts: ['video', 'audio', 'image'] });
    chrome.contextMenus.create({ id: 'selection', title: tr3(lang, 'تحميل كل الروابط المحددة بـ بروسك', 'Download all selected links with Brusk', 'داگرتنی هەموو بەستەرە دیاریکراوەکان بە بروسک'), contexts: ['selection'] });
    chrome.contextMenus.create({ id: 'page', title: tr3(lang, 'تحميل فيديو هذه الصفحة بـ بروسك', "Download this page's video with Brusk", 'داگرتنی ڤیدیۆی ئەم پەڕەیە بە بروسک'), contexts: ['page'] });
  });
}
chrome.runtime.onInstalled.addListener(async () => {
  const { lang } = await chrome.storage.local.get('lang');
  buildMenus(lang || uiLang());
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    if (info.menuItemId === 'link') await send([{ url: info.linkUrl, referrer: info.pageUrl, pageUrl: info.pageUrl }]);
    if (info.menuItemId === 'media') {
      const src = info.srcUrl;
      if (!src || src.startsWith('blob:')) await send([bestFor(tab.id, info.frameUrl || info.pageUrl, tab.title)]);
      else await send([{ url: src, referrer: info.pageUrl, pageUrl: info.pageUrl, kind: info.mediaType === 'image' ? 'http' : undefined }]);
    }
    if (info.menuItemId === 'selection') {
      const links = await chrome.tabs.sendMessage(tab.id, { type: 'barq-selection' }).catch(() => []);
      if (links?.length) await send(links.map(url => ({ url, referrer: info.pageUrl, pageUrl: info.pageUrl })));
    }
    if (info.menuItemId === 'page') await send([bestFor(tab.id, info.pageUrl, tab.title)]);
  } catch (e) { notify(e.message); }
});

function notify(code) {
  const lang = app.info?.language || uiLang();
  const text = code === 'not-running' ? tr3(lang, 'برنامج بروسك غير مفتوح', 'Brusk is not running', 'بەرنامەی بروسک کراوە نییە')
    : code === 'not-paired' ? tr3(lang, 'اربط الإضافة ببروسك أولاً', 'Connect the extension to Brusk first', 'سەرەتا پاشکۆکە بە بروسکەوە پەیوەست بکە') : code;
  chrome.action.setBadgeBackgroundColor({ color: '#e5484d' });
  chrome.action.setBadgeText({ text: '!' });
  chrome.action.setTitle({ title: text });
  setTimeout(() => { chrome.action.setBadgeText({ text: '' }); chrome.action.setTitle({ title: 'Brusk' }); }, 5000);
}

/* ---------- messages from the popup and pages ---------- */
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  handleMessage(msg, sender).then(reply, e => reply({ ok: false, error: String(e?.message || e) }));
  return true;
});

async function handleMessage(msg, sender) {
  {
    switch (msg.type) {
      case 'status': {
        const info = await ping(true);
        return { running: Boolean(info), paired: Boolean(info?.paired), language: info?.language, capture: await enabled(), media: msg.tabId != null ? media.get(msg.tabId) || [] : [] };
      }
      case 'pair': return pair().then(() => ({ ok: true }), e => ({ ok: false, error: e.message }));
      case 'capture': await chrome.storage.local.set({ capture: Boolean(msg.on) }); return { ok: true };
      case 'send': return send(msg.items).then(() => ({ ok: true }), e => ({ ok: false, error: e.message }));
      case 'page-video': {
        const tabId = msg.tabId ?? sender.tab?.id;
        const pageUrl = msg.pageUrl || sender.url || sender.tab?.url;
        return send([bestFor(tabId, pageUrl, msg.title || sender.tab?.title)]).then(() => ({ ok: true }), e => { notify(e.message); return { ok: false, error: e.message }; });
      }
      case 'has-media': return { count: (media.get(sender.tab?.id) || []).length };
    }
    return null;
  }
}

ping(true);
