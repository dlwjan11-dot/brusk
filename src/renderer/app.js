'use strict';
/* global I18N, icon */
const api = window.barq;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const S = {
  settings: { language: 'ar', theme: 'system' }, downloads: [], totalSpeed: 0, toolProgress: null,
  filter: 'all', search: '', selected: new Set(), anchor: null, detailsTab: 'general', history: new Array(60).fill(0),
  rows: new Map(), sigs: new Map(),
};

/* ---------------- text ---------------- */
function t(key, vars) {
  const L = I18N[S.settings.language] || I18N.ar;
  let s = L[key] ?? I18N.en[key] ?? key;
  if (vars && typeof s === 'string') for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, v);
  return s;
}
function applyLang() {
  const lang = I18N[S.settings.language] ? S.settings.language : 'ar';
  const ar = lang !== 'en';   // Arabic and Sorani Kurdish are both written right to left
  document.documentElement.lang = lang;
  document.documentElement.dir = ar ? 'rtl' : 'ltr';
  $$('[data-t]').forEach(el => { el.textContent = t(el.dataset.t); });
  $('#search').placeholder = t('search');
}
function applyTheme() {
  const th = S.settings.theme;
  const dark = th === 'dark' || (th === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

/* ---------------- formatting ---------------- */
function fmtSize(b) {
  if (b == null || !Number.isFinite(b)) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0;
  while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
  return `${b.toFixed(i === 0 ? 0 : b >= 100 ? 0 : b >= 10 ? 1 : 2)} ${u[i]}`;
}
const fmtSpeed = b => `${fmtSize(b || 0)}/s`;
function fmtEta(s) {
  if (s == null || !Number.isFinite(s) || s < 0) return '';
  s = Math.round(s);
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}
function fmtDate(iso) {
  if (!iso) return '—';
  const loc = { en: 'en-GB', ckb: 'ckb-IQ-u-nu-latn' }[S.settings.language] || 'ar-SY-u-nu-latn';
  try { return new Date(iso).toLocaleString(loc, { dateStyle: 'medium', timeStyle: 'short' }); }
  catch { return new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }); }
}
function errText(e) { return e ? t('e_' + e) !== 'e_' + e ? t('e_' + e) : e : ''; }

/* ---------------- categories ---------------- */
const NAV = [
  { sec: 'sec_status' },
  { id: 'all', icon: 'all' }, { id: 'active', icon: 'down' }, { id: 'unfinished', icon: 'half' }, { id: 'done', icon: 'check' }, { id: 'later', icon: 'later' },
  { sec: 'sec_types' },
  { id: 'video', icon: 'video' }, { id: 'music', icon: 'music' }, { id: 'documents', icon: 'doc' }, { id: 'compressed', icon: 'zip' },
  { id: 'programs', icon: 'app' }, { id: 'images', icon: 'image' }, { id: 'torrents', icon: 'magnet' }, { id: 'other', icon: 'other' },
];
const CAT_ICON = { video: 'video', music: 'music', documents: 'doc', compressed: 'zip', programs: 'app', images: 'image', torrents: 'magnet', other: 'file' };
const ACTIVE = ['downloading', 'preparing'];
function matches(d, f) {
  switch (f) {
    case 'all': return true;
    case 'active': return ACTIVE.includes(d.status) || d.status === 'seeding';
    case 'unfinished': return !['completed', 'seeding'].includes(d.status);
    case 'done': return d.status === 'completed' || d.status === 'seeding';
    case 'later': return d.status === 'waiting';
    default: return d.category === f;
  }
}
function filtered() {
  const q = S.search.trim().toLowerCase();
  return S.downloads.filter(d => matches(d, S.filter) && (!q || (d.filename || '').toLowerCase().includes(q) || (d.url || '').toLowerCase().includes(q)))
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}
function renderNav() {
  const nav = $('#nav');
  nav.innerHTML = NAV.map(n => n.sec ? `<div class="nav-sec">${esc(t(n.sec))}</div>` : `
    <button class="nav-item ${S.filter === n.id ? 'on' : ''}" data-f="${n.id}">${icon(n.icon)}<span class="label">${esc(t('cat_' + n.id))}</span><span class="count">${S.downloads.filter(d => matches(d, n.id)).length || ''}</span></button>`).join('');
}
$('#nav').addEventListener('click', e => {
  const b = e.target.closest('[data-f]'); if (!b) return;
  S.filter = b.dataset.f; S.selected.clear(); renderAll();
});

/* ---------------- toolbar ---------------- */
function renderToolbar() {
  const sel = selectedDownloads();
  const can = st => sel.some(d => st.includes(d.status));
  $('#toolbar').innerHTML = `
    <span class="tb-title">${esc(t('cat_' + S.filter))}</span>
    <button class="tb" data-a="resume" ${can(['paused', 'error', 'waiting']) ? '' : 'disabled'}>${icon('play')}${esc(t('resume'))}</button>
    <button class="tb" data-a="pause" ${can(['downloading', 'preparing', 'queued', 'seeding']) ? '' : 'disabled'}>${icon('pause')}${esc(t('pause'))}</button>
    <button class="tb" data-a="remove" ${sel.length ? '' : 'disabled'}>${icon('trash')}${esc(t('remove'))}</button>
    <span class="tb-sep"></span>
    <button class="tb" data-a="startAll">${icon('playAll')}${esc(t('start_all'))}</button>
    <button class="tb" data-a="pauseAll">${icon('pauseAll')}${esc(t('pause_all'))}</button>
    <span class="tb-grow"></span>
    <button class="tb" data-a="scheduler">${icon('clock')}${esc(t('scheduler'))}${S.settings.scheduler?.enabled ? ` <span class="pill waiting">${esc(S.settings.scheduler.start)}</span>` : ''}</button>`;
}
$('#toolbar').addEventListener('click', e => {
  const b = e.target.closest('[data-a]'); if (!b || b.disabled) return;
  const ids = [...S.selected];
  ({
    resume: () => api.bulk('resume', ids),
    pause: () => api.bulk('pause', ids),
    remove: () => confirmRemove(ids),
    startAll: () => api.bulk('resume', S.downloads.filter(d => ['paused', 'error', 'waiting'].includes(d.status)).map(d => d.id)),
    pauseAll: () => api.bulk('pause', S.downloads.filter(d => ['downloading', 'preparing', 'queued'].includes(d.status)).map(d => d.id)),
    scheduler: () => openSettings('schedule'),
  })[b.dataset.a]?.();
});
function selectedDownloads() { return S.downloads.filter(d => S.selected.has(d.id)); }

