package com.abdulmedia.barq

import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Environment
import android.provider.MediaStore
import android.webkit.MimeTypeMap
import com.yausername.ffmpeg.FFmpeg
import com.yausername.youtubedl_android.YoutubeDL
import com.yausername.youtubedl_android.YoutubeDLRequest
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File

data class Quality(val id: String, val label: String, val size: Long = 0)

data class VideoInfo(
    val url: String,
    val title: String,
    val thumbnail: String?,
    val uploader: String?,
    val duration: Long,
    val qualities: List<Quality>,
    val entries: List<Pair<String, String>> = emptyList(),   // playlist: (url, title)
)

/** yt-dlp + FFmpeg, through youtubedl-android. */
object Engine {
    val ready = CompletableDeferred<Unit>()

    /** Unpacks Python, yt-dlp and FFmpeg the first time (a few seconds). Called from BarqApp. */
    fun init(ctx: Context) {
        try {
            YoutubeDL.getInstance().init(ctx)
            FFmpeg.getInstance().init(ctx)
            ready.complete(Unit)
        } catch (e: Throwable) {
            ready.completeExceptionally(e)
        }
    }

    /** Keep yt-dlp fresh: sites change often. At most once a day. */
    fun autoUpdate(ctx: Context) {
        val now = System.currentTimeMillis()
        if (now - Prefs.lastUpdateCheck(ctx) < 24 * 3600_000L) return
        runCatching { YoutubeDL.getInstance().updateYoutubeDL(ctx, YoutubeDL.UpdateChannel.STABLE) }
            .onSuccess { Prefs.setLastUpdateCheck(ctx, now) }
    }

    /** true if a newer yt-dlp was installed */
    suspend fun updateNow(ctx: Context): Boolean = withContext(Dispatchers.IO) {
        ready.await()
        val r = YoutubeDL.getInstance().updateYoutubeDL(ctx, YoutubeDL.UpdateChannel.STABLE)
        Prefs.setLastUpdateCheck(ctx, System.currentTimeMillis())
        r == YoutubeDL.UpdateStatus.DONE
    }

    fun version(ctx: Context): String? = runCatching { YoutubeDL.getInstance().version(ctx) }.getOrNull()

    suspend fun probe(url: String): VideoInfo = withContext(Dispatchers.IO) {
        ready.await()
        val req = YoutubeDLRequest(url).apply {
            addOption("-J")
            addOption("--flat-playlist")
            addOption("--playlist-end", 200)
            addOption("--no-warnings")
        }
        val res = YoutubeDL.getInstance().execute(req, null, false, null)
        val j = JSONObject(res.out)
        if (j.optString("_type") == "playlist") {
            val arr = j.optJSONArray("entries")
            val entries = (0 until (arr?.length() ?: 0)).mapNotNull { i ->
                val e = arr!!.optJSONObject(i) ?: return@mapNotNull null
                val u = e.optString("url").takeIf { it.startsWith("http") }
                    ?: e.optString("webpage_url").takeIf { it.startsWith("http") }
                    ?: e.optString("id").takeIf { it.isNotEmpty() && url.contains("youtu") }?.let { "https://www.youtube.com/watch?v=$it" }
                    ?: return@mapNotNull null
                u to e.optString("title", u)
            }
            VideoInfo(url, j.optString("title", url), null, j.optString("uploader").ifEmpty { null }, 0, standardQualities(), entries)
        } else summarize(url, j)
    }

    private fun standardQualities() = listOf(
        Quality("h1080", "1080p"), Quality("h720", "720p"), Quality("h480", "480p"), Quality("audio", "MP3"),
    )

    private fun summarize(url: String, j: JSONObject): VideoInfo {
        val duration = j.optDouble("duration", 0.0).toLong()
        val formats = j.optJSONArray("formats")
        var bestAudio = 0L
        val byHeight = sortedMapOf<Int, Long>(compareByDescending { it })
        if (formats != null) {
            for (i in 0 until formats.length()) {
                val f = formats.getJSONObject(i)
                val size = f.optLong("filesize").takeIf { it > 0 } ?: f.optLong("filesize_approx").takeIf { it > 0 }
                    ?: (f.optDouble("tbr", 0.0) * 125 * duration).toLong()
                val v = f.optString("vcodec", "none"); val a = f.optString("acodec", "none")
                if (v == "none" && a != "none") { if (size > bestAudio) bestAudio = size; continue }
                val h = f.optInt("height", 0)
                if (h <= 0 || v == "none") continue
                val total = size + if (a == "none") bestAudio else 0
                if (total > (byHeight[h] ?: 0)) byHeight[h] = total
            }
        }
        val list = mutableListOf<Quality>()
        for ((h, size) in byHeight) {
            if (h < 240) continue
            if (list.size >= 5) break
            list += Quality("h$h", "${h}p", size)
        }
        if (list.isEmpty()) list += Quality("best", "Best", j.optLong("filesize_approx"))
        list += Quality("audio", "MP3", bestAudio)
        return VideoInfo(
            url = j.optString("webpage_url", url).ifEmpty { url },
            title = j.optString("title", url).ifEmpty { url },
            thumbnail = j.optString("thumbnail").ifEmpty { null },
            uploader = (j.optString("uploader").ifEmpty { j.optString("channel") }).ifEmpty { null },
            duration = duration,
            qualities = list,
        )
    }

