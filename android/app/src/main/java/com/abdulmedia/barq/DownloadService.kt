package com.abdulmedia.barq

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.yausername.youtubedl_android.YoutubeDL
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/** Runs the downloads in the background (two at a time) with a progress notification. */
class DownloadService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val running = mutableSetOf<String>()
    private var lastNotify = 0L

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        ServiceCompat.startForeground(this, ONGOING_ID, ongoing(), ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        if (intent?.action == ACTION_CANCEL) intent.getStringExtra(EXTRA_ID)?.let { cancelItem(it) }
        pump()
        return START_NOT_STICKY
    }

    @Synchronized private fun pump() {
        val queued = Downloads.items.value.filter { it.status == Status.QUEUED && it.id !in running }.sortedBy { it.createdAt }
        for (item in queued) {
            if (running.size >= MAX_PARALLEL) break
            running += item.id
            scope.launch { runItem(item) }
        }
        if (running.isEmpty()) {
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
            stopSelf()
        }
    }

    private suspend fun runItem(item: Item) {
        val s = Prefs.strings()
        try {
            Downloads.update(item.id) { it.copy(status = Status.RUNNING, progress = -1f, error = null) }
            val file = Engine.download(this, item) { progress, eta, line ->
                val merging = line.contains("[Merger]") || line.contains("[ExtractAudio]") || line.contains("[FixupM3u8]")
                Downloads.update(item.id, persist = false) {
                    if (it.status == Status.CANCELLED) it
                    else it.copy(status = if (merging) Status.MERGING else Status.RUNNING, progress = if (merging) -1f else progress, eta = eta)
                }
                refreshOngoing()
            }
            Downloads.update(item.id) { it.copy(status = Status.SAVING, progress = -1f) }
            val size = file.length()
            val (uri, mime, folder) = Engine.saveToPhone(this, file, item.title)
            Downloads.update(item.id) { it.copy(status = Status.DONE, progress = 100f, uri = uri.toString(), mime = mime, folder = folder, size = size) }
            notifyFinished(item.copy(uri = uri.toString(), mime = mime), s.notifDone)
        } catch (e: Throwable) {
            val cancelled = e is YoutubeDL.CanceledException || Downloads.get(item.id)?.status == Status.CANCELLED
            Downloads.update(item.id) {
                if (cancelled) it.copy(status = Status.CANCELLED, progress = 0f)
                else it.copy(status = Status.FAILED, error = s.explain(e.message ?: e.cause?.message))
            }
            if (!cancelled) notifyFinished(item, s.notifFailed)
        } finally {
            synchronized(this) { running -= item.id }
            refreshOngoing(force = true)
            pump()
        }
    }

    private fun cancelItem(id: String) {
        Downloads.update(id) { if (it.active) it.copy(status = Status.CANCELLED) else it }
        Engine.cancel(id)
    }

    /* ---------- notifications ---------- */

    private fun ongoing(): Notification {
        val s = Prefs.strings()
        val active = Downloads.items.value.filter { it.id in running || it.status == Status.QUEUED }
        val first = active.firstOrNull { it.id in running } ?: active.firstOrNull()
        val b = NotificationCompat.Builder(this, CHANNEL_RUN)
            .setSmallIcon(R.drawable.ic_notify)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setContentIntent(openApp())
            .setContentTitle(if (active.size > 1) s.notifRunning(active.size) else first?.title ?: s.appName)
        if (first != null) {
            val p = first.progress
            if (first.status == Status.MERGING || first.status == Status.SAVING || p < 0) b.setProgress(100, 0, true)
            else b.setProgress(100, p.toInt(), false)
            b.setContentText(
                when (first.status) {
                    Status.MERGING -> s.stMerging
                    Status.SAVING -> s.stSaving
                    else -> if (p >= 0) "${p.toInt()}%" + (if (first.eta > 0) " · " + s.left(formatEta(first.eta)) else "") else s.stRunning
                }
            )
            b.addAction(0, s.cancel, PendingIntent.getService(this, first.id.hashCode(),
                Intent(this, DownloadService::class.java).setAction(ACTION_CANCEL).putExtra(EXTRA_ID, first.id),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
        }
        return b.build()
    }

    private fun refreshOngoing(force: Boolean = false) {
        val now = System.currentTimeMillis()
        if (!force && now - lastNotify < 800) return
        lastNotify = now
        if (running.isNotEmpty()) getSystemService(NotificationManager::class.java).notify(ONGOING_ID, ongoing())
    }

    private fun notifyFinished(item: Item, title: String) {
        val open = item.uri?.let {
            val view = Intent(Intent.ACTION_VIEW).setDataAndType(Uri.parse(it), item.mime)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
            PendingIntent.getActivity(this, item.id.hashCode(), view, PendingIntent.FLAG_IMMUTABLE)
        } ?: openApp()
        val n = NotificationCompat.Builder(this, CHANNEL_DONE)
            .setSmallIcon(R.drawable.ic_notify)
            .setContentTitle(title)
            .setContentText(item.title)
            .setAutoCancel(true)
            .setContentIntent(open)
            .build()
        getSystemService(NotificationManager::class.java).notify(item.id.hashCode(), n)
    }

    private fun openApp() = PendingIntent.getActivity(this, 0,
        Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), PendingIntent.FLAG_IMMUTABLE)

    override fun onDestroy() { scope.cancel(); super.onDestroy() }

    companion object {
        private const val MAX_PARALLEL = 2
        private const val ONGOING_ID = 7001
        private const val CHANNEL_RUN = "running"
        private const val CHANNEL_DONE = "done"
        private const val ACTION_CANCEL = "com.abdulmedia.barq.CANCEL"
        private const val EXTRA_ID = "id"

        fun createChannels(ctx: Context) {
            val s = Prefs.strings()
            val nm = ctx.getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(NotificationChannel(CHANNEL_RUN, s.notifChannel, NotificationManager.IMPORTANCE_LOW))
            nm.createNotificationChannel(NotificationChannel(CHANNEL_DONE, s.notifDoneChannel, NotificationManager.IMPORTANCE_DEFAULT))
        }

        fun enqueue(ctx: Context, items: List<Item>) {
            items.forEach { Downloads.add(it) }
            start(ctx)
        }

        fun retry(ctx: Context, id: String) {
            Downloads.update(id) { it.copy(status = Status.QUEUED, progress = 0f, error = null, createdAt = System.currentTimeMillis()) }
            start(ctx)
        }

        fun cancel(ctx: Context, id: String) {
            Downloads.update(id) { if (it.active) it.copy(status = Status.CANCELLED) else it }
            Engine.cancel(id)
        }

        private fun start(ctx: Context) =
            ContextCompat.startForegroundService(ctx, Intent(ctx, DownloadService::class.java))

        fun formatEta(sec: Long): String {
            val h = sec / 3600; val m = sec % 3600 / 60; val s = sec % 60
            return if (h > 0) "%d:%02d:%02d".format(h, m, s) else "%d:%02d".format(m, s)
        }
    }
}