/* ---------------- list ---------------- */
function progressHtml(d) {
  const pct = d.total ? Math.min(100, d.downloaded / d.total * 100) : 0;
  const cls = d.status === 'completed' ? 'done' : d.status === 'error' ? 'err' : d.status === 'seeding' ? 'seed' : ['paused', 'waiting', 'queued'].includes(d.status) ? 'paused' : '';
  const indet = (ACTIVE.includes(d.status) && !d.total) || d.phase === 'merge' || d.phase === 'meta' || (d.kind === 'gallery' && ACTIVE.includes(d.status));
  const segs = d.kind === 'http' && d.total && d.segments?.length > 1 && d.status !== 'completed';
  let inner = `<i style="width:${d.status === 'completed' ? 100 : pct.toFixed(2)}%"></i>`;
  if (segs) {
    inner = d.segments.slice(0, 64).map(s => {
      const left = s.start / d.total * 100, w = Math.max(0, s.pos - s.start) / d.total * 100;
      return `<span class="seg" style="inset-inline-start:${left.toFixed(3)}%;width:${w.toFixed(3)}%"></span>`;
    }).join('');
  }
  return `<div class="bar ${cls} ${segs ? 'segs' : ''} ${indet ? 'indet' : ''}">${inner}</div>`;
}
function metaHtml(d) {
  const parts = [];
  if (d.kind === 'gallery') {
    if (d.status !== 'error' || d.downloaded) parts.push(`<span>${esc(t('n_files', { n: d.downloaded || 0 }))}</span>` + (d.bytes ? `<span class="ltr"> · ${fmtSize(d.bytes)}</span>` : ''));
    if (d.status === 'downloading') parts.push(`<span class="ltr">${fmtSpeed(d.speed)}</span>`);
    if (d.gallery?.posts && !d.gallery.single) parts.push(`<span>${esc(t('g_last', { n: d.gallery.posts }))}</span>`);
    if (d.status === 'error') parts.push(`<span class="err">${esc(errText(d.error))}</span>`);
    if (d.status === 'completed' && d.completedAt) parts.push(`<span>${esc(fmtDate(d.completedAt))}</span>`);
    return parts.join('<span class="dot"></span>');
  }
  const sizeTxt = d.status === 'completed' ? fmtSize(d.total) : d.total ? `${fmtSize(d.downloaded)} / ${fmtSize(d.total)}` : d.downloaded ? fmtSize(d.downloaded) : '';
  if (d.phase === 'merge') parts.push(esc(t('ph_merge')));
  else if (d.phase === 'meta') parts.push(esc(t('ph_meta')));
  else if (d.phase?.startsWith('tool:')) parts.push(esc(t('ph_tool', { name: d.phase.slice(5) })) + (d.total ? ` <span class="ltr">${Math.round(d.downloaded / d.total * 100)}%</span>` : ''));
  else if (sizeTxt) parts.push(`<span class="ltr">${sizeTxt}</span>`);
  if (d.status === 'downloading') {
    if (d.total) parts.push(`<span class="ltr">${Math.floor(d.downloaded / d.total * 100)}%</span>`);
    parts.push(`<span class="ltr">${fmtSpeed(d.speed)}</span>`);
    if (d.eta != null) parts.push(`<span>${fmtEta(d.eta)} ${esc(t('left'))}</span>`);
    if (d.connections) parts.push(`<span>${d.connections} ${esc(d.kind === 'torrent' ? t('peers') : t('conns'))}</span>`);
  }
  if (d.status === 'seeding') parts.push(`<span class="ltr">↑ ${fmtSpeed(d.upSpeed)}</span><span>${esc(t('ratio'))} ${(d.torrent?.ratio || 0).toFixed(2)}</span>`);
  if (d.status === 'error') parts.push(`<span class="err">${esc(errText(d.error))}</span>`);
  if (d.notice && d.status !== 'completed') parts.push(`<span class="warn">${esc(t('n_' + d.notice))}</span>`);
  if (d.status === 'completed' && d.completedAt) parts.push(`<span>${esc(fmtDate(d.completedAt))}</span>`);
  return parts.join('<span class="dot"></span>');
}
function rowHtml(d) {
  const st = d.status;
  const main = st === 'completed' ? (d.kind === 'gallery' ? ['folder'] : ['open', 'folder']) : st === 'seeding' ? ['folder'] : ['downloading', 'preparing', 'queued'].includes(st) ? ['pause'] : ['resume'];
  const btn = a => `<button class="ibtn" data-act="${a}" title="${esc(t(a === 'folder' ? 'open_folder' : a))}">${icon({ open: 'file', folder: 'folder', pause: 'pause', resume: 'play' }[a])}</button>`;
  return `
    <div class="ficon ${esc(d.category)}">${icon(CAT_ICON[d.category] || 'file')}</div>
    <div class="rmain">
      <div class="rname" title="${esc(d.filename)}">${esc(d.filename || d.url)}</div>
      ${st === 'completed' ? '' : progressHtml(d)}
      <div class="rmeta">${metaHtml(d)}</div>
    </div>
    <div class="rside"><span class="pill ${st}">${esc(t('st_' + st))}</span>${main.map(btn).join('')}</div>`;
}
function renderList() {
  const list = $('#list');
  const items = filtered();
  if (!items.length) {
    S.rows.clear(); S.sigs.clear();
    list.innerHTML = `<div class="empty"><div><div class="big"><svg viewBox="0 0 24 24"><path d="M14.3 0.8 4.6 12.6h6.3L9.6 20.2 19.4 8.4h-6.3L14.3 0.8ZM6.45 21.9h11.1a.65.65 0 0 1 0 1.3H6.45a.65.65 0 0 1 0-1.3Z"/></svg></div><h3>${esc(t('empty_title'))}</h3><p>${esc(t('empty_text'))}</p></div></div>`;
    return;
  }
  if (list.querySelector('.empty')) list.innerHTML = '';
  const keep = new Set(items.map(d => d.id));
  for (const [id, el] of S.rows) if (!keep.has(id)) { el.remove(); S.rows.delete(id); S.sigs.delete(id); }
  let prev = null;
  for (const d of items) {
    let el = S.rows.get(d.id);
    if (!el) { el = document.createElement('div'); el.className = 'row'; el.dataset.id = d.id; S.rows.set(d.id, el); }
    const html = rowHtml(d);
    if (S.sigs.get(d.id) !== html) { el.innerHTML = html; S.sigs.set(d.id, html); }
    el.classList.toggle('sel', S.selected.has(d.id));
    const want = prev ? prev.nextSibling : list.firstChild;
    if (want !== el) list.insertBefore(el, want);
    prev = el;
  }
}
const list = $('#list');
list.addEventListener('click', e => {
  const row = e.target.closest('.row'); if (!row) { if (!e.ctrlKey && !e.metaKey) { S.selected.clear(); renderAll(); } return; }
  const id = row.dataset.id;
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act) {
    if (act === 'open') openFile(id);
    else if (act === 'folder') api.reveal(id);
    else api.control(id, act);
    return;
  }
  const ids = filtered().map(d => d.id);
  const multi = e.ctrlKey || e.metaKey;
  if (e.shiftKey && S.anchor) {
    const a = ids.indexOf(S.anchor), b = ids.indexOf(id);
    if (!multi) S.selected.clear();
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) S.selected.add(ids[i]);
  } else if (multi) { S.selected.has(id) ? S.selected.delete(id) : S.selected.add(id); S.anchor = id; }
  else { S.selected = new Set([id]); S.anchor = id; }
  renderAll();
});
list.addEventListener('dblclick', e => {
  const row = e.target.closest('.row'); if (!row || e.target.closest('[data-act]')) return;
  const d = S.downloads.find(x => x.id === row.dataset.id);
  if (d?.status === 'completed') openFile(d.id);
  else if (d) api.control(d.id, ['downloading', 'preparing', 'queued'].includes(d.status) ? 'pause' : 'resume');
});
async function openFile(id) { const r = await api.open(id); if (r === 'missing') toast(t('file_missing'), true); }

/* ---------------- context menu ---------------- */
list.addEventListener('contextmenu', e => {
  const row = e.target.closest('.row'); if (!row) return;
  e.preventDefault();
  if (!S.selected.has(row.dataset.id)) { S.selected = new Set([row.dataset.id]); S.anchor = row.dataset.id; renderAll(); }
  const sel = selectedDownloads(); const one = sel.length === 1 ? sel[0] : null;
  const has = st => sel.some(d => st.includes(d.status));
  const items = [
    one?.status === 'completed' && ['open', 'file', () => openFile(one.id)],
    one && ['open_folder', 'folder', () => api.reveal(one.id)],
    '-',
    has(['paused', 'error', 'waiting']) && ['resume', 'play', () => api.bulk('resume', [...S.selected])],
    has(['downloading', 'preparing', 'queued']) && ['pause', 'pause', () => api.bulk('pause', [...S.selected])],
    has(['seeding']) && ['stop_seeding', 'pause', () => sel.forEach(d => api.control(d.id, 'stopSeeding'))],
    has(['paused', 'error', 'queued']) && ['later', 'later', () => sel.forEach(d => api.control(d.id, 'later'))],
    one && ['queued', 'waiting', 'paused'].includes(one.status) && ['move_up', 'up', () => api.control(one.id, 'up')],
    one && ['queued', 'waiting', 'paused'].includes(one.status) && ['move_down', 'dn', () => api.control(one.id, 'down')],
    '-',
    one && ['copy_link', 'copy', () => { api.copy(one.url); toast(t('copied')); }],
    one && one.kind === 'http' && ['paused', 'error'].includes(one.status) && ['refresh_link', 'link', () => promptRefresh(one)],
    one && one.kind === 'http' && ['paused', 'error', 'queued', 'waiting'].includes(one.status) && !one.downloaded && ['rename', 'edit', () => promptRename(one)],
    one && one.status !== 'completed' && ['speed_limit_item', 'gauge', () => promptLimit(one)],
    one && one.kind !== 'video' && ['restart', 'refresh', () => api.control(one.id, 'restart')],
    '-',
    ['remove', 'trash', () => confirmRemove([...S.selected])],
  ].filter(Boolean);
  showMenu(e.clientX, e.clientY, items);
});
function showMenu(x, y, items) {
  const ctx = $('#ctx');
  const clean = items.filter((it, i) => it !== '-' || (i > 0 && items[i - 1] !== '-' && i < items.length - 1));
  ctx.innerHTML = clean.map((it, i) => it === '-' ? '<hr>' : `<button data-i="${i}">${icon(it[1])}${esc(t(it[0]))}</button>`).join('');
  ctx.hidden = false;
  const r = ctx.getBoundingClientRect();
  ctx.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + 'px';
  ctx.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + 'px';
  ctx.onclick = ev => { const b = ev.target.closest('[data-i]'); if (!b) return; ctx.hidden = true; clean[b.dataset.i][2](); };
}
document.addEventListener('mousedown', e => { if (!e.target.closest('#ctx')) $('#ctx').hidden = true; });
addEventListener('blur', () => { $('#ctx').hidden = true; });

