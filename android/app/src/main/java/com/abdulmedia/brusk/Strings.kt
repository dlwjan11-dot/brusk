package com.abdulmedia.brusk

/** All the app's text, in Arabic, English and Sorani Kurdish. */
class Strings(val lang: String) {
    /** Arabic, English, Sorani Kurdish */
    private fun t(a: String, e: String, k: String) = when (lang) { "en" -> e; "ckb" -> k; else -> a }
    val rtl get() = lang != "en"

    val appName = t("بروسك", "Brusk", "بروسک")
    val tagline = t("الصق رابط أو شارك من أي تطبيق", "Paste a link, or share from any app", "بەستەرێک بلکێنە، یان لە هەر ئەپێکەوە هاوبەشی بکە")
    val pasteHint = t("رابط فيديو من يوتيوب، فيسبوك، إنستغرام، تيك توك…", "A video link from YouTube, Facebook, Instagram, TikTok…", "بەستەری ڤیدیۆ لە یوتیوب، فەیسبووک، ئینستاگرام، تیکتۆک…")
    val paste = t("لصق", "Paste", "لکاندن")
    val go = t("تنزيل", "Download", "داگرتن")
    val howTitle = t("أسهل طريقة", "The easy way", "ئاسانترین ڕێگا")
    val howText = t("بأي تطبيق، اضغط مشاركة على الفيديو، واختار \"تنزيل ببروسك\".", "In any app, tap Share on the video and choose \"Download with Brusk\".", "لە هەر ئەپێکدا، لەسەر ڤیدیۆکە «هاوبەشکردن» دابگرە و «داگرتن بە بروسک» هەڵبژێرە.")
    val emptyTitle = t("ما في تنزيلات بعد", "No downloads yet", "هێشتا هیچ داگرتنێک نییە")
    val downloads = t("التنزيلات", "Downloads", "داگرتنەکان")
    val settings = t("الإعدادات", "Settings", "ڕێکخستنەکان")
    val close = t("إغلاق", "Close", "داخستن")
    val cancel = t("إلغاء", "Cancel", "هەڵوەشاندنەوە")
    val retry = t("أعد المحاولة", "Try again", "دووبارە هەوڵ بدەرەوە")
    val delete = t("حذف من القائمة", "Remove from list", "لابردن لە لیست")
    val deleteFile = t("حذف الملف كمان", "Delete the file too", "فایلەکەش بسڕەوە")
    val share = t("مشاركة", "Share", "هاوبەشکردن")
    val open = t("فتح", "Open", "کردنەوە")
    val clearDone = t("مسح المكتملة", "Clear finished", "سڕینەوەی تەواوبووەکان")

    val reading = t("جاري قراءة الرابط…", "Reading the link…", "خوێندنەوەی بەستەرەکە…")
    val preparing = t("أول مرة: جاري تجهيز بروسك…", "First run: getting Brusk ready…", "یەکەم جار: ئامادەکردنی بروسک…")
    val chooseQuality = t("اختار الجودة", "Choose quality", "کوالیتی هەڵبژێرە")
    val audioOnly = t("صوت فقط", "Audio only", "تەنها دەنگ")
    val best = t("أفضل جودة", "Best quality", "باشترین کوالیتی")
    val playlist = t("قائمة تشغيل", "Playlist", "لیستی لێدان")
    fun videosCount(n: Int) = t("$n فيديو", "$n videos", "$n ڤیدیۆ")
    val downloadAll = t("نزّل الكل", "Download all", "هەمووی دابگرە")
    val notALink = t("ما لقينا رابط بالنص يلي شاركته", "There's no link in what you shared", "هیچ بەستەرێک لەوەی هاوبەشت کرد نییە")
    val readFailed = t("ما قدرنا نقرأ هالرابط", "Couldn't read this link", "نەتوانرا ئەم بەستەرە بخوێنرێتەوە")
    val tryAnyway = t("جرّب نزّل بأفضل جودة", "Try downloading at best quality", "هەوڵی داگرتن بدە بە باشترین کوالیتی")
    val started = t("بلّش التنزيل، شوف الإشعارات", "Downloading, see your notifications", "دادەگیرێت، سەیری ئاگادارکردنەوەکان بکە")

