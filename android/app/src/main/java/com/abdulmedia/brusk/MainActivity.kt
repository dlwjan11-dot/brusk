package com.abdulmedia.brusk

import android.Manifest
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private val askNotify = registerForActivityResult(ActivityResultContracts.RequestPermission()) {}

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) askNotify.launch(Manifest.permission.POST_NOTIFICATIONS)
        setContent { BruskTheme { App() } }
    }
}

@Composable
private fun App() {
    var settings by remember { mutableStateOf(false) }
    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Box(Modifier.safeDrawingPadding()) {
            if (settings) { BackHandler { settings = false }; SettingsScreen { settings = false } }
            else HomeScreen(onSettings = { settings = true })
        }
    }
}

private fun openShareSheet(ctx: Context, url: String) {
    ctx.startActivity(Intent(ctx, ShareActivity::class.java).setAction(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, url))
}

@Composable
private fun HomeScreen(onSettings: () -> Unit) {
    val s = LocalStrings.current
    val ctx = LocalContext.current
    val items by Downloads.items.collectAsState()
    var link by remember { mutableStateOf("") }
    val submit = { Engine.findUrl(link)?.let { openShareSheet(ctx, it); link = "" } }

    LazyColumn(Modifier.fillMaxSize().imePadding(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                BoltBadge(40.dp)
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(s.appName, fontWeight = FontWeight.Bold, fontSize = 22.sp)
                    Text(s.tagline, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                IconButton(onClick = onSettings) { Icon(Icons.Filled.Settings, s.settings) }
            }
            Spacer(Modifier.height(10.dp))
        }
        item {
            Card {
                OutlinedTextField(
                    value = link, onValueChange = { link = it }, modifier = Modifier.fillMaxWidth(),
                    placeholder = { Text(s.pasteHint, fontSize = 14.sp) }, singleLine = true, shape = RoundedCornerShape(12.dp),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Go),
                    keyboardActions = KeyboardActions(onGo = { submit() }),
                )
                Spacer(Modifier.height(10.dp))
                Row {
                    OutlinedButton(onClick = {
                        val clip = (ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).primaryClip
                        val text = clip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(ctx)?.toString()
                        Engine.findUrl(text)?.let { openShareSheet(ctx, it) } ?: run { link = text.orEmpty() }
                    }, Modifier.weight(1f).height(48.dp), shape = RoundedCornerShape(12.dp)) { Text(s.paste) }
                    Spacer(Modifier.width(10.dp))
                    Button(onClick = { submit() }, enabled = Engine.findUrl(link) != null, modifier = Modifier.weight(1f).height(48.dp), shape = RoundedCornerShape(12.dp)) {
                        Icon(painterResource(R.drawable.ic_download), null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text(s.go)
                    }
                }
            }
        }
        item {
            Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(MaterialTheme.colorScheme.primaryContainer).padding(14.dp),
                verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Filled.PlayArrow, null, tint = MaterialTheme.colorScheme.onPrimaryContainer)
                Spacer(Modifier.width(10.dp))
                Column {
                    Text(s.howTitle, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onPrimaryContainer)
                    Text(s.howText, fontSize = 13.sp, color = MaterialTheme.colorScheme.onPrimaryContainer)
                }
            }
        }
        item {
            Row(Modifier.padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(s.downloads, fontWeight = FontWeight.Bold, fontSize = 17.sp, modifier = Modifier.weight(1f))
                if (items.any { it.status == Status.DONE || it.status == Status.CANCELLED })
                    TextButton(onClick = { Downloads.clearFinished() }) { Text(s.clearDone) }
            }
        }
        if (items.isEmpty()) item {
            Text(s.emptyTitle, Modifier.fillMaxWidth().padding(vertical = 30.dp), color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = androidx.compose.ui.text.style.TextAlign.Center)
        }
        items(items, key = { it.id }) { DownloadRow(it) }
    }
}

@Composable
private fun Card(content: @Composable () -> Unit) {
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(MaterialTheme.colorScheme.surface)
        .border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(16.dp)).padding(14.dp)) { content() }
}