/* ---------------- details ---------------- */
function renderDetails() {
  const box = $('#details');
  const sel = selectedDownloads();
  if (sel.length !== 1) { box.hidden = true; box.dataset.id = ''; return; }
  const d = sel[0];
  box.hidden = false;
  const tabs = ['general', d.kind === 'http' && 'parts', d.kind === 'torrent' && 'files', d.kind === 'torrent' && 'peers'].filter(Boolean);
  if (!tabs.includes(S.detailsTab)) S.detailsTab = 'general';
  const head = `<div class="dtabs">${tabs.map(x => `<button class="dtab ${S.detailsTab === x ? 'on' : ''}" data-tab="${x}">${esc(t('d_' + x))}</button>`).join('')}<button class="ibtn x" data-close>${icon('close')}</button></div>`;
  let body = '';
  if (S.detailsTab === 'general') {
    body = `<dl class="kv">
      <dt>${esc(t('d_url'))}</dt><dd class="ltr"><span class="linkish" data-copy="${esc(d.url)}">${esc(d.url.length > 300 ? d.url.slice(0, 300) + '…' : d.url)}</span></dd>
      <dt>${esc(t('d_path'))}</dt><dd><span class="linkish" data-reveal>${esc(d.path || d.directory)}</span></dd>
      <dt>${esc(t('d_size'))}</dt><dd class="ltr">${d.total ? `${fmtSize(d.total)} (${d.total.toLocaleString('en')} B)` : esc(t('size_unknown'))}</dd>
      ${d.kind === 'http' ? `<dt>${esc(t('d_resume'))}</dt><dd>${esc(d.resumable === false ? t('d_no') : d.resumable ? t('d_yes') : '—')}</dd>` : ''}
      ${d.video ? `<dt>${esc(t('quality'))}</dt><dd>${esc(qualityLabel(d.video.quality))}</dd>` : ''}
      <dt>${esc(t('d_added'))}</dt><dd>${esc(fmtDate(d.createdAt))}</dd>
      ${d.completedAt ? `<dt>${esc(t('d_finished'))}</dt><dd>${esc(fmtDate(d.completedAt))}</dd>` : ''}
      ${d.status === 'completed' && d.kind !== 'torrent' ? `<dt>${esc(t('d_sha'))}</dt><dd class="ltr" id="sha">${d.sha256 ? esc(d.sha256) : `<button class="btn sm" data-sha>${esc(t('d_calc'))}</button>`}</dd>` : ''}
    </dl>`;
  } else if (S.detailsTab === 'parts') {
    const segs = d.segments || [];
    body = `<div class="segmap">${d.total ? segs.map(s => `<span class="seg" style="inset-inline-start:${(s.start / d.total * 100).toFixed(3)}%;width:${(Math.max(0, s.pos - s.start) / d.total * 100).toFixed(3)}%"></span>`).join('') : ''}</div>
      <div class="seglist">${segs.slice(0, 64).map((s, i) => `<div>#${i + 1} · ${fmtSize(s.pos - s.start)} / ${s.end != null ? fmtSize(s.end - s.start + 1) : '?'}</div>`).join('')}</div>`;
  } else if (S.detailsTab === 'files') {
    const prog = new Map((d.torrent?.fileProgress || []).map(f => [f.index, f]));
    body = `<table class="grid"><tr><th>#</th><th></th><th>${esc(t('d_size'))}</th><th></th></tr>${(d.torrent?.files || []).map(f => {
      const p = prog.get(f.index); const on = !d.torrent.selected || d.torrent.selected.includes(f.index);
      const pct = d.status === 'completed' && on ? 100 : p ? p.done / (p.length || 1) * 100 : 0;
      return `<tr style="${on ? '' : 'opacity:.45'}"><td>${f.index}</td><td style="unicode-bidi:plaintext">${esc(f.path)}</td><td class="num">${fmtSize(f.length)}</td><td><div class="mini"><i style="width:${pct.toFixed(1)}%"></i></div></td></tr>`;
    }).join('')}</table>`;
  } else if (S.detailsTab === 'peers') {
    const peers = d.torrent?.peers || [];
    body = peers.length ? `<table class="grid"><tr><th>IP</th><th>↓</th><th>↑</th><th></th></tr>${peers.map(p => `<tr><td class="num" style="text-align:start">${esc(p.ip)}:${esc(p.port)}</td><td class="num">${fmtSpeed(p.down)}</td><td class="num">${fmtSpeed(p.up)}</td><td>${p.seeder ? esc(t('seeds')) : ''}</td></tr>`).join('')}</table>` : `<div class="note">${esc(t('d_none_peers'))}</div>`;
  }
  const sig = S.detailsTab + JSON.stringify([d.id, d.status, d.downloaded, d.total, d.path, d.sha256, d.connections, S.settings.language, d.torrent?.peers?.length]);
  if (box.dataset.sig === sig) return;
  box.dataset.sig = sig; box.dataset.id = d.id;
  const scroll = $('.dbody', box)?.scrollTop || 0;
  box.innerHTML = head + `<div class="dbody">${body}</div>`;
  $('.dbody', box).scrollTop = scroll;
}
$('#details').addEventListener('click', async e => {
  const id = $('#details').dataset.id;
  const tab = e.target.closest('[data-tab]');
  if (tab) { S.detailsTab = tab.dataset.tab; renderDetails(); return; }
  if (e.target.closest('[data-close]')) { S.selected.clear(); renderAll(); return; }
  const c = e.target.closest('[data-copy]'); if (c) { api.copy(c.dataset.copy); toast(t('copied')); return; }
  if (e.target.closest('[data-reveal]')) { api.reveal(id); return; }
  if (e.target.closest('[data-sha]')) {
    $('#sha').innerHTML = '<span class="spinner"></span>';
    try { const h = await api.sha256(id); const d = S.downloads.find(x => x.id === id); if (d) d.sha256 = h; $('#sha').textContent = h; } catch (err) { $('#sha').textContent = String(err.message || err); }
  }
});
function qualityLabel(q) { if (!q) return ''; if (q === 'audio-mp3') return 'MP3'; if (q === 'audio-m4a') return 'M4A'; if (q === 'best') return 'Best'; return String(q).replace(/^h/, '') + 'p'; }

