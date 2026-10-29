'use strict';
/* Barq: a small "Download" button over videos on the page. */
(() => {
  if (window.__barqContent) return;
  window.__barqContent = true;
  const ar = /^ar/.test(navigator.language || '') || document.documentElement.lang?.startsWith('ar');
  const LABEL = ar ? 'تحميل بـ برق' : 'Download with Barq';

  let host = null, btn = null, current = null, hideTimer = null;

  function makeButton() {
    host = document.createElement('div');
    host.style.cssText = 'position:fixed;z-index:2147483647;top:0;left:0;display:none;';
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `<style>
      button{all:initial;display:flex;align-items:center;gap:6px;cursor:pointer;font:600 12.5px/1 "Segoe UI",Tahoma,sans-serif;color:#fff;
        background:linear-gradient(180deg,#3b78ff,#1d55e0);padding:7px 11px 7px 9px;border-radius:9px;box-shadow:0 4px 14px rgba(0,0,0,.35);direction:${ar ? 'rtl' : 'ltr'}}
      button:hover{filter:brightness(1.08)} svg{width:15px;height:15px;fill:#ffc414}
      .x{all:initial;cursor:pointer;color:#fff;opacity:.7;font:14px/1 sans-serif;padding:0 2px 0 4px} .x:hover{opacity:1}
      .ok{background:linear-gradient(180deg,#22b06b,#178a52)}</style>
      <button part="b"><svg viewBox="0 0 24 24"><path d="M13.2 2 4.5 13.4h6.1L9.8 22l8.7-11.4h-6.1L13.2 2Z"/></svg><span>${LABEL}</span><span class="x" title="×">×</span></button>`;
    btn = root.querySelector('button');
    btn.addEventListener('mouseenter', () => clearTimeout(hideTimer));
    btn.addEventListener('mouseleave', scheduleHide);
    btn.addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation();
      if (e.composedPath()[0]?.classList?.contains('x')) { host.style.display = 'none'; current = null; return; }
      const src = current?.currentSrc || current?.src || '';
      const direct = /^https?:/.test(src) && !/blob:/.test(src) ? src : null;
      const msg = direct && !/youtube|vimeo|dailymotion|twitch|tiktok|facebook|instagram/.test(location.hostname)
        ? { type: 'send', items: [{ url: direct, referrer: location.href, pageUrl: location.href, pageTitle: document.title }] }
        : { type: 'page-video', pageUrl: location.href, title: document.title };
      send(msg);
    }, true);
    (document.body || document.documentElement).appendChild(host);
  }

  // Always show what happened: a silent failure looks like "nothing works".
  function send(msg) {
    const span = btn.querySelector('span');
    let finished = false;
    const finish = (text, ok) => {
      if (finished) return; finished = true; clearTimeout(timer);
      btn.classList.toggle('ok', Boolean(ok)); span.textContent = text;
      clearTimeout(hideTimer);
      setTimeout(() => { btn.classList.remove('ok'); span.textContent = LABEL; scheduleHide(); }, ok ? 2500 : 6000);
    };
    const why = code => ({
      'not-running': ar ? 'برنامج برق مو مفتوح' : 'Barq is not running',
      'not-paired': ar ? 'اربط الإضافة ببرق أولاً (من أيقونة برق)' : 'Connect the extension first (Barq icon)',
    }[code] || (/context invalidated|receiving end|Could not establish/i.test(code || '') ? (ar ? 'أعد تحميل الصفحة (F5) وجرّب' : 'Reload the page (F5) and try again') : `${ar ? 'تعذّر الإرسال' : 'Could not send'}: ${code || '?'}`));
    span.textContent = ar ? 'جاري الإرسال…' : 'Sending…';
    const timer = setTimeout(() => finish(why('Could not establish connection')), 10000);
    try {
      chrome.runtime.sendMessage(msg, r => {
        const err = chrome.runtime.lastError;
        if (err) return finish(why(err.message));
        if (r?.ok) finish(ar ? 'أُرسل إلى برق ✓' : 'Sent to Barq ✓', true);
        else finish(why(r?.error));
      });
    } catch (e) { finish(why(e.message)); }
  }

  function place(v) {
    const r = v.getBoundingClientRect();
    if (r.width < 220 || r.height < 120 || r.bottom < 0 || r.top > innerHeight) { host.style.display = 'none'; return; }
    host.style.display = 'block';
    const w = host.offsetWidth || 150;
    const x = ar ? Math.max(4, r.left + 10) : Math.min(innerWidth - w - 6, r.right - w - 10);
    host.style.transform = `translate(${Math.round(x)}px, ${Math.round(Math.max(4, r.top + 10))}px)`;
  }
  function scheduleHide() { clearTimeout(hideTimer); hideTimer = setTimeout(() => { if (host) host.style.display = 'none'; current = null; }, 2200); }

  document.addEventListener('mouseover', e => {
    if (host && e.target === host) { clearTimeout(hideTimer); return; }
    const v = e.target.closest?.('video') || findVideoUnder(e);
    if (!v) return;
    if (!host) makeButton();
    current = v; place(v); clearTimeout(hideTimer); scheduleHide();
  }, true);
  addEventListener('scroll', () => { if (current && host?.style.display === 'block') place(current); }, { passive: true, capture: true });

  // Many players cover the <video> with their own layer; look under the mouse.
  let lastCheck = 0;
  function findVideoUnder(e) {
    if (Date.now() - lastCheck < 250) return null;
    lastCheck = Date.now();
    for (const v of document.querySelectorAll('video')) {
      const r = v.getBoundingClientRect();
      if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) return v;
    }
    return null;
  }

  chrome.runtime.onMessage.addListener((msg, _s, reply) => {
    if (msg.type === 'barq-selection') {
      const sel = getSelection();
      const urls = new Set();
      if (sel && sel.rangeCount) {
        for (let i = 0; i < sel.rangeCount; i++) {
          const frag = sel.getRangeAt(i).cloneContents();
          frag.querySelectorAll?.('a[href]').forEach(a => { try { urls.add(new URL(a.getAttribute('href'), location.href).href); } catch {} });
        }
        (sel.toString().match(/(https?|ftp|magnet):[^\s"'<>]+/g) || []).forEach(u => urls.add(u));
        for (const a of document.querySelectorAll('a[href]')) if (sel.containsNode(a, true)) urls.add(a.href);
      }
      reply([...urls].filter(u => /^(https?|ftp|magnet):/.test(u)));
    }
    return false;
  });
})();
