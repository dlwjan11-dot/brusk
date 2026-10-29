'use strict';
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { HttpTransfer } = require('./http-transfer');
const { probe, setProxy, HttpError } = require('./http');
const { RateLimiter, categoryFor, safeFilename, uniquePath, newId, sleep } = require('./util');
const video = require('./video');
const gallery = require('./gallery');
const { Aria2, readTorrent, magnetHash, magnetName } = require('./aria2');

const CATEGORY_FOLDERS = { compressed: 'Compressed', documents: 'Documents', music: 'Music', video: 'Video', programs: 'Programs', images: 'Images', torrents: 'Torrents', other: 'General' };

const DEFAULT_SETTINGS = {
  language: 'ar',
  theme: 'system',
  downloadDir: path.join(os.homedir(), 'Downloads'),
  categoryFolders: true,
  maxConcurrent: 3,
  connections: 8,
  speedLimit: 0,            // KB/s, 0 = unlimited (all downloads together)
  uploadLimit: 0,           // KB/s for torrents
  seedRatio: 1,
  extraTrackers: true,
  clipboardMonitor: true,
  minimizeToTray: true,
  startWithWindows: false,
  notifyOnComplete: true,
  openFolderOnComplete: false,
  showCompleteDialog: true,
  resumeOnStart: true,
  proxy: '',
  videoQuality: '1080',
  subtitles: false,
  subtitleLangs: 'ar,en',
  cookiesBrowser: '',       // '' | firefox | chrome | edge | brave | opera | safari — sign-in for Instagram / X / Facebook pages
  galleryPosts: 0,          // 0 = every post of a page
  galleryText: 'none',      // post texts: none | with (beside the media) | only
  captureTypes: 'zip rar 7z gz xz bz2 tar iso exe msi apk dmg pdf doc docx xls xlsx ppt pptx mp3 m4a flac wav aac ogg mp4 mkv avi mov wmv webm flv m4v torrent bin img cab',
  captureMinSizeKB: 0,
  scheduler: { enabled: false, start: '02:00', stop: '', days: [0, 1, 2, 3, 4, 5, 6] },
  afterAllDone: 'none',     // none | shutdown | sleep | quit
};

class Manager extends EventEmitter {
  /**
   * @param o.dataDir   where downloads.json / settings.json live
   * @param o.tools     Tools instance
   * @param o.crypt     { encrypt(str): str, decrypt(str): str } for saved cookies (Windows DPAPI via Electron)
   */
  constructor({ dataDir, tools, crypt }) {
    super();
    this.dataDir = dataDir;
    this.tools = tools;
    this.crypt = crypt || { encrypt: s => s, decrypt: s => s };
    this.downloads = [];
    this.settings = { ...DEFAULT_SETTINGS };
    this.jobs = new Map();
    this.limiter = new RateLimiter(0);
    this.toolProgress = null;
    this.aria2 = null;
    this.lastTick = new Map();
    this.wasBusy = false;
    this.lastScheduleFire = '';
  }

  /* ---------------- persistence ---------------- */
  async init() {
    await fsp.mkdir(this.dataDir, { recursive: true });
    this.settings = { ...DEFAULT_SETTINGS, ...(await readJson(path.join(this.dataDir, 'settings.json')) || {}) };
    this.settings.scheduler = { ...DEFAULT_SETTINGS.scheduler, ...this.settings.scheduler };
    const saved = await readJson(path.join(this.dataDir, 'downloads.json')) || [];
    this.downloads = saved.map(d => {
      if (d.secret) { try { Object.assign(d, JSON.parse(this.crypt.decrypt(d.secret))); } catch {} delete d.secret; }
      if (['downloading', 'preparing'].includes(d.status)) d.status = this.settings.resumeOnStart ? 'queued' : 'paused';
      if (d.status === 'seeding') d.status = 'completed';
      d.speed = 0; d.connections = 0;
      return d;
    });
    this.applySettings();
    this.timer = setInterval(() => this.tick(), 1000);
    this.timer.unref?.();
    this.pump();
  }