/* ---------------- side: speed meter + limit ---------------- */
function renderSide() {
  $('#total-speed').textContent = fmtSpeed(S.totalSpeed);
  const max = Math.max(...S.history, 1);
  const pts = S.history.map((v, i) => `${(i / (S.history.length - 1) * 120).toFixed(1)},${(27 - v / max * 24).toFixed(1)}`);
  $('#spark-path').setAttribute('d', `M0,28 L${pts.join(' L')} L120,28 Z`);
  const lim = S.settings.speedLimit;
  const chip = $('#limit-chip');
  chip.classList.toggle('on', Boolean(lim));
  chip.innerHTML = `${icon('gauge')}<span>${esc(t('limit'))}: <b class="ltr" style="direction:ltr;unicode-bidi:isolate">${lim ? fmtSpeed(lim * 1024) : esc(t('unlimited'))}</b></span>`;
}
setInterval(() => { S.history.push(S.totalSpeed); S.history.shift(); renderSide(); }, 1000);
$('#limit-chip').addEventListener('click', e => {
  const r = e.currentTarget.getBoundingClientRect();
  const set = v => () => saveSettings({ speedLimit: v });
  showMenu(r.left, r.top - 260, [
    ['unlimited', 'gauge', set(0)],
    ...[256, 512, 1024, 2048, 5120, 10240].map(v => [`${fmtSize(v * 1024)}/s`, 'gauge', set(v)]),
    '-',
    ['speed_limit_item', 'edit', () => promptValue(t('s_speed'), S.settings.speedLimit, v => saveSettings({ speedLimit: Number(v) || 0 }), 'number')],
  ]);
});

/* ---------------- render all ---------------- */
function renderAll() { renderNav(); renderToolbar(); renderList(); renderDetails(); renderSide(); }
let rafPending = false;
function scheduleRender() { if (rafPending) return; rafPending = true; requestAnimationFrame(() => { rafPending = false; renderAll(); }); }

