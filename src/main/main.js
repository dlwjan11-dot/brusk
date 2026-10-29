'use strict';
const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, clipboard, Notification, dialog, shell, safeStorage, nativeTheme, powerSaveBlocker } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { Manager } = require('../core/manager');
const { Tools } = require('../core/tools');
const { ytdlpVersion, isVideoSite } = require('../core/video');
const { isGallerySite } = require('../core/gallery');
const { Bridge } = require('./bridge');
const T = require('./strings');

const WIN = process.platform === 'win32';
const MAC = process.platform === 'darwin';
app.setAppUserModelId('com.abdulmedia.brusk');

if (process.env.BARQ_USER_DATA) app.setPath('userData', process.env.BARQ_USER_DATA);   // development only
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

let win = null, tray = null, manager = null, bridge = null, quitting = false;
let lastClip = '', clipTimer = null, blocker = null;
const pendingArgs = [];               // macOS: links/files opened before the app finished starting
const pendingCaptures = new Map();   // capture id -> { headers, cookies } (kept out of the window)

const resources = app.isPackaged ? process.resourcesPath : path.join(__dirname, '..', '..');
const bundledTools = app.isPackaged ? path.join(process.resourcesPath, 'tools') : path.join(resources, 'vendor', WIN ? 'win' : MAC ? 'mac' : 'linux');
const extensionDir = app.isPackaged ? path.join(process.resourcesPath, 'extension') : path.join(resources, 'extension');
const icon = path.join(__dirname, '..', '..', 'assets', WIN ? 'icon.ico' : 'icon.png');

const t = key => (T[manager?.settings.language] || T.ar)[key] || T.en[key] || key;

/* ---------------- window ---------------- */
function createWindow(show = true) {
  const dark = isDark();
  win = new BrowserWindow({
    width: 1180, height: 740, minWidth: 880, minHeight: 560, show: false,
    title: 'Brusk', icon, backgroundColor: dark ? '#0f1115' : '#f6f7fb',
    titleBarStyle: MAC ? 'hiddenInset' : 'hidden',
    trafficLightPosition: MAC ? { x: 14, y: 14 } : undefined,
    titleBarOverlay: WIN ? overlayColors(dark) : false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
  });
  if (!MAC) win.removeMenu();
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.once('ready-to-show', () => { if (show) win.show(); });
  if (process.env.BARQ_SHOT) devScreenshots();
  win.on('close', e => {
    if (!quitting && manager.settings.minimizeToTray) { e.preventDefault(); win.hide(); }
  });
  win.on('closed', () => { win = null; });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', e => e.preventDefault());
}
function isDark() { const th = manager?.settings.theme || 'system'; return th === 'dark' || (th === 'system' && nativeTheme.shouldUseDarkColors); }
function overlayColors(dark) { return { color: dark ? '#0f1115' : '#f6f7fb', symbolColor: dark ? '#e6e8ee' : '#1b1f2a', height: 44 }; }
function showWindow() {
  if (!win) createWindow(true);
  if (MAC) app.dock?.show();
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
}
function send(ch, data) { if (win && !win.isDestroyed()) win.webContents.send(ch, data); }

/* ---------------- tray ---------------- */
function createTray() {
  const img = nativeImage.createFromPath(path.join(__dirname, '..', '..', 'assets', MAC ? 'trayTemplate.png' : 'tray.png'));
  if (MAC) img.setTemplateImage(true);   // follows the light/dark menu bar
  tray = new Tray(img.isEmpty() ? nativeImage.createFromPath(icon) : img);
  tray.setToolTip('Brusk');
  if (!MAC) tray.on('click', showWindow);   // on macOS a click opens the menu
  updateTray();
}
function updateTray() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: t('tray_open'), click: showWindow },
    { label: t('tray_add'), click: () => { showWindow(); send('open-add', { urls: [] }); } },
    { type: 'separator' },
    { label: t('tray_resume_all'), click: () => manager.bulk('resume') },
    { label: t('tray_pause_all'), click: () => manager.bulk('pause') },
    { label: t('tray_clipboard'), type: 'checkbox', checked: manager.settings.clipboardMonitor, click: m => manager.updateSettings({ clipboardMonitor: m.checked }).then(() => setupClipboard()) },
    { type: 'separator' },
    { label: t('tray_quit'), click: () => { quitting = true; app.quit(); } },
  ]));
  const snap = manager.snapshot();
  tray.setToolTip(snap.active ? `Brusk — ${snap.active} · ${fmtSpeed(snap.totalSpeed)}` : 'Brusk');
}
function fmtSpeed(b) { if (!b) return '0 KB/s'; const u = ['B/s', 'KB/s', 'MB/s', 'GB/s']; let i = 0; while (b >= 1024 && i < 3) { b /= 1024; i++; } return `${b.toFixed(i > 1 ? 1 : 0)} ${u[i]}`; }

