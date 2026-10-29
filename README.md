<p align="center"><img src="docs/img/icon.png" width="96" alt="Brusk"></p>
<h1 align="center">بروسك · بروسک · Brusk</h1>
<p align="center"><b>مدير تحميل سريع ومجاني لـ Windows و macOS و Android</b><br>بەڕێوەبەرێکی خێرا و خۆڕایی داگرتن بۆ Windows و macOS و Android<br>A fast, free download manager for Windows, macOS and Android</p>
<p align="center">
  <a href="https://dlwjan11-dot.github.io/brusk/"><b>🌐 الموقع · Website</b></a> &nbsp;·&nbsp;
  <a href="https://github.com/dlwjan11-dot/brusk/releases/latest"><b>⬇️ التنزيل · Download</b></a> &nbsp;·&nbsp;
  <a href="#العربية">العربية</a> &nbsp;·&nbsp;
  <a href="#kurdi">کوردی</a> &nbsp;·&nbsp;
  <a href="#english">English</a>
</p>
<p align="center"><img src="docs/img/main-ar.jpg" width="820" alt="Brusk"></p>

---

<div dir="rtl">

## العربية

**بروسك** يعني **البرق** بالكردي.

بروسك مدير تحميل مجاني ومفتوح المصدر، بيشتغل على Windows والماك والأندرويد، وواجهته بالعربي والكردي السوراني والإنجليزي. بيقسم الملف على عدة اتصالات حتى ينزل أسرع، وبيكمّل من وين وقف، وبينزّل فيديوهات يوتيوب والتورنت، وفيه إضافة للمتصفح بتبعتله التحميلات لحالها.

### التنزيل

