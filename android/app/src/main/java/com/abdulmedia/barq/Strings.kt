package com.abdulmedia.barq

/** All the app's text, in Arabic and English. */
class Strings(val ar: Boolean) {
    private fun t(a: String, e: String) = if (ar) a else e

    val appName = t("برق", "Barq")
    val tagline = t("الصق رابط أو شارك من أي تطبيق", "Paste a link, or share from any app")
    val pasteHint = t("رابط فيديو من يوتيوب، فيسبوك، إنستغرام، تيك توك…", "A video link from YouTube, Facebook, Instagram, TikTok…")
    val paste = t("لصق", "Paste")
    val go = t("تنزيل", "Download")
    val howTitle = t("أسهل طريقة", "The easy way")
    val howText = t(
        "بأي تطبيق، اضغط مشاركة على الفيديو، واختار \"تنزيل ببرق\".",
        "In any app, tap Share on the video and choose \"Download with Barq\".",
    )
    val emptyTitle = t("ما في تنزيلات بعد", "No downloads yet")
    val downloads = t("التنزيلات", "Downloads")
    val settings = t("الإعدادات", "Settings")
    val close = t("إغلاق", "Close")
    val cancel = t("إلغاء", "Cancel")
    val retry = t("أعد المحاولة", "Try again")
    val delete = t("حذف من القائمة", "Remove from list")
    val deleteFile = t("حذف الملف كمان", "Delete the file too")
    val share = t("مشاركة", "Share")
    val open = t("فتح", "Open")
    val clearDone = t("مسح المكتملة", "Clear finished")

    val reading = t("جاري قراءة الرابط…", "Reading the link…")
    val preparing = t("أول مرة: جاري تجهيز برق…", "First run: getting Barq ready…")
    val chooseQuality = t("اختار الجودة", "Choose quality")
    val audioOnly = t("صوت فقط", "Audio only")
    val best = t("أفضل جودة", "Best quality")
    val playlist = t("قائمة تشغيل", "Playlist")
    fun videosCount(n: Int) = t("$n فيديو", "$n videos")
    val downloadAll = t("نزّل الكل", "Download all")
    val notALink = t("ما لقينا رابط بالنص يلي شاركته", "There's no link in what you shared")
    val readFailed = t("ما قدرنا نقرأ هالرابط", "Couldn't read this link")
    val tryAnyway = t("جرّب نزّل بأفضل جودة", "Try downloading at best quality")
    val started = t("بلّش التنزيل، شوف الإشعارات", "Downloading, see your notifications")

    val stQueued = t("بالدور", "Waiting")
    val stRunning = t("عم ينزل", "Downloading")
    val stMerging = t("دمج الصوت والصورة…", "Joining video and sound…")
    val stSaving = t("حفظ…", "Saving…")
    val stDone = t("اكتمل", "Done")
    val stFailed = t("فشل", "Failed")
    val stCancelled = t("أُلغي", "Cancelled")
    fun left(eta: String) = t("باقي $eta", "$eta left")
    val savedIn = t("محفوظ بـ", "Saved in")

    val notifChannel = t("التنزيلات", "Downloads")
    val notifDoneChannel = t("التنزيلات المكتملة", "Finished downloads")
    fun notifRunning(n: Int) = t("عم ينزل $n", "Downloading $n")
    val notifDone = t("اكتمل التنزيل", "Download complete")
    val notifFailed = t("فشل التنزيل", "Download failed")

    val language = t("اللغة", "Language")
    val defaultQuality = t("الجودة الافتراضية", "Default quality")
    val askQuality = t("اسألني كل مرة", "Ask me every time")
    val engine = t("محرك التنزيل (yt-dlp)", "Download engine (yt-dlp)")
    val engineHint = t("إذا وقف موقع عن الشغل، حدّث المحرك", "If a site stops working, update the engine")
    val update = t("تحديث", "Update")
    val updating = t("جاري التحديث…", "Updating…")
    val upToDate = t("أحدث نسخة", "Up to date")
    val updated = t("تم التحديث", "Updated")
    val about = t("حول", "About")
    val aboutText = t(
        "برق مجاني ومفتوح المصدر. ما بيجمع أي بيانات. نزّل فقط المحتوى المسموح لك بتنزيله.",
        "Barq is free and open source. It collects no data. Only download content you have the right to.",
    )
    val website = "dlwjan11-dot.github.io/barq"

    /** Turn yt-dlp's English error lines into something a person understands. */
    fun explain(error: String?): String {
        val e = error.orEmpty()
        return when {
            e.contains("Private video", true) || e.contains("login", true) || e.contains("sign in", true) ->
                t("هالفيديو خاص أو بدّه تسجيل دخول", "This video is private or needs a sign-in")
            e.contains("Unsupported URL", true) -> t("هالموقع مو مدعوم", "This site isn't supported")
            e.contains("Unable to download", true) || e.contains("timed out", true) || e.contains("resolve", true) ->
                t("مشكلة بالاتصال، تأكد من النت", "Connection problem, check your internet")
            e.contains("unavailable", true) -> t("الفيديو مو متاح", "The video isn't available")
            e.contains("No space", true) -> t("ما في مساحة كافية بالموبايل", "Not enough space on the phone")
            e.isBlank() -> t("صار خطأ", "Something went wrong")
            else -> e.lineSequence().lastOrNull { it.isNotBlank() }?.removePrefix("ERROR: ")?.take(180) ?: e.take(180)
        }
    }
}
