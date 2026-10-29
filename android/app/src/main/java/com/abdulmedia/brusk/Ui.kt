package com.abdulmedia.brusk

import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.net.URL
import java.util.Locale

object BruskColors {
    val Accent = Color(0xFF2F6BFF)
    val Bolt = Color(0xFFFFC414)
    val Ok = Color(0xFF18A058)
    val Err = Color(0xFFE5484D)
    val Warn = Color(0xFFD98E04)
}

private val Light: ColorScheme = lightColorScheme(
    primary = BruskColors.Accent, onPrimary = Color.White,
    primaryContainer = Color(0xFFE6EEFF), onPrimaryContainer = Color(0xFF1847C2),
    background = Color(0xFFF6F7FB), onBackground = Color(0xFF171B26),
    surface = Color.White, onSurface = Color(0xFF171B26),
    surfaceVariant = Color(0xFFF0F2F7), onSurfaceVariant = Color(0xFF5B6275),
    outline = Color(0xFFE3E6EE), error = BruskColors.Err,
)
private val Dark: ColorScheme = darkColorScheme(
    primary = Color(0xFF4D82FF), onPrimary = Color.White,
    primaryContainer = Color(0xFF1B2645), onPrimaryContainer = Color(0xFF9DBBFF),
    background = Color(0xFF0F1115), onBackground = Color(0xFFE8EAF0),
    surface = Color(0xFF161920), onSurface = Color(0xFFE8EAF0),
    surfaceVariant = Color(0xFF1C2029), onSurfaceVariant = Color(0xFFA2A9B8),
    outline = Color(0xFF262B36), error = Color(0xFFFF6B6F),
)

val LocalStrings = staticCompositionLocalOf { Strings("ar") }

/** Theme + language + reading direction (Arabic and Kurdish right to left). */
@Composable
fun BruskTheme(content: @Composable () -> Unit) {
    val lang by Prefs.lang.collectAsState()
    MaterialTheme(colorScheme = if (isSystemInDarkTheme()) Dark else Light) {
        CompositionLocalProvider(
            LocalStrings provides Strings(lang),
            LocalLayoutDirection provides if (lang != "en") LayoutDirection.Rtl else LayoutDirection.Ltr,
            content = content,
        )
    }
}

@Composable
fun BoltBadge(size: Dp = 40.dp) {
    Box(
        Modifier.size(size).clip(RoundedCornerShape(size * 0.26f))
            .background(androidx.compose.ui.graphics.Brush.verticalGradient(listOf(Color(0xFF141840), Color(0xFF2B5CFF)))),
        contentAlignment = Alignment.Center,
    ) {
        Image(painterResource(R.drawable.ic_bolt), null, Modifier.size(size * 0.6f))
    }
}

/** A small picture from the web (video thumbnails), without an image library. */
@Composable
fun WebImage(url: String?, modifier: Modifier, placeholder: @Composable () -> Unit) {
    val img by produceState<ImageBitmap?>(null, url) {
        value = url?.let {
            withContext(Dispatchers.IO) {
                runCatching {
                    URL(it).openStream().use { s ->
                        val o = BitmapFactory.Options().apply { inSampleSize = 2 }
                        BitmapFactory.decodeStream(s, null, o)?.asImageBitmap()
                    }
                }.getOrNull()
            }
        }
    }
    val b = img
    if (b != null) Image(b, null, modifier, contentScale = ContentScale.Crop) else Box(modifier) { placeholder() }
}

fun fmtSize(bytes: Long): String {
    if (bytes <= 0) return ""
    val u = arrayOf("B", "KB", "MB", "GB")
    var v = bytes.toDouble(); var i = 0
    while (v >= 1024 && i < u.size - 1) { v /= 1024; i++ }
    return String.format(Locale.US, if (i >= 2) "%.1f %s" else "%.0f %s", v, u[i])
}