@Composable
private fun DownloadRow(item: Item) {
    val s = LocalStrings.current
    val ctx = LocalContext.current
    var menu by remember { mutableStateOf(false) }
    var confirm by remember { mutableStateOf(false) }

    Card {
        Row(Modifier.clickable(enabled = item.status == Status.DONE) { openItem(ctx, item) }, verticalAlignment = Alignment.CenterVertically) {
            WebImage(item.thumbnail, Modifier.size(72.dp, 44.dp).clip(RoundedCornerShape(8.dp))) {
                Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surfaceVariant), contentAlignment = Alignment.Center) {
                    Icon(painterResource(R.drawable.ic_download), null, Modifier.size(18.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(item.title, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis, fontSize = 14.sp, lineHeight = 19.sp)
                val (text, color) = when (item.status) {
                    Status.QUEUED -> s.stQueued to MaterialTheme.colorScheme.onSurfaceVariant
                    Status.RUNNING -> (if (item.progress >= 0) "${item.progress.toInt()}%" + (if (item.eta > 0) " · " + s.left(DownloadService.formatEta(item.eta)) else "") else s.stRunning) to MaterialTheme.colorScheme.primary
                    Status.MERGING -> s.stMerging to MaterialTheme.colorScheme.primary
                    Status.SAVING -> s.stSaving to MaterialTheme.colorScheme.primary
                    Status.DONE -> listOf(s.stDone, fmtSize(item.size), item.folder.orEmpty()).filter { it.isNotEmpty() }.joinToString(" · ") to BruskColors.Ok
                    Status.FAILED -> (item.error ?: s.stFailed) to MaterialTheme.colorScheme.error
                    Status.CANCELLED -> s.stCancelled to MaterialTheme.colorScheme.onSurfaceVariant
                }
                Text(text, fontSize = 12.sp, color = color, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
            when {
                item.active -> IconButton(onClick = { DownloadService.cancel(ctx, item.id) }) { Icon(Icons.Filled.Close, s.cancel) }
                item.status == Status.FAILED || item.status == Status.CANCELLED ->
                    IconButton(onClick = { DownloadService.retry(ctx, item.id) }) { Icon(Icons.Filled.Refresh, s.retry) }
            }
            Box {
                IconButton(onClick = { menu = true }) { Icon(Icons.Filled.MoreVert, null) }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    if (item.status == Status.DONE) {
                        DropdownMenuItem(text = { Text(s.open) }, onClick = { menu = false; openItem(ctx, item) })
                        DropdownMenuItem(text = { Text(s.share) }, onClick = { menu = false; shareItem(ctx, item) })
                    }
                    if (!item.active) DropdownMenuItem(text = { Text(s.delete) }, onClick = { menu = false; confirm = true })
                }
            }
        }
        if (item.active) {
            Spacer(Modifier.height(10.dp))
            if (item.status == Status.RUNNING && item.progress >= 0)
                LinearProgressIndicator(progress = { item.progress / 100f }, modifier = Modifier.fillMaxWidth().height(5.dp).clip(RoundedCornerShape(3.dp)))
            else LinearProgressIndicator(Modifier.fillMaxWidth().height(5.dp).clip(RoundedCornerShape(3.dp)))
        }
        if (confirm) {
            var alsoFile by remember { mutableStateOf(false) }
            HorizontalDivider(Modifier.padding(vertical = 10.dp), color = MaterialTheme.colorScheme.outline)
            if (item.uri != null) Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(checked = alsoFile, onCheckedChange = { alsoFile = it }); Text(s.deleteFile, fontSize = 14.sp)
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                TextButton(onClick = { confirm = false }) { Text(s.cancel) }
                TextButton(onClick = {
                    if (alsoFile) item.uri?.let { runCatching { ctx.contentResolver.delete(Uri.parse(it), null, null) } }
                    Downloads.remove(item.id)
                }) { Text(s.delete, color = MaterialTheme.colorScheme.error) }
            }
        }
    }
}

private fun openItem(ctx: Context, item: Item) {
    val uri = item.uri ?: return
    runCatching {
        ctx.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(Uri.parse(uri), item.mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
    }
}

private fun shareItem(ctx: Context, item: Item) {
    val uri = item.uri ?: return
    val send = Intent(Intent.ACTION_SEND).setType(item.mime ?: "*/*").putExtra(Intent.EXTRA_STREAM, Uri.parse(uri))
        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    ctx.startActivity(Intent.createChooser(send, item.title))
}

@Composable
private fun SettingsScreen(onBack: () -> Unit) {
    val s = LocalStrings.current
    val ctx = LocalContext.current
    val lang by Prefs.lang.collectAsState()
    var quality by remember { mutableStateOf(Prefs.quality(ctx)) }
    var version by remember { mutableStateOf<String?>(null) }
    var updateState by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) { runCatching { Engine.ready.await(); version = Engine.version(ctx) } }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, s.close) }
            Text(s.settings, fontWeight = FontWeight.Bold, fontSize = 20.sp)
        }
        Spacer(Modifier.height(10.dp))
        Card {
            Text(s.language, fontWeight = FontWeight.SemiBold)
            Choice("العربية", lang == "ar") { Prefs.setLang(ctx, "ar"); DownloadService.createChannels(ctx) }
            Choice("English", lang == "en") { Prefs.setLang(ctx, "en"); DownloadService.createChannels(ctx) }
        }
        Spacer(Modifier.height(10.dp))
        Card {
            Text(s.defaultQuality, fontWeight = FontWeight.SemiBold)
            for ((id, label) in listOf("ask" to s.askQuality, "h1080" to "1080p", "h720" to "720p", "h480" to "480p", "audio" to "${s.audioOnly} · MP3")) {
                Choice(label, quality == id) { quality = id; Prefs.setQuality(ctx, id) }
            }
        }
        Spacer(Modifier.height(10.dp))
        Card {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(s.engine, fontWeight = FontWeight.SemiBold)
                    Text(listOfNotNull(version, updateState ?: s.engineHint).joinToString(" · "), fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                OutlinedButton(onClick = {
                    updateState = s.updating
                    scope.launch {
                        updateState = runCatching { if (Engine.updateNow(ctx)) s.updated else s.upToDate }.getOrElse { s.explain(it.message) }
                        version = Engine.version(ctx)
                    }
                }, enabled = updateState != s.updating) { Text(s.update) }
            }
        }
        Spacer(Modifier.height(10.dp))
        Card {
            Row(verticalAlignment = Alignment.CenterVertically) {
                BoltBadge(34.dp); Spacer(Modifier.width(10.dp))
                Text("${s.appName} ${ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName}", fontWeight = FontWeight.SemiBold)
            }
            Spacer(Modifier.height(8.dp))
            Text(s.aboutText, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            TextButton(onClick = { runCatching { ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://${s.website}/"))) } }) { Text(s.website) }
        }
    }
}

@Composable
private fun Choice(label: String, selected: Boolean, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).clickable(onClick = onClick).padding(vertical = 2.dp),
        verticalAlignment = Alignment.CenterVertically) {
        RadioButton(selected = selected, onClick = onClick)
        Text(label, fontSize = 15.sp)
    }
}