/* ---------------- clipboard watch ---------------- */
const CLIP_RE = /^(magnet:\?xt=urn:btih:\S+|(https?|ftp):\/\/\S+)$/i;
function setupClipboard() {
  clearInterval(clipTimer);
  if (!manager.settings.clipboardMonitor) return;
  lastClip = clipboard.readText().trim();
  clipTimer = setInterval(() => {
    let text = '';
    try { text = clipboard.readText().trim(); } catch { return; }
    if (!text || text === lastClip) return;
    lastClip = text;
    const lines = text.split(/\s+/).filter(l => CLIP_RE.test(l));
    if (!lines.length || lines.length > 50) return;
    const types = new Set(manager.settings.captureTypes.split(/[\s,]+/).filter(Boolean).map(x => x.toLowerCase()));
    const wanted = lines.filter(l => {
      if (/^magnet:|^ftp:/i.test(l)) return true;
      if (isVideoSite(l)) return true;
      try { const ext = path.extname(new URL(l).pathname).slice(1).toLowerCase(); return ext && types.has(ext); } catch { return false; }
    });
    if (!wanted.length) return;
    showWindow();
    send('open-add', { urls: wanted, from: 'clipboard' });
  }, 1000);
}

/* ---------------- browser extension ---------------- */
function cookieHeader(cookies) { return (cookies || []).map(c => `${c.name}=${c.value}`).join('; '); }
function onBrowserAdd(items, { silent }) {
  const prepared = items.map(i => {
    const id = Math.random().toString(36).slice(2);
    const headers = {};
    if (i.referrer) headers.referer = i.referrer;
    if (i.userAgent) headers['user-agent'] = i.userAgent;
    const kind = i.kind || (/^magnet:/i.test(i.url) ? 'torrent' : isGallerySite(i.url) ? 'gallery' : isVideoSite(i.url) ? 'video' : 'http');
    if (kind === 'http' && i.cookies?.length) headers.cookie = cookieHeader(i.cookies);
    pendingCaptures.set(id, { headers, cookies: kind === 'video' || kind === 'gallery' ? i.cookies : [] });
    setTimeout(() => pendingCaptures.delete(id), 30 * 60_000);
    return { url: i.url, captureId: id, filename: i.filename, size: i.size, kind, gallery: i.gallery, pageTitle: i.pageTitle, pageUrl: i.pageUrl, hasCookies: Boolean(i.cookies?.length) };
  });
  if (silent) { for (const p of prepared) addItem({ ...p, start: 'now' }); return; }
  showWindow();
  send('open-add', { items: prepared, from: 'browser' });
}
function addItem(item) {
  const cap = item.captureId ? pendingCaptures.get(item.captureId) : null;
  return manager.add({ ...item, headers: { ...(cap?.headers || {}), ...(item.headers || {}) }, cookies: cap?.cookies || [] });
}
function capHeaders(captureId) { const c = captureId && pendingCaptures.get(captureId); return c ? { headers: c.headers, cookies: c.cookies } : {}; }

async function askPair(name) {
  showWindow();
  const r = await dialog.showMessageBox(win, {
    type: 'question', buttons: [t('pair_allow'), t('pair_deny')], defaultId: 0, cancelId: 1,
    title: 'Brusk', message: t('pair_title').replace('{name}', name), detail: t('pair_detail'),
  });
  send('browsers', bridge.list());
  return r.response === 0;
}