/* ---------------- small dialogs ---------------- */
function modal(html, cls = '', onClose) {
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = `<div class="modal ${cls}">${html}</div>`;
  $('#modal-root').appendChild(ov);
  let closed = false;
  const close = () => { if (closed) return; closed = true; ov.remove(); document.removeEventListener('keydown', onKey); onClose?.(); };
  const onKey = e => { if (e.key === 'Escape' && $('#modal-root').lastElementChild === ov) close(); };
  document.addEventListener('keydown', onKey);
  ov.addEventListener('mousedown', e => { if (e.target === ov) close(); });
  return { el: ov.firstElementChild, close };
}
function confirmRemove(ids) {
  if (!ids.length) return;
  const anyFile = S.downloads.some(d => ids.includes(d.id) && (d.path || d.downloaded));
  const m = modal(`<div class="mhead"><h2>${esc(t('confirm_remove', { n: ids.length === 1 ? `"${S.downloads.find(d => d.id === ids[0])?.filename || ''}"` : t('n_items', { n: ids.length }) }))}</h2></div>
    <div class="mbody">${anyFile ? `<label class="chk"><input type="checkbox" id="delfile"> ${esc(t('also_delete'))}</label>` : ''}</div>
    <div class="mfoot"><span class="tb-grow"></span><button class="btn" data-x>${esc(t('cancel'))}</button><button class="btn danger" data-ok>${esc(t('remove_btn'))}</button></div>`, 'small');
  $('[data-x]', m.el).onclick = m.close;
  $('[data-ok]', m.el).onclick = async () => {
    const del = $('#delfile', m.el)?.checked;
    m.close();
    for (const id of ids) await api.control(id, 'remove', { deleteFile: del });
    ids.forEach(id => S.selected.delete(id));
  };
  $('[data-ok]', m.el).focus();
}
function promptValue(title, value, onOk, type = 'text') {
  const m = modal(`<div class="mhead"><h2>${esc(title)}</h2></div><div class="mbody"><input type="${type}" id="pv" style="width:100%" value="${esc(value ?? '')}"></div>
    <div class="mfoot"><span class="tb-grow"></span><button class="btn" data-x>${esc(t('cancel'))}</button><button class="btn primary" data-ok>${esc(t('ok'))}</button></div>`, 'small');
  const inp = $('#pv', m.el); inp.focus(); inp.select();
  const ok = () => { m.close(); onOk(inp.value); };
  $('[data-x]', m.el).onclick = m.close; $('[data-ok]', m.el).onclick = ok;
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') ok(); });
}
const promptRename = d => promptValue(t('rename'), d.filename, v => v.trim() && api.control(d.id, 'rename', { name: v.trim() }));
const promptRefresh = d => promptValue(t('new_link'), '', v => /^https?:\/\//.test(v.trim()) && api.control(d.id, 'refreshUrl', { url: v.trim() }));
const promptLimit = d => promptValue(`${t('speed_limit_item')} (${t('kbps')})`, d.speedLimit || 0, v => api.control(d.id, 'limit', { kbps: Number(v) || 0 }), 'number');

function toast(msg, err = false) {
  const el = document.createElement('div');
  el.className = 'toast' + (err ? ' err' : '');
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

/* ================= ADD DIALOG ================= */
let addDlg = null;
function openAdd({ urls = [], items = [], torrentFiles = [] } = {}) {
  if (addDlg) { addDlg.feed({ urls, items, torrentFiles }); return; }
  addDlg = new AddDialog();
  addDlg.feed({ urls, items, torrentFiles });
}
class AddDialog {
  constructor() {
    this.entries = []; this.folder = null; this.n = 0;
    const m = modal(`
      <div class="mhead">${icon('down')}<h2>${esc(t('add_title'))}</h2><button class="ibtn" data-x>${icon('close')}</button></div>
      <div class="mbody">
        <textarea class="links" id="links" spellcheck="false" placeholder="${esc(t('add_placeholder'))}"></textarea>
        <div style="display:flex;gap:8px;margin-top:8px"><button class="btn sm" data-torrent>${icon('magnet')}${esc(t('open_torrent'))}</button></div>
        <div class="items" id="items"></div>
      </div>
      <div class="mfoot">
        <div class="dest">${icon('folder')}<span>${esc(t('save_to'))}:</span><span class="path" id="dest">${esc(t('auto_folder'))}</span><button class="btn sm" data-folder>${esc(t('change'))}</button></div>
        <button class="btn" data-later>${icon('later')}${esc(t('download_later'))}</button>
        <button class="btn primary" data-start>${icon('down')}${esc(t('start_now'))}</button>
      </div>`, '', () => { for (const e of this.entries) if (e.metaKey) api.cancelTorrentInfo(e.metaKey); addDlg = null; });
    this.m = m; this.el = m.el;
    $('[data-x]', this.el).onclick = () => m.close();
    $('[data-torrent]', this.el).onclick = async () => { const files = await api.chooseTorrent(); this.feed({ torrentFiles: files }); };
    $('[data-folder]', this.el).onclick = async () => { const f = await api.chooseFolder(this.folder || S.settings.downloadDir); if (f) { this.folder = f; $('#dest', this.el).textContent = f; } };
    $('[data-start]', this.el).onclick = () => this.submit('now');
    $('[data-later]', this.el).onclick = () => this.submit('later');
    const ta = $('#links', this.el);
    let timer;
    ta.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => this.syncText(), 350); });
    $('#items', this.el).addEventListener('input', e => this.onItemInput(e));
    $('#items', this.el).addEventListener('change', e => this.onItemInput(e));
    $('#items', this.el).addEventListener('click', e => this.onItemClick(e));
    setTimeout(() => ta.focus(), 50);
    this.render();
  }

  feed({ urls = [], items = [], torrentFiles = [] }) {
    const ta = $('#links', this.el);
    if (urls.length) {
      const have = new Set(ta.value.split(/\s+/).filter(Boolean));
      const add = urls.filter(u => !have.has(u));
      if (add.length) ta.value = (ta.value.trim() ? ta.value.trim() + '\n' : '') + add.join('\n');
      this.syncText();
    }
    for (const it of items) this.addEntry({ url: it.url, captureId: it.captureId, from: 'browser', name: it.filename, size: it.size, hint: it.kind, hasCookies: it.hasCookies, pageTitle: it.pageTitle, preset: it.gallery });
    for (const f of torrentFiles) this.addEntry({ url: f, file: f, from: 'file' });
  }

  syncText() {
    const lines = [...new Set($('#links', this.el).value.split(/\s+/).map(s => s.trim()).filter(s => /^(https?|ftp|ftps|sftp|magnet):/i.test(s)))];
    const keep = new Set(lines);
    for (const e of this.entries.filter(e => e.from === 'text' && !keep.has(e.url))) this.removeEntry(e);
    for (const url of lines) if (!this.entries.some(e => e.url === url)) this.addEntry({ url, from: 'text' });
  }

  removeEntry(e) { if (e.metaKey) api.cancelTorrentInfo(e.metaKey); this.entries = this.entries.filter(x => x !== e); this.render(); }

  addEntry(src) {
    const e = { key: 'e' + (++this.n), status: 'checking', ...src };
    this.entries.push(e);
    this.render();
    this.check(e);
  }

  async check(e) {
    if (e.file) return this.loadTorrent(e, { file: e.file });
    const r = await api.inspect(e.url, e.captureId);
    if (!this.entries.includes(e)) return;
    if (!r.ok) {
      // A browser capture we can't look at (e.g. needs the page's sign-in): still allow it as a file.
      if (e.from === 'browser' && e.hint !== 'video') { Object.assign(e, { status: 'ready', kind: 'http', name: e.name || e.url.split('/').pop(), size: e.size }); }
      else Object.assign(e, { status: 'error', error: r.error });
      return this.render();
    }
    const info = r.info;
    e.kind = info.kind; e.info = info;
    if (info.kind === 'http') { e.name = info.name || e.name; e.size = info.size ?? e.size; e.category = info.category; e.status = 'ready'; }
    else if (info.kind === 'ftp') { e.name = info.name; e.status = 'ready'; }
    else if (info.kind === 'gallery') { e.name = info.name || info.url; e.status = 'ready'; e.posts = info.single ? 0 : (e.preset?.posts ?? S.settings.galleryPosts ?? 0); e.types = e.preset?.types || 'all'; e.category = 'images'; }
    else if (info.kind === 'video') {
      e.name = info.title; e.status = 'ready';
      e.quality = pickQuality(info.qualities, S.settings.videoQuality);
      e.subs = S.settings.subtitles;
    } else if (info.kind === 'playlist') {
      e.name = info.title; e.status = 'ready'; e.sel = new Set(info.entries.map((_, i) => i)); e.quality = String(S.settings.videoQuality);
    } else if (info.kind === 'torrent') {
      e.name = info.name; this.render();
      return this.loadTorrent(e, { url: e.url });
    }
    this.render();
  }

  async loadTorrent(e, src) {
    e.kind = 'torrent'; e.status = 'meta'; e.metaKey = e.key;
    this.render();
    const r = await api.torrentInfo(src, e.metaKey);
    e.metaKey = null;
    if (!this.entries.includes(e)) return;
    if (!r.ok) { if (r.error !== 'CANCELLED') Object.assign(e, { status: 'error', error: r.error }); this.render(); return; }
    e.torrent = r.info; e.name = r.info.name; e.size = r.info.total; e.status = 'ready';
    e.sel = new Set(r.info.files.map(f => f.index));
    if (e.file) e.url = 'file:' + e.file;
    this.render();
  }

  onItemInput(ev) {
    const box = ev.target.closest('[data-key]'); if (!box) return;
    const e = this.entries.find(x => x.key === box.dataset.key); if (!e) return;
    const f = ev.target.dataset.f;
    if (f === 'name') e.name = ev.target.value;
    if (f === 'quality') e.quality = ev.target.value;
    if (f === 'subs') e.subs = ev.target.checked;
    if (f === 'posts') e.posts = Number(ev.target.value) || 0;
    if (f === 'types') e.types = ev.target.value;
    if (f === 'sel') { const i = Number(ev.target.value); ev.target.checked ? e.sel.add(i) : e.sel.delete(i); this.renderEntrySummary(e, box); }
    this.updateButtons();
  }
  onItemClick(ev) {
    const box = ev.target.closest('[data-key]'); if (!box) return;
    const e = this.entries.find(x => x.key === box.dataset.key); if (!e) return;
    const a = ev.target.closest('[data-a]')?.dataset.a;
    if (a === 'all' || a === 'none') {
      const all = e.kind === 'playlist' ? e.info.entries.map((_, i) => i) : e.torrent.files.map(f => f.index);
      e.sel = new Set(a === 'all' ? all : []);
      this.render();
    }
    if (a === 'skip') { api.cancelTorrentInfo(e.metaKey); e.metaKey = null; e.status = 'ready'; e.skipMeta = true; this.render(); }
    if (a === 'rm') { this.removeEntry(e); const ta = $('#links', this.el); ta.value = ta.value.split('\n').filter(l => l.trim() !== e.url).join('\n'); }
    if (a === 'force') { e.force = true; e.duplicate = false; this.render(); }
  }

  entryHtml(e) {
    const kind = e.kind || (e.status === 'checking' ? null : 'http');
    const cat = e.kind === 'video' || e.kind === 'playlist' ? 'video' : e.kind === 'torrent' ? 'torrents' : e.kind === 'gallery' ? 'images' : e.category || 'other';
    let sub = '', opts = '';
    if (e.status === 'checking') {
      const tp = S.toolProgress;
      sub = tp ? `<span class="spinner"></span>${esc(t('ph_tool', { name: tp.name }))} <span class="ltr">${tp.total ? Math.round(tp.done / tp.total * 100) + '%' : fmtSize(tp.done)}</span>`
        : `<span class="spinner"></span>${esc(t('checking'))}`;
    }
    else if (e.status === 'error') sub = `<span class="badge err">${esc(t('err_link'))}</span><span>${esc(t('err_' + e.error) !== 'err_' + e.error ? t('err_' + e.error) : errText(e.error))}</span>`;
    else {
      sub = `<span class="badge ${kind}">${esc(t('k_' + kind))}</span>`;
      if (e.kind === 'gallery') sub += `<span>${esc(e.info.single ? t('g_one_post') : t('g_page'))}</span>` + (e.hasCookies || S.settings.cookiesBrowser ? '' : `<span class="note">${esc(t('g_login_hint'))}</span>`);
      if (e.kind === 'http') sub += `<span class="ltr">${e.size != null ? fmtSize(e.size) : esc(t('size_unknown'))}</span>${e.info ? `<span>${esc(e.info.resumable ? t('resumable') : t('not_resumable'))}</span>` : ''}`;
      if (e.kind === 'video') sub += `${e.info.uploader ? `<span>${esc(e.info.uploader)}</span>` : ''}${e.info.duration ? `<span class="ltr">${fmtEta(e.info.duration)}</span>` : ''}`;
      if (e.kind === 'playlist') sub += `<span class="sum">${esc(t('videos_selected', { n: e.sel.size }))}</span>`;
      if (e.kind === 'torrent' && e.torrent) sub += `<span class="sum ltr">${esc(this.torrentSummary(e))}</span>`;
      if (e.status === 'meta') sub += `<span class="spinner"></span><span>${esc(t('meta_wait'))}</span><span class="linkish" data-a="skip">${esc(t('meta_skip'))}</span>`;
      if (e.hasCookies) sub += `<span>· ${esc(t('with_cookies'))}</span>`;
      if (e.duplicate) sub += `<span class="badge err">${esc(t('duplicate'))}</span><span class="linkish" data-a="force">${esc(t('add_anyway'))}</span>`;
    }
    if (e.status === 'ready' && e.kind === 'gallery') {
      const sel = (f, cur, list) => `<select data-f="${f}">${list.map(([v, l]) => `<option value="${v}" ${String(cur) === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
      opts = (e.info.single ? '' : `<label>${esc(t('g_posts'))} ${sel('posts', e.posts, [[0, t('g_all')], [12, '12'], [30, '30'], [100, '100'], [500, '500']])}</label>`) +
        `<label>${esc(t('g_types'))} ${sel('types', e.types, [['all', t('g_both')], ['images', t('g_images')], ['videos', t('g_videos')]])}</label>`;
    }
    if (e.status === 'ready' && e.kind === 'video') {
      opts = `<label>${esc(t('quality'))} <select data-f="quality">${e.info.qualities.map(q => `<option value="${esc(q.id)}" ${q.id === e.quality ? 'selected' : ''}>${esc(q.label)}${q.size ? ' · ' + fmtSize(q.size) : ''}</option>`).join('')}</select></label>
        ${e.info.subtitles?.length ? `<label class="chk"><input type="checkbox" data-f="subs" ${e.subs ? 'checked' : ''}> ${esc(t('subtitles'))}</label>` : ''}`;
    }
    if (e.status === 'ready' && e.kind === 'playlist') {
      opts = `<label>${esc(t('quality'))} <select data-f="quality">${['2160', '1440', '1080', '720', '480', '360', 'audio-m4a', 'audio-mp3'].map(q => `<option value="${q}" ${q === e.quality ? 'selected' : ''}>${esc(qualityLabel(q.startsWith('audio') ? q : 'h' + q))}</option>`).join('')}</select></label>
        <span class="linkish" data-a="all">${esc(t('select_all'))}</span><span class="linkish" data-a="none">${esc(t('select_none'))}</span>
        <div class="filelist" style="width:100%">${e.info.entries.map((v, i) => `<label><input type="checkbox" data-f="sel" value="${i}" ${e.sel.has(i) ? 'checked' : ''}><span class="fn">${esc(v.title)}</span><span class="fs">${v.duration ? fmtEta(v.duration) : ''}</span></label>`).join('')}</div>`;
    }
    if (e.status === 'ready' && e.kind === 'torrent' && e.torrent && e.torrent.files.length > 1) {
      opts = `<span class="linkish" data-a="all">${esc(t('select_all'))}</span><span class="linkish" data-a="none">${esc(t('select_none'))}</span>
        <div class="filelist" style="width:100%">${e.torrent.files.map(f => `<label><input type="checkbox" data-f="sel" value="${f.index}" ${e.sel.has(f.index) ? 'checked' : ''}><span class="fn">${esc(f.path.split('/').slice(1).join('/') || f.path)}</span><span class="fs">${fmtSize(f.length)}</span></label>`).join('')}</div>`;
    }
    const thumb = e.kind === 'video' && e.info?.thumbnail ? `<img class="thumb" src="${esc(e.info.thumbnail)}" alt="">` : `<div class="ficon ${cat}">${icon(CAT_ICON[cat] || 'file')}</div>`;
    const editable = e.status === 'ready' && ['http', 'ftp'].includes(e.kind);
    return `<div class="item" data-key="${e.key}">
      <div class="item-top">${thumb}
        <div class="item-name">${editable ? `<input data-f="name" value="${esc(e.name || '')}">` : `<input value="${esc(e.name || e.url)}" readonly tabindex="-1">`}
          <div class="item-sub">${sub}</div></div>
        <button class="ibtn" data-a="rm">${icon('close')}</button>
      </div>${opts ? `<div class="item-opts">${opts}</div>` : ''}</div>`;
  }
  torrentSummary(e) {
    const files = e.torrent.files.filter(f => e.sel.has(f.index));
    return t('files_selected', { n: files.length, size: fmtSize(files.reduce((n, f) => n + f.length, 0)) });
  }
  renderEntrySummary(e, box) {
    const s = $('.sum', box);
    if (s) s.textContent = e.kind === 'playlist' ? t('videos_selected', { n: e.sel.size }) : this.torrentSummary(e);
  }
  render() {
    const box = $('#items', this.el);
    const focused = document.activeElement?.closest?.('[data-key]')?.dataset.key;
    if (focused && document.activeElement.dataset.f === 'name') { this.updateButtons(); return this.renderSoon(); }
    box.innerHTML = this.entries.map(e => this.entryHtml(e)).join('');
    this.updateButtons();
  }
  renderSoon() { clearTimeout(this.rt); this.rt = setTimeout(() => { if (document.activeElement?.dataset?.f === 'name') return this.renderSoon(); this.render(); }, 600); }
  updateButtons() {
    const ok = this.entries.some(e => this.usable(e));
    $('[data-start]', this.el).disabled = !ok;
    $('[data-later]', this.el).disabled = !ok;
  }
  usable(e) {
    if (e.duplicate && !e.force) return false;
    if (e.status === 'meta') return false;
    if (e.status !== 'ready') return false;
    if ((e.kind === 'playlist' || (e.kind === 'torrent' && e.torrent)) && !e.sel.size) return false;
    return true;
  }
  async submit(start) {
    const items = [];
    const dir = this.folder || undefined;
    const used = this.entries.filter(e => this.usable(e));
    for (const e of used) {
      const base = { start, directory: dir, captureId: e.captureId, force: e.force };
      if (e.kind === 'http') items.push({ ...base, key: e.key, url: e.url, kind: 'http', filename: e.name, size: e.size, category: e.category });
      else if (e.kind === 'ftp') items.push({ ...base, key: e.key, url: e.url, kind: 'ftp', filename: e.name });
      else if (e.kind === 'gallery') items.push({ ...base, key: e.key, url: e.url, kind: 'gallery', filename: e.name, gallery: { posts: e.posts, types: e.types } });
      else if (e.kind === 'video') {
        const q = e.info.qualities.find(x => x.id === e.quality);
        items.push({ ...base, key: e.key, url: e.url, kind: 'video', filename: e.name, size: q?.size || null, video: { quality: e.quality, title: e.name, subtitles: e.subs ? S.settings.subtitleLangs.split(/[,\s]+/).filter(Boolean) : [] } });
      } else if (e.kind === 'playlist') {
        const quality = e.quality.startsWith('audio') ? e.quality : 'h' + e.quality;
        e.info.entries.forEach((v, i) => { if (e.sel.has(i) && v.url) items.push({ ...base, key: e.key, url: v.url, kind: 'video', filename: v.title, video: { quality, title: v.title } }); });
      } else if (e.kind === 'torrent') {
        if (e.torrent) items.push({ ...base, key: e.key, url: e.file ? `torrent:${e.torrent.infoHash}` : e.url, kind: 'torrent', size: this.selectedSize(e), torrent: { base64: e.torrent.base64, selected: e.sel.size === e.torrent.files.length ? null : [...e.sel].sort((a, b) => a - b), name: e.torrent.name } });
        else items.push({ ...base, key: e.key, url: e.url, kind: 'torrent' });
      }
    }
    const res = await api.add(items);
    let dup = 0;
    res.forEach((r, i) => {
      const e = this.entries.find(x => x.key === items[i].key);
      if (r.duplicate) { dup++; if (e) e.duplicate = true; } else if (e) e.added = true;
    });
    const n = res.filter(r => !r.duplicate).length;
    if (n) toast(t('added', { n }));
    if (!dup) { this.m.close(); return; }
    this.entries = this.entries.filter(e => !e.added || e.duplicate);
    this.render();
  }
  selectedSize(e) { return e.torrent.files.filter(f => e.sel.has(f.index)).reduce((n, f) => n + f.length, 0); }
}
function pickQuality(qs, pref) {
  const want = Number(pref) || 1080;
  const vids = qs.filter(q => q.height);
  return (vids.find(q => q.height <= want) || vids[vids.length - 1] || qs[0])?.id;
}