    val stQueued = t("بالدور", "Waiting", "لە ڕیزدایە")
    val stRunning = t("عم ينزل", "Downloading", "دادەگیرێت")
    val stMerging = t("دمج الصوت والصورة…", "Joining video and sound…", "یەکخستنی وێنە و دەنگ…")
    val stSaving = t("حفظ…", "Saving…", "پاشەکەوت دەکرێت…")
    val stDone = t("اكتمل", "Done", "تەواو بوو")
    val stFailed = t("فشل", "Failed", "سەرکەوتوو نەبوو")
    val stCancelled = t("أُلغي", "Cancelled", "هەڵوەشێنرایەوە")
    fun left(eta: String) = t("باقي $eta", "$eta left", "$eta ماوە")
    val savedIn = t("محفوظ بـ", "Saved in", "پاشەکەوت کرا لە")

    val notifChannel = t("التنزيلات", "Downloads", "داگرتنەکان")
    val notifDoneChannel = t("التنزيلات المكتملة", "Finished downloads", "داگرتنە تەواوبووەکان")
    fun notifRunning(n: Int) = t("عم ينزل $n", "Downloading $n", "$n دادەگیرێت")
    val notifDone = t("اكتمل التنزيل", "Download complete", "داگرتن تەواو بوو")
    val notifFailed = t("فشل التنزيل", "Download failed", "داگرتن سەرکەوتوو نەبوو")

    val language = t("اللغة", "Language", "زمان")
    val defaultQuality = t("الجودة الافتراضية", "Default quality", "کوالیتی بنەڕەت")
    val askQuality = t("اسألني كل مرة", "Ask me every time", "هەموو جارێک لێم بپرسە")
    val engine = t("محرك التنزيل (yt-dlp)", "Download engine (yt-dlp)", "بزوێنەری داگرتن (yt-dlp)")
    val engineHint = t("إذا وقف موقع عن الشغل، حدّث المحرك", "If a site stops working, update the engine", "ئەگەر ماڵپەڕێک کاری نەکرد، بزوێنەرەکە نوێ بکەرەوە")
    val update = t("تحديث", "Update", "نوێکردنەوە")
    val updating = t("جاري التحديث…", "Updating…", "نوێ دەکرێتەوە…")
    val upToDate = t("أحدث نسخة", "Up to date", "نوێترین وەشانە")
    val updated = t("تم التحديث", "Updated", "نوێ کرایەوە")
    val about = t("حول", "About", "دەربارە")
    val aboutText = t("بروسك مجاني ومفتوح المصدر. ما بيجمع أي بيانات. نزّل فقط المحتوى المسموح لك بتنزيله.", "Brusk is free and open source. It collects no data. Only download content you have the right to.", "بروسک خۆڕایی و سەرچاوە کراوەیە. هیچ زانیارییەک کۆ ناکاتەوە. تەنها ئەو ناوەڕۆکانە دابگرە کە مافی داگرتنیانت هەیە.")
    val website = "dlwjan11-dot.github.io/brusk"

    /** Turn yt-dlp's English error lines into something a person understands. */
    fun explain(error: String?): String {
        val e = error.orEmpty()
        return when {
            e.contains("Private video", true) || e.contains("login", true) || e.contains("sign in", true) ->
                t("هالفيديو خاص أو بدّه تسجيل دخول", "This video is private or needs a sign-in", "ئەم ڤیدیۆیە تایبەتە یان پێویستی بە چوونەژوورەوە هەیە")
            e.contains("Unsupported URL", true) -> t("هالموقع مو مدعوم", "This site isn't supported", "ئەم ماڵپەڕە پشتگیری ناکرێت")
            e.contains("Unable to download", true) || e.contains("timed out", true) || e.contains("resolve", true) ->
                t("مشكلة بالاتصال، تأكد من النت", "Connection problem, check your internet", "کێشەی پەیوەندی، ئینتەرنێتەکەت بپشکنە")
            e.contains("unavailable", true) -> t("الفيديو مو متاح", "The video isn't available", "ڤیدیۆکە بەردەست نییە")
            e.contains("No space", true) -> t("ما في مساحة كافية بالموبايل", "Not enough space on the phone", "شوێنی بەتاڵ لە مۆبایلەکەدا بەس نییە")
            e.isBlank() -> t("صار خطأ", "Something went wrong", "هەڵەیەک ڕوویدا")
            else -> e.lineSequence().lastOrNull { it.isNotBlank() }?.removePrefix("ERROR: ")?.take(180) ?: e.take(180)
        }
    }
}