/* ---------------- after everything finishes ---------------- */
let afterTimer = null;
function onAllDone({ action }) {
  if (action === 'none') return;
  showWindow();
  send('all-done', { action, seconds: 60 });
  clearTimeout(afterTimer);
  afterTimer = setTimeout(() => runAfter(action), 60_000);
}
function runAfter(action) {
  if (action === 'quit') { quitting = true; app.quit(); }
  else if (action === 'shutdown' && WIN) { manager.saveNow().finally(() => execFile('shutdown', ['/s', '/t', '5'], { windowsHide: true })); }
  else if (action === 'sleep' && WIN) execFile('rundll32.exe', ['powrprof.dll,SetSuspendState', '0,1,0'], { windowsHide: true });
  else if (action === 'shutdown' && MAC) { manager.saveNow().finally(() => { quitting = true; execFile('/usr/bin/osascript', ['-e', 'tell application "System Events" to shut down']); }); }
  else if (action === 'sleep' && MAC) execFile('/usr/bin/pmset', ['sleepnow']);
}

/* ---------------- command line: .torrent files and magnet links ---------------- */
function handleArgs(argv) {
  const urls = [], files = [];
  for (const a of argv.slice(1)) {
    if (/^magnet:/i.test(a)) urls.push(a);
    else if (/\.torrent$/i.test(a) && fs.existsSync(a)) files.push(a);
  }
  if (urls.length || files.length) { showWindow(); send('open-add', { urls, torrentFiles: files }); }
}

/* ---------------- IPC ---------------- */
function ipc() {
  const h = (ch, fn) => ipcMain.handle(ch, async (_e, ...a) => fn(...a));
  h('state', () => manager.snapshot());
  h('settings:get', () => ({ ...manager.getSettings(), platform: process.platform, version: app.getVersion(), bridgePort: bridge?.port }));
  h('settings:set', async patch => {
    const before = manager.getSettings();
    const s = await manager.updateSettings(patch);
    if (patch.theme !== undefined || patch.language !== undefined) {
      if (WIN && win) win.setTitleBarOverlay(overlayColors(isDark()));
      updateTray();
      macMenu();
    }
    if (patch.clipboardMonitor !== undefined) setupClipboard();
    if (patch.startWithWindows !== undefined && app.isPackaged) app.setLoginItemSettings(MAC ? { openAtLogin: Boolean(s.startWithWindows), openAsHidden: true } : { openAtLogin: Boolean(s.startWithWindows), args: ['--hidden'] });
    return { ...s, changed: Object.keys(patch).filter(k => before[k] !== s[k]) };
  });
  h('inspect', async (url, captureId) => {
    try { return { ok: true, info: await manager.inspect(url, capHeaders(captureId)) }; }
    catch (e) { return { ok: false, error: e.code || String(e.message || e) }; }
  });
  const metaJobs = new Map();
  h('torrent:info', async (src, key) => {
    const ctl = new AbortController(); if (key) metaJobs.set(key, ctl);
    try { const info = await manager.torrentInfo(src, ctl.signal); return { ok: true, info }; }
    catch (e) { return { ok: false, error: ctl.signal.aborted ? 'CANCELLED' : String(e.message || e) }; }
    finally { metaJobs.delete(key); }
  });
  h('torrent:cancel', key => metaJobs.get(key)?.abort());
  h('add', items => items.map(i => addItem(i)));
  h('control', (id, action, opts) => manager.control(id, action, opts));
  h('bulk', (action, ids) => manager.bulk(action, ids));
  h('open', async id => { const d = manager.find(id); const f = d?.kind === 'gallery' && d.textFile ? d.textFile : d?.path; if (f && fs.existsSync(f)) return shell.openPath(f); return 'missing'; });
  h('reveal', id => { const d = manager.find(id); if (d?.path && fs.existsSync(d.path)) shell.showItemInFolder(d.path); else if (d?.directory) shell.openPath(d.directory); });
  h('openFolder', dir => shell.openPath(dir || manager.settings.downloadDir));
  h('chooseFolder', async def => { const r = await dialog.showOpenDialog(win, { defaultPath: def, properties: ['openDirectory', 'createDirectory'] }); return r.canceled ? null : r.filePaths[0]; });
  h('chooseTorrent', async () => { const r = await dialog.showOpenDialog(win, { filters: [{ name: 'Torrent', extensions: ['torrent'] }], properties: ['openFile', 'multiSelections'] }); return r.canceled ? [] : r.filePaths; });
  h('sha256', id => manager.sha256(id));
  h('copy', text => clipboard.writeText(String(text)));
  h('tools:status', async () => ({ ...manager.tools.status(), ytdlpVersion: await ytdlpVersion(manager.tools) }));
  h('tools:update', async name => { await manager.tools.ensure(name, (n, d, tot) => send('tool-progress', { name: n, done: d, total: tot }), { force: true }); return manager.tools.status(); });
  h('extension:open', () => { shell.openPath(extensionDir); return extensionDir; });
  h('extension:page', browser => shell.openExternal(browser === 'edge' ? 'microsoft-edge:edge://extensions' : 'https://chromewebstore.google.com/'));
  h('browsers', () => bridge?.list() || []);
  h('bridge:status', () => bridge?.status() || { port: null, error: 'not started' });
  h('bridge:retry', async () => { await bridge?.start(); return bridge?.status(); });
  h('browsers:forget', id => { bridge.forget(id); return bridge.list(); });
  h('magnet:default', () => app.setAsDefaultProtocolClient('magnet'));
  h('after:cancel', () => { clearTimeout(afterTimer); afterTimer = null; if (WIN) execFile('shutdown', ['/a'], { windowsHide: true }, () => {}); });
  h('after:now', action => { clearTimeout(afterTimer); runAfter(action); });
  h('openExternal', url => /^https?:/.test(url) && shell.openExternal(url));
}

