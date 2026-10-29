package com.abdulmedia.barq

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.Locale
import java.util.UUID

enum class Status { QUEUED, RUNNING, MERGING, SAVING, DONE, FAILED, CANCELLED }

data class Item(
    val id: String = UUID.randomUUID().toString(),
    val url: String,
    val title: String,
    val thumbnail: String? = null,
    val quality: String = "best",          // best | h1080 | h720 … | audio
    val status: Status = Status.QUEUED,
    val progress: Float = 0f,              // 0..100, or -1 while unknown
    val eta: Long = -1,
    val size: Long = 0,
    val uri: String? = null,               // content:// of the saved file
    val mime: String? = null,
    val folder: String? = null,            // e.g. Movies/Barq
    val error: String? = null,
    val createdAt: Long = System.currentTimeMillis(),
) {
    val active get() = status == Status.QUEUED || status == Status.RUNNING || status == Status.MERGING || status == Status.SAVING

    fun toJson() = JSONObject().apply {
        put("id", id); put("url", url); put("title", title); put("thumbnail", thumbnail); put("quality", quality)
        put("status", status.name); put("progress", progress.toDouble()); put("size", size); put("uri", uri)
        put("mime", mime); put("folder", folder); put("error", error); put("createdAt", createdAt)
    }

    companion object {
        fun fromJson(o: JSONObject) = Item(
            id = o.getString("id"), url = o.getString("url"), title = o.optString("title"),
            thumbnail = o.optString("thumbnail").ifEmpty { null }.takeIf { it != "null" },
            quality = o.optString("quality", "best"),
            status = runCatching { Status.valueOf(o.optString("status")) }.getOrDefault(Status.FAILED),
            progress = o.optDouble("progress", 0.0).toFloat(), size = o.optLong("size"),
            uri = o.optString("uri").takeIf { it.isNotEmpty() && it != "null" },
            mime = o.optString("mime").takeIf { it.isNotEmpty() && it != "null" },
            folder = o.optString("folder").takeIf { it.isNotEmpty() && it != "null" },
            error = o.optString("error").takeIf { it.isNotEmpty() && it != "null" },
            createdAt = o.optLong("createdAt"),
        )
    }
}

/** The download list, kept in memory for the screens and saved to a small JSON file. */
object Downloads {
    private val _items = MutableStateFlow<List<Item>>(emptyList())
    val items: StateFlow<List<Item>> = _items
    private lateinit var file: File

    fun load(ctx: Context) {
        file = File(ctx.filesDir, "downloads.json")
        val list = runCatching {
            val arr = JSONArray(file.readText())
            (0 until arr.length()).map { Item.fromJson(arr.getJSONObject(it)) }
        }.getOrDefault(emptyList())
        // anything that was running when the app was killed is shown as failed (can be retried)
        _items.value = list.map { if (it.active) it.copy(status = Status.FAILED, error = null) else it }
    }

    fun get(id: String) = _items.value.firstOrNull { it.id == id }

    @Synchronized fun add(item: Item) { _items.value = listOf(item) + _items.value; save() }

    @Synchronized fun update(id: String, persist: Boolean = true, f: (Item) -> Item) {
        _items.value = _items.value.map { if (it.id == id) f(it) else it }
        if (persist) save()
    }

    @Synchronized fun remove(id: String) { _items.value = _items.value.filterNot { it.id == id }; save() }

    @Synchronized fun clearFinished() { _items.value = _items.value.filter { it.active || it.status == Status.FAILED }; save() }

    private fun save() {
        runCatching {
            val tmp = File(file.path + ".tmp")
            tmp.writeText(JSONArray(_items.value.take(300).map { it.toJson() }).toString())
            tmp.renameTo(file)
        }
    }
}

/** Small settings, in SharedPreferences. */
object Prefs {
    private fun sp(ctx: Context) = ctx.getSharedPreferences("barq", Context.MODE_PRIVATE)
    private val _lang = MutableStateFlow("ar")
    val lang: StateFlow<String> = _lang

    fun init(ctx: Context) {
        val sys = Locale.getDefault().language
        _lang.value = sp(ctx).getString("lang", null) ?: if (sys == "ar") "ar" else "en"
    }
    fun setLang(ctx: Context, l: String) { sp(ctx).edit().putString("lang", l).apply(); _lang.value = l }
    fun strings() = Strings(_lang.value == "ar")

    /** "ask" or a quality id */
    fun quality(ctx: Context): String = sp(ctx).getString("quality", "ask") ?: "ask"
    fun setQuality(ctx: Context, q: String) = sp(ctx).edit().putString("quality", q).apply()

    fun lastUpdateCheck(ctx: Context) = sp(ctx).getLong("ytdlpCheck", 0)
    fun setLastUpdateCheck(ctx: Context, t: Long) = sp(ctx).edit().putLong("ytdlpCheck", t).apply()
}