  save() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => { this.saveTimer = null; this.saveNow().catch(e => this.emit('log', e)); }, 800);
  }
  async saveNow() {
    const list = this.downloads.map(d => {
      const { headers, cookies, speed, eta, ...rest } = d;
      const out = { ...rest, segments: d.segments?.map(s => ({ start: s.start, end: s.end, pos: s.pos })) };
      if ((headers && Object.keys(headers).length) || cookies?.length) out.secret = this.crypt.encrypt(JSON.stringify({ headers, cookies }));
      return out;
    });
    await writeJson(path.join(this.dataDir, 'downloads.json'), list);
  }
  async saveSettings() { await writeJson(path.join(this.dataDir, 'settings.json'), this.settings); }

  async shutdown() {
    clearInterval(this.timer);
    for (const [, job] of this.jobs) job.controller.abort();
    await Promise.allSettled([...this.jobs.values()].map(j => j.promise));
    await this.saveNow();
    if (this.aria2) await this.aria2.stop();
  }

  /* ---------------- settings ---------------- */
  getSettings() { return { ...this.settings }; }
  async updateSettings(patch) {
    const s = { ...this.settings, ...patch };
    s.maxConcurrent = clamp(s.maxConcurrent, 1, 16);
    s.connections = clamp(s.connections, 1, 32);
    s.speedLimit = Math.max(0, Number(s.speedLimit) || 0);
    s.uploadLimit = Math.max(0, Number(s.uploadLimit) || 0);
    s.seedRatio = Math.max(0, Math.min(20, Number(s.seedRatio) || 0));
    if (patch.scheduler) s.scheduler = { ...this.settings.scheduler, ...patch.scheduler };
    const proxyChanged = s.proxy !== this.settings.proxy;
    this.settings = s;
    this.applySettings(proxyChanged);
    await this.saveSettings();
    this.pump();
    this.changed();
    return this.getSettings();
  }
  applySettings(proxyChanged = true) {
    this.limiter.setLimit(this.settings.speedLimit * 1024);
    if (proxyChanged) setProxy(this.settings.proxy || '');
    if (this.aria2?.running()) {
      this.aria2.call('aria2.changeGlobalOption', {
        'max-overall-download-limit': String(this.settings.speedLimit * 1024),
        'max-overall-upload-limit': String(this.settings.uploadLimit * 1024),
        'seed-ratio': String(this.settings.seedRatio),
      }).catch(() => {});
    }
  }

  folderFor(category) {
    const base = this.settings.downloadDir;
    return this.settings.categoryFolders ? path.join(base, CATEGORY_FOLDERS[category] || 'General') : base;
  }

  /* ---------------- link inspection (Add dialog) ---------------- */
  async inspect(url, { headers, cookies, signal } = {}) {
    url = String(url || '').trim();
    if (/^magnet:/i.test(url)) {
      return { kind: 'torrent', url, name: magnetName(url) || magnetHash(url), infoHash: magnetHash(url), needsMeta: true };
    }
    let u;
    try { u = new URL(url); } catch { throw Object.assign(new Error('Not a valid link'), { code: 'BADURL' }); }
    if (/^(ftp|ftps|sftp):$/.test(u.protocol)) {
      return { kind: 'ftp', url, name: decodeURIComponent(u.pathname.split('/').pop() || u.hostname), size: null };
    }
    if (!/^https?:$/.test(u.protocol)) throw Object.assign(new Error('Unsupported link'), { code: 'BADURL' });
    if (gallery.isGallerySite(url)) {
      const g = gallery.describe(url);
      return { kind: 'gallery', url, name: [g.who, g.site].filter(Boolean).join(' · '), site: g.site, who: g.who, single: g.single };
    }
    if (video.isVideoSite(url)) return this.inspectVideo(url, { headers, cookies, signal });
    const info = await probe(url, headers, signal);
    if (/\.torrent(\?|$)/i.test(new URL(info.finalUrl).pathname) || info.type === 'application/x-bittorrent') {
      return { kind: 'torrent', url, name: info.name, size: info.total, remoteTorrent: true };
    }
    if (info.type === 'text/html' && this.tools.find('yt-dlp')) {
      // A web page: maybe a video page yt-dlp understands (only tried when yt-dlp is already here).
      try { return await this.inspectVideo(url, { headers, cookies, signal, noInstall: true }); } catch { /* not a video page */ }
    }
    return { kind: 'http', url, name: safeFilename(info.name || 'download'), size: info.total, resumable: info.ranges, type: info.type, category: categoryFor(info.name, 'http') };
  }

  async inspectVideo(url, { headers, cookies, signal, noInstall } = {}) {
    if (!noInstall) await this.ensureTools(/youtu/i.test(url) ? ['yt-dlp', 'deno'] : ['yt-dlp']);
    const info = await video.probeVideo(this.tools, url, { headers, cookies, signal, proxy: this.settings.proxy });
    return { kind: info.type === 'playlist' ? 'playlist' : 'video', url, ...info };
  }

  /** Read the file list of a .torrent or a magnet link (magnet: asks peers for it first). */
  async torrentInfo({ url, file, base64 }, signal) {
    let buf;
    if (file) buf = await fsp.readFile(file);
    else if (base64) buf = Buffer.from(base64, 'base64');
    else if (/^magnet:/i.test(url)) buf = await this.fetchMagnetMeta(url, signal);
    else {
      const { get } = require('./http');
      const res = await get(url);
      if (res.statusCode >= 400) { res.body.destroy(); throw new HttpError(res.statusCode); }
      buf = Buffer.from(await res.body.arrayBuffer());
    }
    const t = readTorrent(buf);
    return { ...t, base64: buf.toString('base64') };
  }

  async fetchMagnetMeta(magnet, signal) {
    const aria = await this.ensureAria2();
    const dir = path.join(this.dataDir, 'meta');
    await fsp.mkdir(dir, { recursive: true });
    const hash = magnetHash(magnet);
    const cached = hash && path.join(dir, `${hash}.torrent`);
    if (cached && fs.existsSync(cached)) return fsp.readFile(cached);
    const gid = await aria.call('aria2.addUri', [magnet], { 'bt-metadata-only': 'true', 'bt-save-metadata': 'true', dir, 'follow-torrent': 'false' });
    try {
      for (;;) {
        await sleep(1000, signal);
        const st = await aria.call('aria2.tellStatus', gid, ['status', 'infoHash', 'errorMessage']);
        if (st.status === 'error') throw new Error(st.errorMessage || 'Could not get the torrent details');
        const f = path.join(dir, `${(st.infoHash || hash).toLowerCase()}.torrent`);
        if (fs.existsSync(f)) return fsp.readFile(f);
        if (st.status === 'complete' || st.status === 'removed') throw new Error('Could not get the torrent details');
      }
    } finally {
      aria.call('aria2.forceRemove', gid).catch(() => {});
      setTimeout(() => aria.call('aria2.removeDownloadResult', gid).catch(() => {}), 1500);
    }
  }

  /* ---------------- adding ---------------- */
  /**
   * item: { url, kind, filename, directory, category, headers, cookies, start: 'now'|'later'|'paused',
   *         size, video: { quality, subtitles }, torrent: { base64, selected:[1,3], name, total } }
   */
  add(item) {
    const kind = item.kind || (/^magnet:/i.test(item.url) ? 'torrent' : /^(s?ftp|ftps):/i.test(item.url) ? 'ftp' : gallery.isGallerySite(item.url) ? 'gallery' : video.isVideoSite(item.url) ? 'video' : 'http');
    if (!item.force) {
      const dup = this.downloads.find(d => d.url === item.url && d.status !== 'completed' && (kind !== 'video' || d.video?.quality === item.video?.quality));
      if (dup) return { duplicate: true, id: dup.id };
    }
    const category = item.category || categoryFor(item.filename || item.url, kind);
    const d = {
      id: newId(), kind, url: item.url, pageUrl: item.pageUrl,
      filename: item.filename ? safeFilename(item.filename) : null,
      filenameLocked: Boolean(item.filename),
      directory: item.directory || this.folderFor(category), category,
      status: item.start === 'later' ? 'waiting' : item.start === 'paused' ? 'paused' : 'queued',
      total: item.size ?? null, downloaded: 0, speed: 0, connections: 0, segments: [],
      createdAt: new Date().toISOString(), order: Date.now(),
      headers: item.headers || {}, cookies: item.cookies || [],
      speedLimit: 0,
    };
    if (kind === 'video') d.video = { quality: item.video?.quality || this.settings.videoQuality, subtitles: item.video?.subtitles || (this.settings.subtitles ? this.settings.subtitleLangs.split(/[,\s]+/).filter(Boolean) : []), title: item.video?.title };
    if (kind === 'video' && !d.filename) d.filename = item.video?.title || item.url;
    if (kind === 'torrent') {
      d.torrent = { selected: item.torrent?.selected || null, name: item.torrent?.name || magnetName(item.url), infoHash: item.torrent?.infoHash || magnetHash(item.url) };
      d.filename = d.torrent.name || d.filename || 'torrent';
      if (item.torrent?.base64) {
        const file = path.join(this.dataDir, 'torrents', `${d.id}.torrent`);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, Buffer.from(item.torrent.base64, 'base64'));
        d.torrent.file = file;
        const t = readTorrent(Buffer.from(item.torrent.base64, 'base64'));
        d.torrent.files = t.files; d.torrent.name = t.name; d.torrent.infoHash = t.infoHash; d.filename = t.name;
        d.total = t.files.filter(f => !d.torrent.selected || d.torrent.selected.includes(f.index)).reduce((n, f) => n + f.length, 0);
      }
    }
    if (kind === 'gallery') {
      const g = gallery.describe(item.url);
      d.category = 'images';
      d.directory = item.directory || this.folderFor('images');
      d.gallery = { posts: g.single ? 0 : Math.max(0, Number(item.gallery?.posts ?? this.settings.galleryPosts) || 0), types: item.gallery?.types || 'all', text: ['with', 'only'].includes(item.gallery?.text) ? item.gallery.text : (this.settings.galleryText || 'none'), site: g.site, who: g.who, single: g.single };
      d.filename = item.filename || [g.who, g.site].filter(Boolean).join(' · ') || item.url;
      d.bytes = 0;
    }
    if (kind === 'ftp' && !d.filename) d.filename = safeFilename(decodeURIComponent(new URL(item.url).pathname.split('/').pop() || 'download'));
    this.downloads.push(d);
    this.save(); this.changed(); this.pump();
    return { id: d.id };
  }

  /* ---------------- controls ---------------- */
  find(id) { return this.downloads.find(d => d.id === id); }

  async control(id, action, opts = {}) {
    const d = this.find(id);
    if (!d) return;
    switch (action) {
      case 'pause':
        if (this.jobs.has(id)) { d.pausing = true; this.jobs.get(id).controller.abort(); }
        else if (['queued', 'waiting', 'error'].includes(d.status)) d.status = 'paused';
        if (d.kind === 'torrent' && d.status === 'seeding') await this.stopSeeding(d);
        break;
      case 'resume':
        if (['paused', 'error', 'waiting'].includes(d.status)) { d.status = 'queued'; d.error = null; d.order = Date.now(); }
        if (opts.now) d.order = 0;
        break;
      case 'later':
        if (!this.jobs.has(id) && d.status !== 'completed') d.status = 'waiting';
        break;
      case 'restart':
        await this.stopJob(d);
        await this.removeData(d, false);
        Object.assign(d, { status: 'queued', downloaded: 0, segments: [], error: null, notice: null, path: null, tempPath: null, completedAt: null });
        if (d.kind === 'torrent') delete d.torrent.gid;
        break;
      case 'remove':
        await this.stopJob(d);
        await this.removeData(d, Boolean(opts.deleteFile));
        this.downloads = this.downloads.filter(x => x !== d);
        break;
      case 'stopSeeding':
        await this.stopSeeding(d);
        break;
      case 'up': case 'down': {
        const q = this.downloads.filter(x => ['queued', 'waiting', 'paused'].includes(x.status)).sort((a, b) => a.order - b.order);
        const i = q.indexOf(d), j = action === 'up' ? i - 1 : i + 1;
        if (i >= 0 && q[j]) [d.order, q[j].order] = [q[j].order, d.order === q[j].order ? d.order + 1 : d.order];
        break;
      }
      case 'rename':
        if (d.status !== 'completed' && !this.jobs.has(id) && opts.name) { d.filename = safeFilename(opts.name); d.filenameLocked = true; d.path = null; d.tempPath = null; d.segments = []; d.downloaded = 0; }
        break;
      case 'limit':
        d.speedLimit = Math.max(0, Number(opts.kbps) || 0);
        if (this.jobs.get(id)?.limiter) this.jobs.get(id).limiter.setLimit(d.speedLimit * 1024);
        if (d.kind === 'torrent' && d.torrent?.gid && this.aria2?.running()) this.aria2.call('aria2.changeOption', d.torrent.gid, { 'max-download-limit': String(d.speedLimit * 1024) }).catch(() => {});
        break;
      case 'refreshUrl':
        // The link expired (common with signed links): give a new one and keep the downloaded parts.
        if (!this.jobs.has(id) && opts.url) { d.url = opts.url; if (opts.headers) d.headers = opts.headers; d.status = 'queued'; d.error = null; }
        break;
    }
    this.save(); this.changed(); this.pump();
  }

  async bulk(action, ids) {
    const list = ids?.length ? ids : this.downloads.map(d => d.id);
    for (const id of list) await this.control(id, action);
  }

  async stopJob(d) {
    const job = this.jobs.get(d.id);
    if (job) { d.pausing = true; job.controller.abort(); await job.promise.catch(() => {}); }
    if (d.kind === 'torrent' || d.kind === 'ftp') {
      const gid = d.torrent?.gid || d.gid;
      if (gid && this.aria2?.running()) {
        await this.aria2.call('aria2.forceRemove', gid).catch(() => {});
        await this.aria2.call('aria2.removeDownloadResult', gid).catch(() => {});
      }
    }
  }

  async stopSeeding(d) {
    const gid = d.torrent?.gid;
    if (gid && this.aria2?.running()) { await this.aria2.call('aria2.forceRemove', gid).catch(() => {}); await this.aria2.call('aria2.removeDownloadResult', gid).catch(() => {}); }
    if (d.torrent) delete d.torrent.gid;
    d.status = 'completed'; d.speed = 0; d.upSpeed = 0;
  }

  async removeData(d, deleteFile) {
    if (d.tempPath) await fsp.rm(d.tempPath, { force: true }).catch(() => {});
    if (deleteFile && d.path) await fsp.rm(d.path, { force: true, recursive: true }).catch(() => {});
    if (deleteFile && d.kind === 'torrent' && d.torrent?.files) {
      for (const f of d.torrent.files) {
        const p = path.join(d.directory, ...f.path.split('/'));
        await fsp.rm(p, { force: true }).catch(() => {});
        await fsp.rm(p + '.aria2', { force: true }).catch(() => {});
      }
      if (d.torrent.name) {
        const root = path.join(d.directory, d.torrent.name);
        await fsp.rm(root + '.aria2', { force: true }).catch(() => {});
        try { if (fs.statSync(root).isDirectory()) await removeEmptyDirs(root); } catch {}
      }
    }
    if (!deleteFile && d.kind === 'torrent') { /* keep files */ }
    if (d.torrent?.file && deleteFile !== undefined && !this.downloads.includes(d)) await fsp.rm(d.torrent.file, { force: true }).catch(() => {});
  }

  /* ---------------- queue ---------------- */
  pump() {
    const running = [...this.jobs.keys()].map(id => this.find(id)).filter(d => d && d.status !== 'seeding').length;
    let slots = this.settings.maxConcurrent - running;
    const queued = this.downloads.filter(d => d.status === 'queued' && !this.jobs.has(d.id)).sort((a, b) => a.order - b.order);
    for (const d of queued) {
      if (slots <= 0) break;
      this.start(d);
      slots--;
    }
  }

  start(d) {
    const controller = new AbortController();
    const limiter = new RateLimiter((d.speedLimit || 0) * 1024);
    d.status = d.kind === 'video' || (d.kind === 'torrent' && !d.torrent?.file) ? 'preparing' : 'downloading';
    d.error = null; d.notice = d.notice || null; d.pausing = false; d.startedAt = Date.now();
    const runner = { http: () => this.runHttp(d, controller.signal, limiter), video: () => this.runVideo(d, controller.signal), gallery: () => this.runGallery(d, controller.signal), torrent: () => this.runTorrent(d, controller.signal), ftp: () => this.runFtp(d, controller.signal) }[d.kind];
    const promise = (async () => {
      try {
        await runner();
        if (d.status !== 'seeding') d.status = 'completed';
        d.completedAt = new Date().toISOString();
        d.speed = 0; d.eta = null; d.connections = 0;
        this.emit('completed', this.public(d));
      } catch (e) {
        d.speed = 0; d.connections = 0;
        if (controller.signal.aborted || e?.name === 'AbortError') {
          if (this.downloads.includes(d) && d.status !== 'completed') d.status = d.toWaiting ? 'waiting' : 'paused';
        } else {
          d.status = 'error';
          d.error = describeError(e);
          this.emit('failed', this.public(d));
        }
      } finally {
        this.jobs.delete(d.id);
        delete d.pausing; delete d.toWaiting;
        this.save(); this.changed();
        setImmediate(() => { this.pump(); this.checkAllDone(); });
      }
    })();
    this.jobs.set(d.id, { controller, promise, limiter });
    this.changed();
  }

  /** Live view of names in use, so two downloads starting together never pick the same file. */
  takenPaths() {
    return { has: p => this.downloads.some(x => x.status !== 'completed' && x.path && x.path.toLowerCase() === p) };
  }

  async runHttp(d, signal, limiter) {
    const t = new HttpTransfer(d, {
      connections: this.settings.connections,
      limiters: [this.limiter, limiter],
      takenPaths: this.takenPaths(),
    });
    const saver = setInterval(() => this.save(), 2000);
    try { await t.run(signal); } finally { clearInterval(saver); }
  }

  async runGallery(d, signal) {
    d.status = 'downloading'; d.connections = 1;
    this.changed();
    const before = d.downloaded || 0;
    const res = await gallery.downloadGallery(this.tools, d, {
      signal, dataDir: this.dataDir,
      rateLimit: this.settings.speedLimit ? `${this.settings.speedLimit}k` : (d.speedLimit ? `${d.speedLimit}k` : null),
      proxy: this.settings.proxy, cookiesBrowser: this.settings.cookiesBrowser || '',
      onProgress: p => {
        d.downloaded = p.files; d.bytes = p.bytes;
        if (p.posts != null) d.posts = p.posts;
        if (p.dir) d.path = p.dir;
        const now = Date.now();
        if (!d._t || now - d._t > 1000) { d.speed = d._b != null ? Math.max(0, (p.bytes - d._b) / ((now - d._t) / 1000)) : 0; d._t = now; d._b = p.bytes; }
        this.changed();
      },
    });
    d.downloaded = res.files; d.bytes = res.bytes; d.total = null; d.posts = res.posts || 0;
    if (res.textFile) d.textFile = res.textFile;
    if (res.dir) d.path = res.dir;
    if (d.gallery?.text === 'only' && !res.posts) { const e = new Error('NOTHING_FOUND'); e.code = 'NOTHING_FOUND'; throw e; }
    if (!res.dir && res.files === before) { const e = new Error('NOTHING_FOUND'); e.code = 'NOTHING_FOUND'; throw e; }
    delete d._t; delete d._b;
  }

  async runVideo(d, signal) {
    await this.ensureTools(['yt-dlp', 'deno', 'ffmpeg'], d);
    d.status = 'downloading';
    this.changed();
    const file = await video.downloadVideo(this.tools, d, {
      signal,
      connections: this.settings.connections,
      rateLimit: this.settings.speedLimit ? `${this.settings.speedLimit}K` : null,
      proxy: this.settings.proxy,
      onProgress: p => {
        if (p.phase === 'merge') { d.phase = 'merge'; d.speed = 0; this.changed(); return; }
        d.phase = 'download';
        d.downloaded = p.downloaded;
        if (!d.totalFixed) d.total = Math.max(d.total || 0, p.partTotal || 0) || null;
        d.speed = p.speed; d.eta = p.eta; d.connections = 1;
      },
    });
    if (file) { d.path = file; d.filename = path.basename(file); try { d.total = d.downloaded = fs.statSync(file).size; } catch {} }
    d.phase = null;
  }

  async ensureAria2() {
    if (!this.aria2) {
      const bin = this.tools.find('aria2c') || await this.ensureTools(['aria2c']).then(() => this.tools.find('aria2c'));
      this.aria2 = new Aria2(bin, path.join(this.dataDir, 'aria2'));
    }
    await this.aria2.start({
      seedRatio: this.settings.seedRatio, downloadLimit: this.settings.speedLimit * 1024, uploadLimit: this.settings.uploadLimit * 1024,
      trackers: this.settings.extraTrackers, proxy: this.settings.proxy,
    });
    return this.aria2;
  }

  async runTorrent(d, signal) {
    const aria = await this.ensureAria2();
    if (!d.torrent.file) {
      d.status = 'preparing'; d.phase = 'meta'; this.changed();
      const buf = await this.fetchMagnetMeta(d.url, signal);
      const file = path.join(this.dataDir, 'torrents', `${d.id}.torrent`);
      await fsp.mkdir(path.dirname(file), { recursive: true });
      await fsp.writeFile(file, buf);
      const t = readTorrent(buf);
      Object.assign(d.torrent, { file, files: t.files, name: t.name, infoHash: t.infoHash });
      d.filename = t.name;
      d.total = t.files.filter(f => !d.torrent.selected || d.torrent.selected.includes(f.index)).reduce((n, f) => n + f.length, 0);
    }
    d.status = 'downloading'; d.phase = null; this.changed();
    let gid = d.torrent.gid;
    let alive = false;
    if (gid) { try { const st = await aria.call('aria2.tellStatus', gid, ['status']); alive = st.status !== 'removed'; } catch {} }
    if (alive) await aria.call('aria2.unpause', gid).catch(() => {});
    else {
      const opts = { dir: d.directory, 'seed-ratio': String(this.settings.seedRatio), 'max-download-limit': String((d.speedLimit || 0) * 1024), 'check-integrity': d.downloaded > 0 ? 'true' : 'false' };
      if (d.torrent.selected?.length) opts['select-file'] = d.torrent.selected.join(',');
      gid = await aria.call('aria2.addTorrent', (await fsp.readFile(d.torrent.file)).toString('base64'), [], opts);
      d.torrent.gid = gid;
      this.save();
    }
    return this.followAria(d, gid, signal, true);
  }

  async runFtp(d, signal) {
    const aria = await this.ensureAria2();
    const opts = { dir: d.directory, split: String(this.settings.connections), 'max-connection-per-server': String(Math.min(16, this.settings.connections)), 'max-download-limit': String((d.speedLimit || 0) * 1024) };
    if (d.filename) opts.out = d.filename;
    d.status = 'downloading';
    const gid = await aria.call('aria2.addUri', [d.url], opts);
    d.gid = gid;
    await this.followAria(d, gid, signal, false);
    await aria.call('aria2.removeDownloadResult', gid).catch(() => {});
    d.gid = null;
  }

  /** Poll aria2 until the download is done. Torrents keep sharing in the background afterwards. */
  async followAria(d, gid, signal, torrent) {
    const aria = this.aria2;
    const onAbort = () => { aria.call('aria2.forcePause', gid).catch(() => {}); };
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      for (;;) {
        if (signal.aborted) throw Object.assign(new Error('Aborted'), { name: 'AbortError' });
        let st;
        try { st = await aria.call('aria2.tellStatus', gid, ['status', 'totalLength', 'completedLength', 'downloadSpeed', 'uploadSpeed', 'uploadLength', 'connections', 'numSeeders', 'seeder', 'errorMessage', 'files', 'verifiedLength']); }
        catch (e) { if (!aria.running()) throw new Error('The torrent engine stopped'); throw e; }
        d.total = Number(st.totalLength) || d.total;
        d.downloaded = Number(st.completedLength);
        d.speed = Number(st.downloadSpeed); d.upSpeed = Number(st.uploadSpeed);
        d.connections = Number(st.connections);
        if (torrent) {
          d.torrent.seeders = Number(st.numSeeders || 0);
          d.torrent.uploaded = Number(st.uploadLength || 0);
          d.torrent.ratio = d.total ? d.torrent.uploaded / d.total : 0;
          d.torrent.fileProgress = (st.files || []).map(f => ({ index: Number(f.index), done: Number(f.completedLength), length: Number(f.length), selected: f.selected === 'true' }));
        } else if (st.files?.[0]?.path) { d.path = st.files[0].path; d.filename = path.basename(d.path); }
        d.eta = d.speed ? (d.total - d.downloaded) / d.speed : null;
        if (st.status === 'error') throw new Error(st.errorMessage || 'Download failed');
        if (st.status === 'removed') throw Object.assign(new Error('Aborted'), { name: 'AbortError' });
        const done = st.status === 'complete' || st.seeder === 'true' || (d.total > 0 && d.downloaded >= d.total);
        if (done) {
          if (torrent) {
            d.path = path.join(d.directory, d.torrent.name);
            d.downloaded = d.total;
            if (st.status !== 'complete' && this.settings.seedRatio > 0) { d.status = 'seeding'; this.watchSeeding(d, gid); }
            else {
              // let aria2 finish its own wrap-up (it removes partial pieces of files you didn't choose)
              for (let i = 0; i < 20 && st.status !== 'complete'; i++) {
                await sleep(500);
                st = await aria.call('aria2.tellStatus', gid, ['status']).catch(() => ({ status: 'complete' }));
              }
              await aria.call('aria2.removeDownloadResult', gid).catch(() => {});
              await this.cleanUnselected(d);
            }
          }
          return;
        }
        if (torrent) { try { d.torrent.peers = (await aria.call('aria2.getPeers', gid)).slice(0, 60).map(p => ({ ip: p.ip, port: p.port, down: Number(p.downloadSpeed), up: Number(p.uploadSpeed), seeder: p.seeder === 'true' })); } catch {} }
        await sleep(1000);
      }
    } finally { signal.removeEventListener('abort', onAbort); }
  }

  /** Pieces that cross file borders leave partial files you didn't choose; remove them. */
  async cleanUnselected(d) {
    const sel = d.torrent?.selected;
    if (!sel?.length || !d.torrent.files) return;
    for (const f of d.torrent.files) {
      if (sel.includes(f.index)) continue;
      const p = path.join(d.directory, ...f.path.split('/'));
      await fsp.rm(p, { force: true }).catch(() => {});
      let dir = path.dirname(p);
      const root = path.join(d.directory, d.torrent.name);
      while (dir.startsWith(root) && dir !== root) { try { await fsp.rmdir(dir); } catch { break; } dir = path.dirname(dir); }
    }
  }

  watchSeeding(d, gid) {
    const t = setInterval(async () => {
      if (!this.downloads.includes(d) || d.status !== 'seeding' || !this.aria2?.running()) { clearInterval(t); if (d.status === 'seeding') d.status = 'completed'; this.changed(); return; }
      try {
        const st = await this.aria2.call('aria2.tellStatus', gid, ['status', 'uploadSpeed', 'uploadLength', 'connections']);
        d.upSpeed = Number(st.uploadSpeed); d.torrent.uploaded = Number(st.uploadLength); d.torrent.ratio = d.total ? d.torrent.uploaded / d.total : 0; d.connections = Number(st.connections);
        if (st.status !== 'active') { clearInterval(t); d.status = 'completed'; d.upSpeed = 0; delete d.torrent.gid; this.aria2.call('aria2.removeDownloadResult', gid).catch(() => {}); this.cleanUnselected(d); this.save(); this.changed(); }
      } catch { clearInterval(t); d.status = 'completed'; this.changed(); }
    }, 2000);
  }

  async ensureTools(names, d) {
    for (const name of names) {
      if (this.tools.find(name)) continue;
      if (d) { d.status = 'preparing'; d.phase = `tool:${name}`; }
      this.toolProgress = { name, done: 0, total: 0 };
      this.changed();
      try {
        await this.tools.ensure(name, (n, done, total) => { this.toolProgress = { name: n, done, total }; if (d) { d.downloaded = done; d.total = total; } this.changed(); });
      } finally { this.toolProgress = null; if (d) { d.downloaded = 0; d.total = null; d.phase = null; } this.changed(); }
    }
  }

  /* ---------------- ticking: speed, scheduler ---------------- */
  tick() {
    const now = Date.now();
    for (const [id] of this.jobs) {
      const d = this.find(id);
      if (!d || d.kind !== 'http') continue;
      const prev = this.lastTick.get(id);
      if (prev) {
        const inst = Math.max(0, (d.downloaded - prev.bytes) / ((now - prev.t) / 1000));
        d.speed = d.speed ? d.speed * 0.6 + inst * 0.4 : inst;
        d.eta = d.total && d.speed > 1 ? (d.total - d.downloaded) / d.speed : null;
      }
      this.lastTick.set(id, { bytes: d.downloaded, t: now });
    }
    for (const id of this.lastTick.keys()) if (!this.jobs.has(id)) this.lastTick.delete(id);
    this.runScheduler(new Date());
    if (this.jobs.size) this.changed();
  }

  runScheduler(now) {
    const s = this.settings.scheduler;
    if (!s?.enabled || !s.days?.includes(now.getDay())) return;
    const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const key = `${now.toDateString()} ${hm}`;
    if (this.lastScheduleFire === key) return;
    if (s.start && hm === s.start) {
      this.lastScheduleFire = key;
      for (const d of this.downloads) if (d.status === 'waiting') { d.status = 'queued'; d.fromSchedule = true; }
      this.scheduledRun = true;
      this.emit('schedule', 'start');
      this.save(); this.pump(); this.changed();
    } else if (s.stop && hm === s.stop) {
      this.lastScheduleFire = key;
      for (const d of this.downloads) {
        if (!d.fromSchedule) continue;
        if (this.jobs.has(d.id)) { d.toWaiting = true; this.jobs.get(d.id).controller.abort(); }
        else if (d.status === 'queued') d.status = 'waiting';
      }
      this.emit('schedule', 'stop');
      this.save(); this.changed();
    }
  }

  checkAllDone() {
    const busy = this.jobs.size > 0 && [...this.jobs.keys()].some(id => this.find(id)?.status !== 'seeding');
    const pending = this.downloads.some(d => d.status === 'queued');
    if (busy || pending) { this.wasBusy = true; return; }
    if (this.wasBusy) {
      this.wasBusy = false;
      const anyError = this.downloads.some(d => d.status === 'error' && d.fromSchedule);
      for (const d of this.downloads) delete d.fromSchedule;
      if (this.settings.afterAllDone !== 'none') this.emit('all-done', { action: this.settings.afterAllDone, anyError });
      this.scheduledRun = false;
    }
  }

  /* ---------------- reading ---------------- */
  public(d) {
    const { headers, cookies, pausing, toWaiting, ...rest } = d;
    return { ...rest, hasCookies: Boolean(cookies?.length || headers?.cookie) };
  }
  snapshot() {
    const totalSpeed = [...this.jobs.keys()].reduce((n, id) => n + (this.find(id)?.speed || 0), 0);
    return {
      downloads: this.downloads.map(d => this.public(d)),
      totalSpeed,
      active: this.jobs.size,
      toolProgress: this.toolProgress,
    };
  }
  changed() {
    if (this.changeTimer) return;
    this.changeTimer = setTimeout(() => { this.changeTimer = null; this.emit('changed'); }, 120);
  }

  async sha256(id) {
    const d = this.find(id);
    if (!d?.path || !fs.existsSync(d.path) || fs.statSync(d.path).isDirectory()) throw new Error('File not found');
    const h = crypto.createHash('sha256');
    for await (const c of fs.createReadStream(d.path)) h.update(c);
    return h.digest('hex');
  }
}

