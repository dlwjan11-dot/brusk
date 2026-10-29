package com.abdulmedia.barq

import android.app.Application
import kotlin.concurrent.thread

class BarqApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Prefs.init(this)
        Downloads.load(this)
        DownloadService.createChannels(this)
        // Unpacking Python + yt-dlp takes a few seconds the first time; never on the main thread.
        thread(name = "barq-init") {
            Engine.init(this)
            Engine.autoUpdate(this)
        }
    }
}