/* ================= SETTINGS ================= */
const STABS = [['general', 'sliders'], ['downloads', 'down'], ['video', 'video'], ['torrent', 'magnet'], ['connection', 'wifi'], ['schedule', 'clock'], ['browser', 'puzzle'], ['about', 'info']];
async function saveSettings(patch, quiet = true) {
  const s = await api.setSettings(patch);
  const langChanged = 'language' in patch && patch.language !== S.settings.language;
  S.settings = { ...S.settings, ...s };
  if ('theme' in patch) applyTheme();
  if (langChanged) { applyLang(); S.sigs.clear(); $('#details').dataset.sig = ''; }
  renderAll();
  if (!quiet) toast(t('saved'));
  return langChanged;
}
function openSettings(tab = 'general') {
  const m = modal(`<div class="mhead">${icon('sliders')}<h2>${esc(t('settings'))}</h2><button class="ibtn" data-x>${icon('close')}</button></div><div class="settings"><div class="stabs"></div><div class="spane"></div></div>`, 'wide');
  $('[data-x]', m.el).onclick = m.close;
  let cur = tab;
  const drawTabs = () => { $('.stabs', m.el).innerHTML = STABS.map(([id, ic]) => `<button class="stab ${cur === id ? 'on' : ''}" data-s="${id}">${icon(ic)}${esc(t('s_' + id))}</button>`).join(''); $('.mhead h2', m.el).textContent = t('settings'); };
  const draw = async () => { drawTabs(); const pane = $('.spane', m.el); pane.innerHTML = await settingsPane(cur); pane.scrollTop = 0; };
  $('.stabs', m.el).onclick = e => { const b = e.target.closest('[data-s]'); if (b) { cur = b.dataset.s; draw(); } };
  const pane = $('.spane', m.el);
  const onChange = async e => {
    const el = e.target; const k = el.dataset.k; if (!k) return;
    let v = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value;
    if (k.startsWith('sched.')) {
      const s = { ...S.settings.scheduler };
      const key = k.slice(6);
      if (key === 'day') { const d = Number(el.value); s.days = el.checked ? [...new Set([...s.days, d])] : s.days.filter(x => x !== d); }
      else s[key] = v;
      await saveSettings({ scheduler: s });
      return;
    }
    const langChanged = await saveSettings({ [k]: v });
    if (langChanged) draw();
  };
  pane.addEventListener('change', onChange);
  pane.addEventListener('click', async e => {
    const b = e.target.closest('[data-do]'); if (!b) return;
    const what = b.dataset.do;
    if (what === 'seg') { const langChanged = await saveSettings({ [b.dataset.k]: b.dataset.v }); langChanged ? draw() : draw(); }
    if (what === 'folder') { const f = await api.chooseFolder(S.settings.downloadDir); if (f) { await saveSettings({ downloadDir: f }); draw(); } }
    if (what === 'openfolder') api.openFolder();
    if (what === 'tool') {
      b.disabled = true; b.innerHTML = '<span class="spinner"></span>';
      try { await api.updateTool(b.dataset.tool); } catch (err) { toast(String(err.message || err), true); }
      draw();
    }
    if (what === 'ext') api.openExtensionFolder();
    if (what === 'relink') { await api.bridgeRetry(); draw(); }
    if (what === 'forget') { await api.forgetBrowser(b.dataset.id); draw(); }
    if (what === 'magnet') { await api.setMagnetDefault(); toast(t('saved')); }
    if (what === 'link') api.openExternal(b.dataset.url);
  });
  draw();
}
const sw = (k, on) => `<label class="switch"><input type="checkbox" data-k="${k}" ${on ? 'checked' : ''}><span></span></label>`;
const segc = (k, cur, opts) => `<div class="seg-ctl">${opts.map(([v, l]) => `<button data-do="seg" data-k="${k}" data-v="${v}" class="${String(cur) === String(v) ? 'on' : ''}">${esc(l)}</button>`).join('')}</div>`;
const field = (label, ctl, hint = '') => `<div class="field"><div class="lbl">${esc(label)}${hint ? `<div class="hint">${esc(hint)}</div>` : ''}</div>${ctl}</div>`;
async function settingsPane(tab) {
  const s = S.settings;
  switch (tab) {
    case 'general': return [
      field(t('s_language'), segc('language', s.language, [['ar', 'العربية'], ['ckb', 'کوردی'], ['en', 'English']])),
      field(t('s_theme'), segc('theme', s.theme, [['system', t('th_system')], ['light', t('th_light')], ['dark', t('th_dark')]])),
      field(t('s_tray'), sw('minimizeToTray', s.minimizeToTray)),
      field(t(api.platform === 'darwin' ? 's_startup_mac' : 's_startup'), sw('startWithWindows', s.startWithWindows)),
      field(t('s_clipboard'), sw('clipboardMonitor', s.clipboardMonitor)),
      field(t('s_notify'), sw('notifyOnComplete', s.notifyOnComplete)),
      field(t('s_openfolder'), sw('openFolderOnComplete', s.openFolderOnComplete)),
      field(t('s_resume_start'), sw('resumeOnStart', s.resumeOnStart)),
    ].join('');
    case 'downloads': return [
      field(t('s_folder'), `<div style="display:flex;gap:8px;align-items:center;min-width:0"><span class="code" style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.downloadDir)}</span><button class="btn sm" data-do="folder">${esc(t('change'))}</button><button class="btn sm" data-do="openfolder">${icon('folder')}</button></div>`),
      field(t('s_catfolders'), sw('categoryFolders', s.categoryFolders)),
      field(t('s_concurrent'), `<input type="number" min="1" max="16" data-k="maxConcurrent" value="${s.maxConcurrent}">`),
      field(t('s_connections'), `<input type="number" min="1" max="32" data-k="connections" value="${s.connections}">`),
      field(t('s_speed'), `<input type="number" min="0" data-k="speedLimit" value="${s.speedLimit}">`),
      field(t('s_after'), `<select data-k="afterAllDone">${['none', 'shutdown', 'sleep', 'quit'].map(a => `<option value="${a}" ${s.afterAllDone === a ? 'selected' : ''}>${esc(t('a_' + a))}</option>`).join('')}</select>`),
    ].join('');
    case 'video': {
      const st = await api.toolsStatus();
      const tool = (name, desc) => `<div class="tool"><div style="flex:1"><div class="tname">${name}${name === 'yt-dlp' && st.ytdlpVersion ? ` <span class="tdesc">${esc(st.ytdlpVersion)}</span>` : ''}</div><div class="tdesc">${esc(t(desc))}</div></div>
        <span class="tstate ${st[name] ? 'ok' : 'no'}">${esc(st[name] ? t('tool_ok') : t('tool_missing'))}</span>
        ${name === 'gallery-dl' ? '' : `<button class="btn sm" data-do="tool" data-tool="${name}">${esc(st[name] ? t('tool_update') : t('tool_install'))}</button>`}</div>`;
      return [
        field(t('s_vquality'), `<select data-k="videoQuality">${['2160', '1440', '1080', '720', '480', '360'].map(q => `<option value="${q}" ${String(s.videoQuality) === q ? 'selected' : ''}>${q}p</option>`).join('')}</select>`),
        field(t('s_subs'), sw('subtitles', s.subtitles)),
        field(t('s_sublangs'), `<input type="text" data-k="subtitleLangs" value="${esc(s.subtitleLangs)}" style="min-width:140px;direction:ltr">`),
        `<div class="field col"><div class="lbl"><b>${esc(t('s_tools'))}</b></div>${tool('yt-dlp', 'tool_desc_ytdlp')}${tool('ffmpeg', 'tool_desc_ffmpeg')}${tool('deno', 'tool_desc_deno')}${tool('gallery-dl', 'tool_desc_gallerydl')}${tool('aria2c', 'tool_desc_aria2c')}</div>`,
        field(t('s_signin'), `<select data-k="cookiesBrowser">${[['', t('s_signin_none')], ['firefox', 'Firefox'], ['chrome', 'Chrome'], ['edge', 'Edge'], ['brave', 'Brave'], ['opera', 'Opera'], ...(api.platform === 'darwin' ? [['safari', 'Safari']] : [])].map(([v, l]) => `<option value="${v}" ${s.cookiesBrowser === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`, t('s_signin_hint')),
      ].join('');
    }
    case 'torrent': return [
      field(t('s_seed'), `<input type="number" min="0" max="20" step="0.1" data-k="seedRatio" value="${s.seedRatio}">`),
      field(t('s_upload'), `<input type="number" min="0" data-k="uploadLimit" value="${s.uploadLimit}">`),
      field(t('s_trackers'), sw('extraTrackers', s.extraTrackers)),
      field(t('s_magnet'), `<button class="btn sm" data-do="magnet">${esc(t('s_set_default'))}</button>`),
    ].join('');
    case 'connection': return field(t('s_proxy'), `<input type="text" data-k="proxy" value="${esc(s.proxy)}" placeholder="http://host:port" style="direction:ltr">`, t('s_proxy_hint'));
    case 'schedule': {
      const sc = s.scheduler;
      return [
        field(t('s_sched_on'), `<label class="switch"><input type="checkbox" data-k="sched.enabled" ${sc.enabled ? 'checked' : ''}><span></span></label>`, t('s_sched_hint')),
        field(t('s_sched_start'), `<input type="time" data-k="sched.start" value="${esc(sc.start)}">`),
        field(t('s_sched_stop'), `<input type="time" data-k="sched.stop" value="${esc(sc.stop)}">`),
        `<div class="field col"><div class="lbl">${esc(t('s_days'))}</div><div class="days">${t('days').map((d, i) => `<label><input type="checkbox" data-k="sched.day" value="${i}" ${sc.days.includes(i) ? 'checked' : ''}><span>${esc(d)}</span></label>`).join('')}</div></div>`,
        field(t('s_after'), `<select data-k="afterAllDone">${['none', 'shutdown', 'sleep', 'quit'].map(a => `<option value="${a}" ${s.afterAllDone === a ? 'selected' : ''}>${esc(t('a_' + a))}</option>`).join('')}</select>`),
      ].join('');
    }
    case 'browser': {
      const b = await api.browsers();
      const bs = await api.bridgeStatus();
      const link = bs.port
        ? `<div class="field"><div class="lbl">${esc(t('s_link'))}</div><span class="pill completed">${esc(t('s_link_ok'))} · <span class="ltr">${bs.port}</span></span></div>`
        : `<div class="field"><div class="lbl">${esc(t('s_link'))}<div class="hint ltr">${esc(bs.error || '')}</div></div><span class="pill error">${esc(t('s_link_bad'))}</span><button class="btn sm" data-do="relink">${esc(t('s_link_retry'))}</button></div>`;
      return link + `<div class="field col"><div class="lbl"><b>${esc(t('s_ext_title'))}</b></div>
          <ol class="steps">${t('s_ext_steps').map(x => `<li>${esc(x).replace(/(chrome|edge):\/\/extensions/g, '<span class="code">$&</span>')}</li>`).join('')}</ol>
          <div><button class="btn primary" data-do="ext">${icon('folder')}${esc(t('s_ext_open'))}</button></div></div>
        <div class="field col"><div class="lbl"><b>${esc(t('s_paired'))}</b></div>
          ${b.length ? b.map(x => `<div class="tool"><div style="flex:1"><div class="tname" style="direction:inherit">${esc(x.name)}</div><div class="tdesc">${esc(fmtDate(x.at))}</div></div><button class="btn sm" data-do="forget" data-id="${esc(x.id)}">${esc(t('s_forget'))}</button></div>`).join('') : `<div class="note">${esc(t('s_none_paired'))}</div>`}</div>
        <div class="field col"><div class="lbl">${esc(t('s_capture'))}</div><input type="text" data-k="captureTypes" value="${esc(s.captureTypes)}" style="direction:ltr;width:100%"></div>
        ${field(t('s_minsize'), `<input type="number" min="0" data-k="captureMinSizeKB" value="${s.captureMinSizeKB}">`)}`;
    }
    case 'about': return `<div class="about"><svg class="bolt" viewBox="0 0 24 24"><path d="M14.3 0.8 4.6 12.6h6.3L9.6 20.2 19.4 8.4h-6.3L14.3 0.8ZM6.45 21.9h11.1a.65.65 0 0 1 0 1.3H6.45a.65.65 0 0 1 0-1.3Z"/></svg>
      <h3>${esc(t('app'))} <span class="tdesc ltr">v${esc(s.version)}</span></h3><p class="note">${esc(t('s_about_text'))}</p>
      <p class="note">yt-dlp · FFmpeg · aria2 · Deno · Electron</p>
      <p><button class="btn sm" data-do="link" data-url="https://dlwjan11-dot.github.io/brusk/">${icon('globe')}dlwjan11-dot.github.io/brusk</button></p></div>`;
  }
  return '';
}

/* ================= events from the app ================= */
api.on('state', snap => {
  S.downloads = snap.downloads; S.totalSpeed = snap.totalSpeed; S.toolProgress = snap.toolProgress;
  for (const id of [...S.selected]) if (!S.downloads.some(d => d.id === id)) S.selected.delete(id);
  if (addDlg && (snap.toolProgress || addDlg.showedTool) && addDlg.entries.some(e => e.status === 'checking')) { addDlg.showedTool = Boolean(snap.toolProgress); addDlg.render(); }
  scheduleRender();
});
api.on('open-add', data => openAdd(data));
api.on('open-settings', () => { if (!document.querySelector('.settings')) openSettings(); });
api.on('completed', d => { if (document.hasFocus()) toast(t('completed_toast', { name: d.filename })); });
api.on('failed', d => toast(t('failed_toast', { name: d.filename || d.url }), true));
api.on('schedule', w => toast(t(w === 'start' ? 'sched_started' : 'sched_stopped')));
api.on('all-done', ({ action, seconds }) => {
  let left = seconds;
  const label = t('a_' + action);
  const m = modal(`<div class="mhead">${icon('check')}<h2>${esc(t('all_done_title'))}</h2></div>
    <div class="mbody"><div class="countdown" id="cd">${left}</div><p class="note" style="text-align:center" id="cdt"></p></div>
    <div class="mfoot"><span class="tb-grow"></span><button class="btn" data-x>${esc(t('cancel'))}</button><button class="btn primary" data-now>${esc(t('do_now'))}</button></div>`, 'small');
  const tick = () => { $('#cd', m.el).textContent = left; $('#cdt', m.el).textContent = t('all_done_text', { action: label, s: left }); };
  tick();
  const iv = setInterval(() => { left--; if (left <= 0) { clearInterval(iv); m.close(); } else tick(); }, 1000);
  $('[data-x]', m.el).onclick = () => { clearInterval(iv); api.cancelAfter(); m.close(); };
  $('[data-now]', m.el).onclick = () => { clearInterval(iv); api.afterNow(action); m.close(); };
});

/* ================= keyboard, paste, drop ================= */
document.addEventListener('keydown', e => {
  if (e.target.matches('input, textarea, select') || $('#modal-root').children.length) return;
  if ((e.key === 'Delete' || (e.key === 'Backspace' && e.metaKey)) && S.selected.size) confirmRemove([...S.selected]);
  const mod = e.ctrlKey || e.metaKey;
  if (e.key === 'a' && mod) { e.preventDefault(); S.selected = new Set(filtered().map(d => d.id)); renderAll(); }
  if (e.key === 'n' && mod) { e.preventDefault(); openAdd(); }
  if (e.key === 'Enter' && S.selected.size === 1) { const d = selectedDownloads()[0]; if (d.status === 'completed') openFile(d.id); }
  if (e.key === ' ' && S.selected.size) { e.preventDefault(); const sel = selectedDownloads(); const run = sel.some(d => ['downloading', 'preparing', 'queued'].includes(d.status)); api.bulk(run ? 'pause' : 'resume', [...S.selected]); }
  if (e.key === 'f' && mod) { e.preventDefault(); $('#search').focus(); }
});
document.addEventListener('paste', e => {
  if (e.target.matches('input, textarea') || $('#modal-root').children.length) return;
  const text = e.clipboardData.getData('text');
  const urls = text.split(/\s+/).filter(s => /^(https?|ftp|magnet):/i.test(s));
  if (urls.length) openAdd({ urls });
});
let dragDepth = 0;
addEventListener('dragenter', e => { e.preventDefault(); dragDepth++; $('#drop').hidden = false; });
addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('#drop').hidden = true; } });
addEventListener('dragover', e => e.preventDefault());
addEventListener('drop', e => {
  e.preventDefault(); dragDepth = 0; $('#drop').hidden = true;
  const files = [...e.dataTransfer.files].map(f => api.filePath(f)).filter(p => /\.torrent$/i.test(p));
  const text = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
  const urls = (text || '').split(/\s+/).filter(s => /^(https?|ftp|magnet):/i.test(s));
  if (files.length || urls.length) openAdd({ urls, torrentFiles: files });
});
$('#search').addEventListener('input', e => { S.search = e.target.value; renderAll(); });
$('#btn-add').onclick = () => openAdd();
$('#btn-settings').onclick = () => openSettings();

/* ================= start ================= */
(async () => {
  if (api.platform === 'darwin') document.documentElement.classList.add('mac');
  S.settings = await api.getSettings();
  applyTheme(); applyLang();
  const snap = await api.state();
  S.downloads = snap.downloads; S.totalSpeed = snap.totalSpeed;
  renderAll();
})();