    private fun format(q: String): String = when {
        q == "audio" -> "ba/b"
        q.startsWith("h") -> {
            val h = q.drop(1).toIntOrNull() ?: 1080
            "bv*[height<=$h][vcodec^=avc1]+ba[ext=m4a]/bv*[height<=$h]+ba/b[height<=$h]/b"
        }
        else -> "bv*[vcodec^=avc1]+ba[ext=m4a]/bv*+ba/b"
    }

    /** Download into the app's own folder; returns the finished file. */
    suspend fun download(ctx: Context, item: Item, onProgress: (Float, Long, String) -> Unit): File = withContext(Dispatchers.IO) {
        ready.await()
        val dir = File(ctx.cacheDir, "dl/${item.id}").apply { deleteRecursively(); mkdirs() }
        val req = YoutubeDLRequest(item.url).apply {
            addOption("-f", format(item.quality))
            addOption("-o", "${dir.absolutePath}/%(title).120B.%(ext)s")
            addOption("--no-playlist")
            addOption("--no-mtime")
            addOption("--restrict-filenames")
            addOption("-N", 4)
            if (item.quality == "audio") {
                addOption("-x"); addOption("--audio-format", "mp3"); addOption("--audio-quality", "0")
            } else {
                addOption("--merge-output-format", "mp4")
            }
        }
        YoutubeDL.getInstance().execute(req, item.id, false) { progress, eta, line -> onProgress(progress, eta, line) }
        dir.walkTopDown().filter { it.isFile && !it.name.endsWith(".part") && !it.name.endsWith(".ytdl") }
            .maxByOrNull { it.length() } ?: error("No file was produced")
    }

    fun cancel(id: String) { runCatching { YoutubeDL.getInstance().destroyProcessById(id) } }

    /**
     * Put the file where people look for it: videos in Movies/Barq (shows in the gallery),
     * sound in Music/Barq, anything else in Download/Barq.
     */
    fun saveToPhone(ctx: Context, file: File, title: String): Triple<Uri, String, String> {
        val ext = file.extension.lowercase()
        val mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext) ?: "application/octet-stream"
        val (collection, folder) = when {
            mime.startsWith("video/") -> MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY) to "${Environment.DIRECTORY_MOVIES}/Barq"
            mime.startsWith("audio/") -> MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY) to "${Environment.DIRECTORY_MUSIC}/Barq"
            mime.startsWith("image/") -> MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY) to "${Environment.DIRECTORY_PICTURES}/Barq"
            else -> MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY) to "${Environment.DIRECTORY_DOWNLOADS}/Barq"
        }
        val name = safeName(title).ifEmpty { file.nameWithoutExtension } + "." + ext
        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, name)
            put(MediaStore.MediaColumns.MIME_TYPE, mime)
            put(MediaStore.MediaColumns.RELATIVE_PATH, folder)
            put(MediaStore.MediaColumns.IS_PENDING, 1)
        }
        val resolver = ctx.contentResolver
        val uri = resolver.insert(collection, values) ?: error("Could not create the file")
        try {
            resolver.openOutputStream(uri)!!.use { out -> file.inputStream().use { it.copyTo(out, 256 * 1024) } }
            resolver.update(uri, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null)
        } catch (e: Throwable) {
            resolver.delete(uri, null, null); throw e
        } finally {
            file.parentFile?.deleteRecursively()
        }
        return Triple(uri, mime, folder)
    }

    private fun safeName(s: String) = s.replace(Regex("[\\\\/:*?\"<>|\\p{Cntrl}]"), "_").trim().take(120)

    /** The first web link inside shared text ("Check this out https://youtu.be/… "). */
    fun findUrl(text: String?): String? =
        text?.let { Regex("https?://[^\\s<>\"']+").find(it)?.value?.trimEnd('.', ',', ')', '!', '?') }
}