/* ---------------- start ---------------- */
app.on('second-instance', (_e, argv) => { showWindow(); handleArgs(argv); });
app.on('open-url', (e, url) => { e.preventDefault(); if (manager) handleArgs(['', url]); else pendingArgs.push(url); });
app.on('open-file', (e, file) => { e.preventDefault(); if (manager) handleArgs(['', file]); else pendingArgs.push(file); });   // macOS: double-clicked .torrent

app.whenReady().then(async () => {
  const crypt = safeStorage.isEncryptionAvailable()
    ? { encrypt: s => safeStorage.encryptString(s).toString('base64'), decrypt: s => safeStorage.decryptString(Buffer.from(s, 'base64')) }
    : null;
  const tools = new Tools(bundledTools, path.join(app.getPath('userData'), 'tools'));
  if (MAC) await safe('tools', () => tools.copyBundled());   // run helpers from a copy, so the signed app is never touched
  manager = new Manager({ dataDir: app.getPath('userData'), tools, crypt });
  await manager.init();
  // The browser link starts first, so nothing later can stop it from opening.
  bridge = new Bridge({ dataDir: app.getPath('userData'), version: app.getVersion(), onPair: askPair, onAdd: onBrowserAdd, getSettings: () => manager.settings });
  await safe('bridge', () => bridge.start());
  await safe('folder', async () => { if (!fs.existsSync(manager.settings.downloadDir)) await manager.updateSettings({ downloadDir: app.getPath('downloads') }); });
  ipc();
  macMenu();
  if (MAC && process.argv.includes('--hidden')) app.dock?.hide();
  createWindow(!process.argv.includes('--hidden') && !(MAC && app.getLoginItemSettings().wasOpenedAsHidden));
  await safe('tray', createTray);
  await safe('clipboard', setupClipboard);

  let pushTimer = null;
  manager.on('changed', () => {
    if (pushTimer) return;
    pushTimer = setTimeout(() => { pushTimer = null; send('state', manager.snapshot()); updateTray(); keepAwake(); }, 150);
  });
  manager.on('completed', d => {
    if (manager.settings.notifyOnComplete && Notification.isSupported()) {
      const n = new Notification({ title: t('done_title'), body: d.filename || '', icon, silent: false });
      n.on('click', () => { if (d.path) shell.showItemInFolder(d.path); });
      n.show();
    }
    if (manager.settings.openFolderOnComplete && d.path) shell.showItemInFolder(d.path);
    send('completed', d);
  });
  manager.on('failed', d => send('failed', d));
  manager.on('all-done', onAllDone);
  manager.on('schedule', what => send('schedule', what));

  handleArgs([...process.argv, ...pendingArgs]);
});

/* errors go to barq.log in the data folder instead of disappearing */
function log(...a) {
  try { fs.appendFileSync(path.join(app.getPath('userData'), 'barq.log'), `[${new Date().toISOString()}] ${a.map(x => (x instanceof Error ? x.stack : String(x))).join(' ')}\n`); } catch {}
}
async function safe(step, fn) { try { return await fn(); } catch (e) { log(`startup step "${step}" failed:`, e); return null; } }
process.on('uncaughtException', e => log('uncaught:', e));
process.on('unhandledRejection', e => log('unhandled:', e));

/** Stop Windows from sleeping while something downloads. */
function keepAwake() {
  const busy = manager.snapshot().active > 0;
  if (busy && blocker === null) blocker = powerSaveBlocker.start('prevent-app-suspension');
  if (!busy && blocker !== null) { powerSaveBlocker.stop(blocker); blocker = null; }
}

