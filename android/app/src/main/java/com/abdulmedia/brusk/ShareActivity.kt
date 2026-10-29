package com.abdulmedia.brusk

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedContent
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat

/** The sheet that opens when you choose "Download with Brusk" in another app's Share menu. */
class ShareActivity : ComponentActivity() {
    private val askNotify = registerForActivityResult(ActivityResultContracts.RequestPermission()) {}

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val url = Engine.findUrl(intent.getStringExtra(Intent.EXTRA_TEXT) ?: intent.dataString)
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) askNotify.launch(Manifest.permission.POST_NOTIFICATIONS)

        setContent {
            BruskTheme {
                // tap outside the sheet to close it
                Box(
                    Modifier.fillMaxSize().clickable(remember { MutableInteractionSource() }, null) { finish() },
                    contentAlignment = Alignment.BottomCenter,
                ) {
                    Surface(
                        Modifier.fillMaxWidth().heightIn(max = 640.dp)
                            .clickable(remember { MutableInteractionSource() }, null) {},
                        shape = RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp),
                        color = MaterialTheme.colorScheme.surface,
                        tonalElevation = 2.dp,
                    ) {
                        Column(Modifier.navigationBarsPadding().padding(20.dp)) {
                            Box(Modifier.align(Alignment.CenterHorizontally).size(36.dp, 4.dp).clip(RoundedCornerShape(2.dp))
                                .background(MaterialTheme.colorScheme.outline))
                            Spacer(Modifier.height(16.dp))
                            ShareSheet(url, onStart = { items -> start(items) }, onClose = { finish() })
                        }
                    }
                }
            }
        }
    }

    private fun start(items: List<Item>) {
        DownloadService.enqueue(this, items)
        Toast.makeText(this, Prefs.strings().started, Toast.LENGTH_SHORT).show()
        finish()
    }
}

private sealed interface SheetState {
    data object Loading : SheetState
    data class Ready(val info: VideoInfo) : SheetState
    data class Failed(val message: String) : SheetState
}

@Composable
private fun ShareSheet(url: String?, onStart: (List<Item>) -> Unit, onClose: () -> Unit) {
    val s = LocalStrings.current
    val ctx = androidx.compose.ui.platform.LocalContext.current
    var state by remember { mutableStateOf<SheetState>(SheetState.Loading) }
    var preparing by remember { mutableStateOf(!Engine.ready.isCompleted) }

    Row(verticalAlignment = Alignment.CenterVertically) {
        BoltBadge(36.dp)
        Spacer(Modifier.width(12.dp))
        Text(s.appName, fontWeight = FontWeight.Bold, fontSize = 18.sp, modifier = Modifier.weight(1f))
        TextButton(onClick = onClose) { Text(s.close) }
    }
    Spacer(Modifier.height(14.dp))

    if (url == null) { Message(s.notALink); return }

    LaunchedEffect(url) {
        state = try {
            Engine.ready.await(); preparing = false
            val info = Engine.probe(url)
            val pref = Prefs.quality(ctx)
            if (pref != "ask" && info.entries.isEmpty()) {
                val q = info.qualities.firstOrNull { it.id == pref } ?: info.qualities.first()
                onStart(listOf(Item(url = info.url, title = info.title, thumbnail = info.thumbnail, quality = q.id)))
            }
            SheetState.Ready(info)
        } catch (e: Throwable) {
            preparing = false
            SheetState.Failed(s.explain(e.message))
        }
    }

    AnimatedContent(state, label = "sheet") { st ->
        when (st) {
            SheetState.Loading -> Row(Modifier.fillMaxWidth().padding(vertical = 28.dp), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
                CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.5.dp)
                Spacer(Modifier.width(12.dp))
                Text(if (preparing) s.preparing else s.reading, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            is SheetState.Failed -> Column {
                Message(s.readFailed, st.message)
                Spacer(Modifier.height(12.dp))
                Button(onClick = { onStart(listOf(Item(url = url, title = url, quality = "best"))) }, Modifier.fillMaxWidth().height(50.dp)) {
                    Text(s.tryAnyway)
                }
            }
            is SheetState.Ready -> Column(Modifier.verticalScroll(rememberScrollState())) {
                val info = st.info
                Row(verticalAlignment = Alignment.CenterVertically) {
                    WebImage(info.thumbnail, Modifier.size(112.dp, 63.dp).clip(RoundedCornerShape(10.dp))) {
                        Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surfaceVariant), contentAlignment = Alignment.Center) {
                            Icon(painterResource(R.drawable.ic_download), null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text(info.title, fontWeight = FontWeight.SemiBold, maxLines = 3, overflow = TextOverflow.Ellipsis, lineHeight = 20.sp)
                        val sub = listOfNotNull(
                            info.uploader,
                            info.duration.takeIf { it > 0 }?.let { DownloadService.formatEta(it) },
                            if (info.entries.isNotEmpty()) "${s.playlist} · ${s.videosCount(info.entries.size)}" else null,
                        ).joinToString(" · ")
                        if (sub.isNotEmpty()) Text(sub, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
                Spacer(Modifier.height(18.dp))
                Text(if (info.entries.isNotEmpty()) s.downloadAll else s.chooseQuality, fontWeight = FontWeight.SemiBold, fontSize = 14.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.height(8.dp))
                info.qualities.forEachIndexed { i, q ->
                    QualityButton(
                        label = if (q.id == "audio") "${s.audioOnly} · MP3" else if (q.id == "best") s.best else q.label,
                        size = if (info.entries.isEmpty()) fmtSize(q.size) else "",
                        primary = i == 0,
                    ) {
                        val items = if (info.entries.isEmpty())
                            listOf(Item(url = info.url, title = info.title, thumbnail = info.thumbnail, quality = q.id))
                        else info.entries.map { (u, t) -> Item(url = u, title = t, quality = q.id) }
                        onStart(items)
                    }
                    Spacer(Modifier.height(8.dp))
                }
            }
        }
    }
}

@Composable
private fun QualityButton(label: String, size: String, primary: Boolean, onClick: () -> Unit) {
    val content: @Composable () -> Unit = {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Icon(painterResource(R.drawable.ic_download), null, Modifier.size(20.dp))
            Spacer(Modifier.width(10.dp))
            Text(label, fontWeight = FontWeight.SemiBold, fontSize = 16.sp, modifier = Modifier.weight(1f))
            if (size.isNotEmpty()) Text(size, fontSize = 13.sp, color = if (primary) Color.White.copy(alpha = .8f) else MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
    if (primary) Button(onClick = onClick, Modifier.fillMaxWidth().height(54.dp), shape = RoundedCornerShape(14.dp)) { content() }
    else OutlinedButton(onClick = onClick, Modifier.fillMaxWidth().height(54.dp), shape = RoundedCornerShape(14.dp)) { content() }
}

@Composable
private fun Message(title: String, detail: String? = null) {
    Column(Modifier.fillMaxWidth().padding(vertical = 12.dp)) {
        Text(title, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
        if (detail != null) Text(detail, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