function describeError(e) {
  if (!e) return 'Unknown error';
  if (e.code === 'NOSPACE') return 'NOSPACE';
  if (e.gallery || e.code === 'NOTHING_FOUND') return e.code === 'NOTHING_FOUND' ? 'NOTHING_FOUND' : e.message;
  if (e instanceof HttpError || e.status) return `HTTP ${e.status}`;
  if (e.code === 'TOOL_MISSING' || (e.code === 'ENOENT' && /yt-dlp|aria2c|deno|ffmpeg|gallery-dl/.test(e.path || e.message))) return 'TOOL_MISSING';
  if (['ENOTFOUND', 'EAI_AGAIN'].includes(e.code || e.cause?.code)) return 'NO_INTERNET';
  if (['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT'].includes(e.code || e.cause?.code)) return 'CONNECTION';
  if (e.code === 'EACCES' || e.code === 'EPERM') return 'NO_PERMISSION';
  return String(e.message || e).slice(0, 300);
}

async function removeEmptyDirs(dir) {
  for (const e of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])) if (e.isDirectory()) await removeEmptyDirs(path.join(dir, e.name));
  await fsp.rmdir(dir).catch(() => {});
}
function clamp(v, a, b) { return Math.max(a, Math.min(b, Math.round(Number(v) || a))); }
async function readJson(p) { try { return JSON.parse(await fsp.readFile(p, 'utf8')); } catch { try { return JSON.parse(await fsp.readFile(p + '.bak', 'utf8')); } catch { return null; } } }
async function writeJson(p, data) {
  const tmp = p + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(data, null, 1));
  if (fs.existsSync(p)) await fsp.copyFile(p, p + '.bak').catch(() => {});
  await fsp.rename(tmp, p);
}

module.exports = { Manager, DEFAULT_SETTINGS, CATEGORY_FOLDERS, describeError };
