'use strict';
const T = {
  ar: {
    title: 'بروسك', ok: 'متصل', off: 'غير مفتوح', warn: 'غير مربوط',
    off_text: 'افتح برنامج بروسك على الكمبيوتر، ثم أعد فتح هذه النافذة.',
    pair_text: 'اربط الإضافة ببرنامج بروسك مرة وحدة، وبعدها كل التحميلات بتروح لبروسك.', pair: 'ربط', pairing: 'وافق على الطلب بنافذة بروسك…', denied: 'تم رفض الربط',
    capture: 'التقاط التحميلات من المتصفح', capture_hint: 'الملفات بالأنواع المحددة بإعدادات بروسك',
    page_video: 'تحميل فيديو هذه الصفحة', sent: 'أُرسل إلى بروسك ✓', found: 'ملفات وسائط بهذه الصفحة', none: 'ما لقينا فيديو بهذه الصفحة بعد. شغّل الفيديو وارجع.', get: 'تحميل', stream: 'بث',
  },
  en: {
    title: 'Brusk', ok: 'Connected', off: 'Not running', warn: 'Not connected',
    off_text: 'Open the Brusk app on this computer, then open this window again.',
    pair_text: 'Connect the extension to Brusk once; after that your downloads go to Brusk.', pair: 'Connect', pairing: 'Allow the request in the Brusk window…', denied: 'Connection was refused',
    capture: 'Take over browser downloads', capture_hint: 'Files of the types set in Brusk settings',
    page_video: "Download this page's video", sent: 'Sent to Brusk ✓', found: 'Media on this page', none: 'No video found on this page yet. Play the video and come back.', get: 'Get', stream: 'stream',
  },
};
let L = T[/^ar/.test(chrome.i18n.getUILanguage()) ? 'ar' : 'en'];
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const size = b => { if (!b) return ''; const u = ['B', 'KB', 'MB', 'GB']; let i = 0; while (b >= 1024 && i < 3) { b /= 1024; i++; } return `${b.toFixed(i > 1 ? 1 : 0)} ${u[i]}`; };

async function draw() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const st = await chrome.runtime.sendMessage({ type: 'status', tabId: tab?.id });
  if (st.language) L = T[st.language === 'en' ? 'en' : 'ar'];
  document.documentElement.dir = L === T.ar ? 'rtl' : 'ltr';
  $('#title').textContent = L.title;
  const s = $('#status');
  s.className = 'status ' + (st.running ? (st.paired ? 'ok' : 'warn') : 'off');
  s.textContent = st.running ? (st.paired ? L.ok : L.warn) : L.off;
  const body = $('#body');
  if (!st.running) { body.innerHTML = `<div class="card"><p class="muted">${esc(L.off_text)}</p></div>`; return; }
  if (!st.paired) {
    body.innerHTML = `<div class="card"><p class="muted" style="margin-bottom:10px">${esc(L.pair_text)}</p><button id="pair">${esc(L.pair)}</button><p class="muted" id="pmsg" style="margin-top:8px"></p></div>`;
    $('#pair').onclick = async () => {
      $('#pmsg').textContent = L.pairing; $('#pair').disabled = true;
      const r = await chrome.runtime.sendMessage({ type: 'pair' });
      if (r.ok) draw(); else { $('#pmsg').textContent = L.denied; $('#pair').disabled = false; }
    };
    return;
  }
  const media = st.media || [];
  body.innerHTML = `
    <div class="card row"><div><div>${esc(L.capture)}</div><div class="muted">${esc(L.capture_hint)}</div></div>
      <label class="switch"><input type="checkbox" id="cap" ${st.capture ? 'checked' : ''}><span></span></label></div>
    <button id="pv">${esc(L.page_video)}</button>
    <h4>${esc(L.found)}</h4>
    ${media.length ? media.slice().reverse().map((m, i) => `<div class="media">${m.kind === 'list' ? `<span class="tag">${esc(L.stream)}</span>` : ''}<span class="n" title="${esc(m.url)}">${esc(decodeURIComponent(new URL(m.url).pathname.split('/').pop() || m.url))}</span><span class="s">${size(m.size)}</span><button data-i="${media.length - 1 - i}">${esc(L.get)}</button></div>`).join('') : `<p class="muted">${esc(L.none)}</p>`}`;
  $('#cap').onchange = e => chrome.runtime.sendMessage({ type: 'capture', on: e.target.checked });
  $('#pv').onclick = async () => {
    const r = await chrome.runtime.sendMessage({ type: 'page-video', tabId: tab.id, pageUrl: tab.url, title: tab.title });
    $('#pv').textContent = r.ok ? L.sent : r.error;
  };
  body.querySelectorAll('[data-i]').forEach(b => b.onclick = async () => {
    const m = media[Number(b.dataset.i)];
    const r = await chrome.runtime.sendMessage({ type: 'send', items: [{ url: m.url, kind: m.kind === 'list' ? 'video' : 'http', referrer: tab.url, pageUrl: tab.url, pageTitle: tab.title }] });
    b.textContent = r.ok ? '✓' : '!';
  });
}
draw();