app.on('before-quit', e => {
  if (manager && !manager._closing) {
    e.preventDefault();
    manager._closing = true; quitting = true;
    bridge?.stop();
    manager.shutdown().finally(() => app.quit());
  }
});
app.on('window-all-closed', () => { /* stays in the tray */ });
app.on('activate', () => showWindow());   // macOS: click on the Dock icon

/** macOS needs an app menu, or Cmd+C / Cmd+V / Cmd+Q don't work. */
function macMenu() {
  if (!MAC) return;
  const lang = manager?.settings.language || 'ar';
  const L = (a, e, k) => (lang === 'en' ? e : lang === 'ckb' ? k : a);
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Brusk', submenu: [
      { role: 'about', label: L('حول بروسك', 'About Brusk', 'دەربارەی بروسک') },
      { type: 'separator' },
      { label: L('الإعدادات…', 'Settings…', 'ڕێکخستنەکان…'), accelerator: 'Cmd+,', click: () => { showWindow(); send('open-settings'); } },
      { type: 'separator' },
      { role: 'hide', label: L('إخفاء بروسك', 'Hide Brusk', 'شاردنەوەی بروسک') }, { role: 'hideOthers', label: L('إخفاء الباقي', 'Hide Others', 'شاردنەوەی ئەوانی تر') }, { role: 'unhide', label: L('إظهار الكل', 'Show All', 'پیشاندانی هەموو') },
      { type: 'separator' },
      { label: L('إنهاء بروسك', 'Quit Brusk', 'داخستنی بروسک'), accelerator: 'Cmd+Q', click: () => { quitting = true; app.quit(); } },
    ] },
    { label: L('ملف', 'File', 'فایل'), submenu: [
      { label: L('إضافة رابط', 'Add link', 'زیادکردنی بەستەر'), accelerator: 'Cmd+N', click: () => { showWindow(); send('open-add', { urls: [] }); } },
      { label: L('فتح ملف تورنت…', 'Open torrent file…', 'کردنەوەی فایلی تۆرێنت…'), accelerator: 'Cmd+O', click: async () => { const r = await dialog.showOpenDialog({ filters: [{ name: 'Torrent', extensions: ['torrent'] }], properties: ['openFile', 'multiSelections'] }); if (!r.canceled) { showWindow(); send('open-add', { torrentFiles: r.filePaths }); } } },
      { type: 'separator' },
      { role: 'close', label: L('إغلاق النافذة', 'Close Window', 'داخستنی پەنجەرە') },
    ] },
    { label: L('تحرير', 'Edit', 'دەستکاری'), submenu: [
      { role: 'undo', label: L('تراجع', 'Undo', 'گەڕانەوە') }, { role: 'redo', label: L('إعادة', 'Redo', 'دووبارەکردنەوە') }, { type: 'separator' },
      { role: 'cut', label: L('قص', 'Cut', 'بڕین') }, { role: 'copy', label: L('نسخ', 'Copy', 'کۆپی') }, { role: 'paste', label: L('لصق', 'Paste', 'لکاندن') },
      { role: 'selectAll', label: L('تحديد الكل', 'Select All', 'دیاریکردنی هەموو') },
    ] },
    { label: L('نافذة', 'Window', 'پەنجەرە'), submenu: [{ role: 'minimize', label: L('تصغير', 'Minimize', 'بچووککردنەوە') }, { role: 'zoom', label: L('تكبير', 'Zoom', 'گەورەکردن') }, { role: 'front', label: L('إظهار الكل بالمقدمة', 'Bring All to Front', 'هێنانی هەموو بۆ پێشەوە') }] },
  ]));
}

/* development: screenshots of the main views (BARQ_SHOT=folder) */
function devScreenshots() {
  const dir = process.env.BARQ_SHOT;
  const steps = (process.env.BARQ_SHOT_STEPS || 'main').split(',');
  win.webContents.once('did-finish-load', async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    await wait(2500);
    for (const step of steps) {
      const [name, js] = step.split('=');
      if (js) { await win.webContents.executeJavaScript(decodeURIComponent(js)).catch(e => console.error(e)); await wait(1500); }
      const img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(dir, name + '.png'), img.toPNG());
    }
    quitting = true; app.quit();
  });
}