| الجهاز | الملف |
|---|---|
| Windows 10 و 11 | [Brusk-Setup-Windows.exe](https://github.com/dlwjan11-dot/brusk/releases/latest/download/Brusk-Setup-Windows.exe) |
| ماك Apple Silicon ‏(M1 إلى M4) | [Brusk-Mac-AppleSilicon.dmg](https://github.com/dlwjan11-dot/brusk/releases/latest/download/Brusk-Mac-AppleSilicon.dmg) |
| ماك Intel | [Brusk-Mac-Intel.dmg](https://github.com/dlwjan11-dot/brusk/releases/latest/download/Brusk-Mac-Intel.dmg) |
| أندرويد 10 أو أحدث | [Brusk-Android.apk](https://github.com/dlwjan11-dot/brusk/releases/latest/download/Brusk-Android.apk) (للموبايلات القديمة: [32-bit](https://github.com/dlwjan11-dot/brusk/releases/latest/download/Brusk-Android-32bit.apk)) |
| إضافة Chrome و Edge و Brave | [Brusk-Chrome-Extension.zip](https://github.com/dlwjan11-dot/brusk/releases/latest/download/Brusk-Chrome-Extension.zip) |
| إضافة Firefox | من [Firefox Add-ons](https://addons.mozilla.org/firefox/addon/brusk-download-manager/) |

لتعرف نوع الماك: اضغط على  ثم **About This Mac**. إذا مكتوب **Chip: Apple M…** فجهازك Apple Silicon.

### أول تشغيل

البرنامج مجاني ومو موقّع من Microsoft أو Apple، فأول مرة بيطلع تحذير:

- **Windows:** إذا طلعت شاشة "Windows protected your PC"، اضغط **More info** وبعدين **Run anyway**.
- **الماك:** افتح ملف الـ dmg واسحب Brusk لمجلد Applications. بعدين افتح Terminal والصق:
  `xattr -cr /Applications/Brusk.app`
  أو جرّب افتحه، وروح على System Settings ← Privacy & Security واضغط **Open Anyway**.

### الأندرويد

نزّل `Brusk-Android.apk` من الموبايل وافتحه. إذا سألك، اسمح بـ **تثبيت تطبيقات من هذا المصدر**. بعدها بأي تطبيق (يوتيوب، فيسبوك، إنستغرام، تيك توك…) اضغط **مشاركة** على الفيديو، واختار **تنزيل ببروسك**، واختار الجودة. الفيديو بينحفظ بمجلد `Movies/Brusk` وبيطلع بالمعرض، والصوت بـ `Music/Brusk`.

### تركيب إضافة المتصفح

- **Firefox:** ركّبها من صفحة Firefox Add-ons.
- **Chrome و Edge و Brave:**
  1. فكّ ضغط `Brusk-Chrome-Extension.zip`.
  2. افتح `chrome://extensions` (أو `edge://extensions`) وفعّل **Developer mode**.
  3. اضغط **Load unpacked** واختار المجلد.

بعد التركيب، اضغط أيقونة بروسك بالمتصفح، بعدين **ربط**، ووافق بنافذة البرنامج.

### الميزات

**التحميل**
- حتى 32 اتصال للملف الواحد، مع تقسيم ذكي: الاتصال يلي بيخلص بياخد نص أكبر جزء باقي، فالسرعة بتضل عالية للآخر.
- استكمال بعد الإيقاف أو انقطاع النت أو إغلاق الجهاز.
- إعادة محاولة تلقائية للاتصالات المقطوعة.
- حد سرعة لكل التحميلات، أو لكل ملف لحاله.
- صف انتظار، وجدولة بوقت وأيام محددة.
- بعد ما تخلص التحميلات: إطفاء الجهاز، أو سكون، أو إغلاق البرنامج.
- تصنيف تلقائي حسب نوع الملف، مع مجلد لكل نوع.
- دعم البروكسي، وفحص الملف بـ SHA-256.

**الفيديو**
- يوتيوب، فيميو، تيك توك، X، فيسبوك، إنستغرام، ومواقع كتير غيرهم.
- اختيار الجودة لحد 4K، أو صوت فقط بصيغة MP3 أو M4A.
- قوائم تشغيل كاملة، وترجمة.

**الصور والمنشورات**
- صور إنستغرام، ووسائط فيسبوك و X و Threads و Pinterest و Reddit وغيرهم.
- منشور واحد، أو كل منشورات صفحة كاملة، أو آخر عدد بتختاره.
- صور بس، أو فيديو بس، أو الاتنين.
- إنستغرام و X بيطلبوا تسجيل دخول: نزّل من إضافة المتصفح، أو اختار متصفحك من **الإعدادات ← الفيديو والصور**.

**التورنت**
- روابط magnet وملفات `.torrent`.
- اختيار الملفات قبل ما يبلش التحميل.
- حد سرعة الرفع ونسبة المشاركة.

**المتصفح**
- بيلتقط التحميلات تلقائياً حسب نوع الملف.
- زر "تحميل بـ بروسك" فوق الفيديوهات.
- قائمة الزر اليمين: تحميل رابط، أو كل الروابط المحددة، أو فيديو الصفحة.

**عام**
- واجهة كاملة بالعربي والكردي من اليمين لليسار، وبالإنجليزي.
- وضع فاتح وداكن.
- مراقبة الروابط المنسوخة، وأيقونة جنب الساعة، وإشعارات.

### الخصوصية

بروسك ما بيجمع أي بيانات، وما فيه إعلانات. الإضافة بتبعت الروابط بس لبرنامج بروسك على نفس جهازك.

نزّل فقط المحتوى المسموح لك بتنزيله.

</div>

---

<div dir="rtl">

<h2 id="kurdi">کوردی (سۆرانی)</h2>

**بروسک** واتە **برووسکە** بە کوردی.

بروسک بەڕێوەبەرێکی داگرتنی خۆڕایی و سەرچاوە کراوەیە، لەسەر Windows و ماک و ئەندرۆید کار دەکات، و ڕووکارەکەی بە عەرەبی، کوردی سۆرانی و ئینگلیزییە. هەر فایلێک لەسەر چەند پەیوەندییەک دابەش دەکات تا خێراتر دابگیرێت، لەو شوێنەوە بەردەوام دەبێت کە وەستا، ڤیدیۆی یوتیوب و تۆرێنت دادەگرێت، و پاشکۆیەکی وێبگەڕی هەیە کە داگرتنەکان خۆکارانە دەنێرێت بۆی.

### داگرتن

| ئامێر | فایل |
|---|---|
| Windows 10 و 11 | [Brusk-Setup-Windows.exe](https://github.com/dlwjan11-dot/brusk/releases/latest/download/Brusk-Setup-Windows.exe) |
| ماکی Apple Silicon ‏(M1 تا M4) | [Brusk-Mac-AppleSilicon.dmg](https://github.com/dlwjan11-dot/brusk/releases/latest/download/Brusk-Mac-AppleSilicon.dmg) |
| ماکی Intel | [Brusk-Mac-Intel.dmg](https://github.com/dlwjan11-dot/brusk/releases/latest/download/Brusk-Mac-Intel.dmg) |
| ئەندرۆید 10 یان نوێتر | [Brusk-Android.apk](https://github.com/dlwjan11-dot/brusk/releases/latest/download/Brusk-Android.apk) (مۆبایلی کۆن: [32-bit](https://github.com/dlwjan11-dot/brusk/releases/latest/download/Brusk-Android-32bit.apk)) |
| پاشکۆی Chrome و Edge و Brave | [Brusk-Chrome-Extension.zip](https://github.com/dlwjan11-dot/brusk/releases/latest/download/Brusk-Chrome-Extension.zip) |
| پاشکۆی Firefox | لە [Firefox Add-ons](https://addons.mozilla.org/firefox/addon/brusk-download-manager/) |

بۆ زانینی جۆری ماکەکەت:  دابگرە، پاشان **About This Mac**. ئەگەر نووسرابوو **Chip: Apple M…** ئەوا ئامێرەکەت Apple Silicon ـە.

### یەکەم جار کردنەوە

بروسک خۆڕاییە و لەلایەن Microsoft یان Apple ـەوە واژۆ نەکراوە، بۆیە یەکەم جار ئاگادارکردنەوەیەک دەردەکەوێت:

- **Windows:** ئەگەر شاشەی «Windows protected your PC» دەرکەوت، **More info** دابگرە، پاشان **Run anyway**.
- **ماک:** فایلی dmg بکەرەوە و Brusk ڕابکێشە بۆ Applications. پاشان Terminal بکەرەوە و ئەمە بلکێنە:
  `xattr -cr /Applications/Brusk.app`
  یان هەوڵی کردنەوەی بدە، پاشان بڕۆ بۆ System Settings ← Privacy & Security و **Open Anyway** دابگرە.

### ئەندرۆید

`Brusk-Android.apk` لەسەر مۆبایلەکەت دابگرە و بیکەرەوە. ئەگەر پرسیاری کرد، ڕێگە بدە بە **دامەزراندن لەم سەرچاوەیە**. پاشان لە هەر ئەپێکدا (یوتیوب، فەیسبووک، ئینستاگرام، تیکتۆک…) لەسەر ڤیدیۆکە **هاوبەشکردن** دابگرە، **داگرتن بە بروسک** هەڵبژێرە، و کوالیتی دیاری بکە. ڤیدیۆکان لە `Movies/Brusk` پاشەکەوت دەکرێن و لە گەلەری دەردەکەون، دەنگیش لە `Music/Brusk`.

### دامەزراندنی پاشکۆی وێبگەڕ

- **Firefox:** لە پەڕەی Firefox Add-ons دایبمەزرێنە.
- **Chrome و Edge و Brave:**
  1. `Brusk-Chrome-Extension.zip` بکەرەوە.
  2. `chrome://extensions` (یان `edge://extensions`) بکەرەوە و **Developer mode** چالاک بکە.
  3. **Load unpacked** دابگرە و بوخچەکە هەڵبژێرە.

دوای دامەزراندن، ئایکۆنی بروسک لە وێبگەڕدا دابگرە، پاشان **پەیوەستکردن**، و لە پەنجەرەی بەرنامەکەدا ڕێگە بدە.

### تایبەتمەندییەکان

**داگرتن**
- تا 32 پەیوەندی بۆ هەر فایلێک، بە دابەشکردنی زیرەک: ئەو پەیوەندییەی تەواو دەبێت نیوەی گەورەترین بەشی ماوە وەردەگرێت، بۆیە خێرایی تا کۆتایی بەرز دەمێنێتەوە.
- بەردەوامبوون دوای وەستاندن، پچڕانی ئینتەرنێت، یان کوژاندنەوەی ئامێر.
- هەوڵدانەوەی خۆکار بۆ پەیوەندییە پچڕاوەکان.
- سنووری خێرایی بۆ هەموو داگرتنەکان، یان بۆ هەر فایلێک بە جیا.
- ڕیزی چاوەڕوانی، و خشتەی کات بە کاتژمێر و ڕۆژی دیاریکراو.
- دوای تەواوبوونی داگرتنەکان: کوژاندنەوە، خەوتن، یان داخستنی بەرنامەکە.
- پۆلێنکردنی خۆکار بەپێی جۆری فایل، لەگەڵ بوخچەیەک بۆ هەر جۆرێک.
- پشتگیری پرۆکسی، و پشکنینی فایل بە SHA-256.

**ڤیدیۆ**
- یوتیوب، ڤیمیۆ، تیکتۆک، X، فەیسبووک، ئینستاگرام، و زۆر ماڵپەڕی تر.
- هەر کوالیتییەک تا 4K، یان تەنها دەنگ بە MP3 یان M4A.
- لیستی لێدانی تەواو، و ژێرنووس.

**وێنە و پۆست**
- وێنەکانی ئینستاگرام، و میدیای فەیسبووک و X و Threads و Pinterest و Reddit و هیتر.
- یەک پۆست، یان هەموو پۆستەکانی پەڕەیەکی تەواو، یان ژمارەیەک کە خۆت هەڵیدەبژێریت.
- تەنها وێنە، تەنها ڤیدیۆ، یان هەردووکیان.
- ئینستاگرام و X پێویستیان بە چوونەژوورەوەیە: لە پاشکۆی وێبگەڕەوە بینێرە، یان لە **ڕێکخستنەکان ← ڤیدیۆ و وێنە** وێبگەڕەکەت هەڵبژێرە.

**تۆرێنت**
- بەستەری magnet و فایلی `.torrent`.
- هەڵبژاردنی فایلەکان پێش دەستپێکردنی داگرتن.
- سنووری خێرایی بەرزکردنەوە و ڕێژەی هاوبەشکردن.

**وێبگەڕ**
- داگرتنەکان خۆکارانە بەپێی جۆری فایل وەردەگرێت.
- دوگمەی «داگرتن بە بروسک» لەسەر ڤیدیۆکان.
- لیستی کلیکی ڕاست: داگرتنی بەستەرێک، هەموو بەستەرە دیاریکراوەکان، یان ڤیدیۆی پەڕەکە.

**گشتی**
- ڕووکاری تەواوی عەرەبی و کوردی لە ڕاستەوە بۆ چەپ، و ئینگلیزی.
- ڕووکاری ڕووناک و تاریک.
- پشکنینی بەستەرە کۆپیکراوەکان، ئایکۆن لە تەنیشت کاتژمێر، و ئاگادارکردنەوە.

### تایبەتێتی

بروسک هیچ زانیارییەک کۆ ناکاتەوە و ڕیکلامی تێدا نییە. پاشکۆکە بەستەرەکان تەنها دەنێرێت بۆ بەرنامەی بروسک لەسەر هەمان ئامێری خۆت.

تەنها ئەو ناوەڕۆکانە دابگرە کە مافی داگرتنیانت هەیە.

</div>

---

<h2 id="english">English</h2>

**Brusk** means **lightning** in Kurdish.

Brusk is a free, open-source download manager for Windows, macOS and Android, in Arabic, Sorani Kurdish and English. It splits each file across several connections to download faster, resumes where it stopped, downloads YouTube videos and torrents, and comes with a browser extension that hands your downloads to it automatically.

### Download

| System | File |
|---|---|
| Windows 10 and 11 | [Brusk-Setup-Windows.exe](https://github.com/dlwjan11-dot/brusk/releases/latest/download/Brusk-Setup-Windows.exe) |
| Mac with Apple Silicon (M1 to M4) | [Brusk-Mac-AppleSilicon.dmg](https://github.com/dlwjan11-dot/brusk/releases/latest/download/Brusk-Mac-AppleSilicon.dmg) |
| Mac with Intel | [Brusk-Mac-Intel.dmg](https://github.com/dlwjan11-dot/brusk/releases/latest/download/Brusk-Mac-Intel.dmg) |
| Android 10 or newer | [Brusk-Android.apk](https://github.com/dlwjan11-dot/brusk/releases/latest/download/Brusk-Android.apk) (older phones: [32-bit](https://github.com/dlwjan11-dot/brusk/releases/latest/download/Brusk-Android-32bit.apk)) |
| Chrome, Edge and Brave extension | [Brusk-Chrome-Extension.zip](https://github.com/dlwjan11-dot/brusk/releases/latest/download/Brusk-Chrome-Extension.zip) |
| Firefox extension | On [Firefox Add-ons](https://addons.mozilla.org/firefox/addon/brusk-download-manager/) |

Not sure which Mac you have? Click  → **About This Mac**. If it says **Chip: Apple M…**, it's Apple Silicon.

### First launch

Brusk is free and isn't signed by Microsoft or Apple, so the first launch shows a warning:

- **Windows:** if you see "Windows protected your PC", click **More info**, then **Run anyway**.
- **Mac:** open the dmg and drag Brusk into Applications. Then open Terminal and paste:
  `xattr -cr /Applications/Brusk.app`
  Or try to open it, then go to System Settings → Privacy & Security and click **Open Anyway**.

### Android

Download `Brusk-Android.apk` on your phone and open it. If asked, allow **Install from this source**. Then in any app (YouTube, Facebook, Instagram, TikTok…) tap **Share** on a video, choose **Download with Brusk**, and pick a quality. Videos are saved to `Movies/Brusk` and show up in your gallery; audio goes to `Music/Brusk`.

### Installing the browser extension

- **Firefox:** install it from Firefox Add-ons.
- **Chrome, Edge and Brave:**
  1. Unzip `Brusk-Chrome-Extension.zip`.
  2. Open `chrome://extensions` (or `edge://extensions`) and turn on **Developer mode**.
  3. Click **Load unpacked** and pick the folder.

Then click the Brusk icon in your browser, press **Connect**, and allow it in the Brusk window.

### Features

**Downloads**
- Up to 32 connections per file with smart splitting: a connection that finishes takes half of the biggest part left, so speed stays high to the end.
- Resume after pausing, losing the connection, or shutting down.
- Automatic retries for dropped connections.
- Speed limits for everything, or per file.
- A queue, and a scheduler with set times and days.
- When everything is done: shut down, sleep, or quit.
- Automatic categories by file type, with a folder for each.
- Proxy support and SHA-256 file checks.

**Video**
- YouTube, Vimeo, TikTok, X, Facebook, Instagram and many more.
- Any quality up to 4K, or audio only as MP3 or M4A.
- Whole playlists, and subtitles.

**Pictures and posts**
- Instagram pictures, and media from Facebook, X, Threads, Pinterest, Reddit and more.
- One post, every post on a page, or the latest number you choose.
- Pictures only, video only, or both.
- Instagram and X need a sign-in: send it from the browser extension, or pick your browser in **Settings → Video & pictures**.

**Torrents**
- Magnet links and `.torrent` files.
- Choose which files you want before it starts.
- Upload limits and share ratio.

**Browser**
- Takes over downloads automatically by file type.
- A "Download with Brusk" button on videos.
- Right-click menu: download a link, all selected links, or the page's video.

**General**
- Complete right-to-left Arabic and Sorani Kurdish interfaces, and English.
- Light and dark themes.
- Copied-link detection, a tray icon, and notifications.

### Privacy

Brusk collects no data and shows no ads. The extension sends links only to the Brusk app on your own computer.

Only download content you have the right to download.

---

## للمطوّرين · For developers

```bash
npm install
npm start          # تشغيل · run
npm test           # الاختبارات · tests
npm run dist       # بناء نسخة Windows · build for Windows (on Windows, or Linux with Wine)
npm run dist:mac   # بناء نسخة الماك · build for macOS (needs rcodesign on Linux)
./scripts/build-firefox.sh   # إضافة Firefox · Firefox add-on
```

| المجلد · Folder | المحتوى · Contents |
|---|---|
| `src/core/` | محرك التحميل · download engine (`http-transfer.js`, `manager.js`, `video.js`, `aria2.js`, `tools.js`) |
| `src/main/` | Electron، والاتصال مع الإضافة · Electron and the extension link (`bridge.js`) |
| `src/renderer/` | الواجهة · interface |
| `extension/` | إضافة المتصفح · browser extension |
| `android/` | تطبيق الأندرويد · Android app (Kotlin, Compose, youtubedl-android) |
| `docs/` | الموقع · website |

الأدوات المساعدة · Helper tools: [yt-dlp](https://github.com/yt-dlp/yt-dlp), [gallery-dl](https://github.com/mikf/gallery-dl), [aria2](https://github.com/aria2/aria2), [FFmpeg](https://ffmpeg.org), [Deno](https://deno.com), [Electron](https://www.electronjs.org). كل أداة بتنفحص بـ SHA-256 قبل ما تنحفظ · Every tool is checked against its SHA-256 before it is kept.

## الرخصة · License

[MIT](LICENSE) · من صنع · Made by [Abdulmedia](https://abdulmedia.com)
